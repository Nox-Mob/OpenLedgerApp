-- OpenLedgerApp baseline: Ledger's tables in schema `ledger`, on top of the
-- OpenAppHub core (db/core). Spec: docs/SHARED-SPEC.md §3.4–3.5; mapping from the
-- old public-schema database: docs/MIGRATION-NOTES.md §2 and §4.
--
-- Runs on the shared OpenAppHub database (hosted) and on a self-hosted Ledger
-- database (core + this file). Applied once by scripts/migrate.mjs.
--
-- Built from the final state of the old supabase/migrations (replayed, then
-- ported): the books, imports, statement checks, funds, pledges, budgets,
-- templates and history, with every integrity guard unchanged in behaviour
-- (balanced and immutable posted entries, voids instead of edits, locked
-- reconciliations, books lock, one opening balance, unique names...).
--
-- Moved to core, not recreated: organizations (name, owner), user_roles (now core
-- roles + the treasurer overlay), profiles (display name), org_invites, ownership,
-- delete_organization_atomic. Ledger keeps:
--   * ledger.org_settings      currency, fiscal year, terminology, books lock, MFA...;
--                              a missing row means defaults
--   * ledger.member_roles      the treasurer overlay (spec §3.5)
--   * ledger.user_preferences  per-person terminology
-- Every policy goes through the helpers below: reads need membership and two-step
-- sign-in when the org requires it; writes also need public.can_write(org,'ledger'),
-- so a lapsed plan makes Ledger read-only.

create schema if not exists ledger;
revoke all on schema ledger from public, anon;
grant usage on schema ledger to authenticated, service_role;

-- Types -------------------------------------------------------------------------------

CREATE TYPE ledger.account_type AS ENUM (
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense'
);

CREATE TYPE ledger.import_format AS ENUM (
    'csv',
    'ofx',
    'qfx',
    'pdf'
);

CREATE TYPE ledger.org_type AS ENUM (
    'nonprofit',
    'business'
);

CREATE TYPE ledger.reconcile_mode AS ENUM (
    'simple',
    'full'
);

CREATE TYPE ledger.reconcile_status AS ENUM (
    'in_progress',
    'completed'
);

CREATE TYPE ledger.transaction_source AS ENUM (
    'manual',
    'import',
    'opening_balance',
    'adjustment',
    'transfer',
    'closing',
    'release',
    'pledge'
);

CREATE TYPE ledger.transaction_status AS ENUM (
    'posted',
    'void'
);

-- Settings, overlay and preferences --------------------------------------------------

create table ledger.org_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  org_type ledger.org_type not null default 'business',
  currency text not null default 'USD',
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  terminology text not null default 'simplest' check (terminology in ('simplest', 'simple', 'accounting')),
  term_overrides jsonb not null default '{}'::jsonb,
  timezone text not null default 'America/Chicago' check (length(timezone) between 1 and 64),
  ai_pdf_enabled boolean not null default false,
  books_locked_through date,
  require_mfa boolean not null default false,
  recurring_mode text not null default 'drafts' check (recurring_mode in ('drafts', 'reminder')),
  updated_at timestamptz not null default now()
);

create table ledger.member_roles (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role = 'treasurer'),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table ledger.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  terminology text not null default 'simplest' check (terminology in ('simplest', 'simple', 'accounting')),
  term_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Permission helpers (spec §3.4–3.5, MIGRATION-NOTES §4.2, §4.6) ---------------------

-- Two-step sign-in: required only when the org asks for it. The server (service
-- role, self-hosted only) is exempt.
create or replace function ledger.mfa_ok(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.role(), '') = 'service_role'
      or not coalesce((select s.require_mfa from ledger.org_settings s where s.org_id = p_org), false)
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- Read: a member of the org (any core role), past two-step sign-in if required.
create or replace function ledger.can_read(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_member(p_org) and ledger.mfa_ok(p_org);
$$;

-- Write (Ledger's write helper): owner, admin or member of a writable org.
create or replace function ledger.can_edit(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_write(p_org, 'ledger') and ledger.mfa_ok(p_org);
$$;

-- Settings, accounts, the overlay: owner or admin.
create or replace function ledger.is_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ledger.can_edit(p_org) and public.has_role(p_org, '{owner,admin}'::public.org_role[]);
$$;

-- Treasurer overlay; counts only while the person is core member or higher.
create or replace function ledger.is_treasurer(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ledger.member_roles r where r.org_id = p_org and r.user_id = auth.uid() and r.role = 'treasurer')
     and public.has_role(p_org, '{owner,admin,member}'::public.org_role[]);
$$;

-- Close books, lock periods, reopen statement checks: owner, admin or treasurer.
create or replace function ledger.can_close_books(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ledger.can_edit(p_org)
     and (public.has_role(p_org, '{owner,admin}'::public.org_role[]) or ledger.is_treasurer(p_org));
$$;

-- The organizations the caller may read or write, for row level security. A policy
-- written as `org_id in (select ledger.readable_org_ids())` runs this once per query;
-- calling ledger.can_read(org_id) per row re-checks membership, settings and the
-- session token for every row (the performance check caught it: 1.7 s for 10,000
-- entries).
create or replace function ledger.readable_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m
  where m.user_id = auth.uid() and ledger.mfa_ok(m.org_id);
$$;

create or replace function ledger.writable_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m
  where m.user_id = auth.uid() and m.role in ('owner', 'admin', 'member')
    and public.has_app_access(m.org_id, 'ledger') and ledger.mfa_ok(m.org_id);
$$;

-- Tables (from the old schema) -------------------------------------------------------

CREATE TABLE ledger.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    type ledger.account_type NOT NULL,
    subtype text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ledger.ai_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text DEFAULT 'pdf_extract'::text NOT NULL,
    page_count integer,
    ok boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_usage_kind_check CHECK ((kind = 'pdf_extract'::text))
);

CREATE TABLE ledger.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id uuid,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'change'::text NOT NULL,
    recorded_change jsonb,
    CONSTRAINT audit_log_kind_check CHECK ((kind = ANY (ARRAY['change'::text, 'ledger'::text, 'system'::text])))
);

CREATE TABLE ledger.bank_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    account_id uuid NOT NULL,
    bank_date date NOT NULL,
    description text NOT NULL,
    amount_cents bigint NOT NULL,
    external_id text,
    fingerprint text NOT NULL,
    transaction_id uuid,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    batch_id uuid,
    needs_review boolean DEFAULT false NOT NULL,
    row_seq integer
);

CREATE TABLE ledger.budgets (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    account_id uuid NOT NULL,
    period_type text NOT NULL,
    period_start date NOT NULL,
    amount_cents bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fund_id uuid,
    project_id uuid,
    CONSTRAINT budgets_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT budgets_period_type_check CHECK ((period_type = ANY (ARRAY['year'::text, 'month'::text])))
);

CREATE TABLE ledger.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    type ledger.account_type DEFAULT 'expense'::ledger.account_type NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT categories_type_check CHECK ((type = ANY (ARRAY['revenue'::ledger.account_type, 'expense'::ledger.account_type])))
);

CREATE TABLE ledger.deleted_organizations (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    deleted_by uuid NOT NULL,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ledger.entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    account_id uuid NOT NULL,
    amount_cents bigint NOT NULL,
    category_id uuid,
    project_id uuid,
    fund_id uuid,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reconciliation_id uuid,
    CONSTRAINT entries_amount_cents_check CHECK ((amount_cents <> 0))
);

CREATE TABLE ledger.funds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    is_restricted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE ledger.import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    account_id uuid NOT NULL,
    file_name text NOT NULL,
    format ledger.import_format NOT NULL,
    statement_start date,
    statement_end date,
    beginning_balance_cents bigint,
    ending_balance_cents bigint,
    rows_total integer DEFAULT 0 NOT NULL,
    rows_imported integer DEFAULT 0 NOT NULL,
    rows_duplicate integer DEFAULT 0 NOT NULL,
    rows_error integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    balance_mismatch_cents bigint,
    CONSTRAINT import_batches_status_check CHECK ((status = ANY (ARRAY['active'::text, 'undone'::text])))
);

CREATE TABLE ledger.import_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    account_id uuid NOT NULL,
    name text NOT NULL,
    mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ledger.legal_acceptances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    document_type text NOT NULL,
    version text NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legal_acceptances_document_type_check CHECK ((document_type = ANY (ARRAY['terms'::text, 'privacy'::text, 'non_advice'::text]))),
    CONSTRAINT legal_acceptances_version_check CHECK (((char_length(version) >= 1) AND (char_length(version) <= 40)))
);

CREATE TABLE ledger.period_closes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    fiscal_year_end date NOT NULL,
    transaction_id uuid,
    net_income_cents bigint NOT NULL,
    closed_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ledger.pledge_payments (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    pledge_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    kind text DEFAULT 'payment'::text NOT NULL,
    amount_cents bigint NOT NULL,
    paid_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pledge_payments_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT pledge_payments_kind_check CHECK ((kind = ANY (ARRAY['payment'::text, 'write_off'::text])))
);

CREATE TABLE ledger.pledges (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    donor_name text NOT NULL,
    fund_id uuid,
    amount_cents bigint NOT NULL,
    pledge_date date NOT NULL,
    expected_date date,
    note text,
    status text DEFAULT 'open'::text NOT NULL,
    transaction_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pledges_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT pledges_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paid'::text, 'written_off'::text])))
);

CREATE TABLE ledger.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    budget_cents bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text])))
);

CREATE TABLE ledger.reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    account_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    beginning_balance_cents bigint DEFAULT 0 NOT NULL,
    ending_balance_cents bigint DEFAULT 0 NOT NULL,
    mode ledger.reconcile_mode DEFAULT 'full'::ledger.reconcile_mode NOT NULL,
    status ledger.reconcile_status DEFAULT 'in_progress'::ledger.reconcile_status NOT NULL,
    batch_id uuid,
    created_by uuid,
    completed_by uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reconciliations_check CHECK ((period_end >= period_start))
);

CREATE TABLE ledger.recurring_occurrences (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    template_id uuid NOT NULL,
    due_date date NOT NULL,
    status text NOT NULL,
    transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recurring_occurrences_status_check CHECK ((status = ANY (ARRAY['posted'::text, 'skipped'::text])))
);

CREATE TABLE ledger.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE ledger.transaction_tags (
    transaction_id uuid NOT NULL,
    tag_id uuid NOT NULL
);

CREATE TABLE ledger.transaction_templates (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    frequency text,
    next_due date,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transaction_templates_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text])))
);

CREATE TABLE ledger.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    transaction_date date NOT NULL,
    posted_date date,
    description text NOT NULL,
    source ledger.transaction_source DEFAULT 'manual'::ledger.transaction_source NOT NULL,
    status ledger.transaction_status DEFAULT 'posted'::ledger.transaction_status NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key text,
    CONSTRAINT transactions_idempotency_key_check CHECK (((idempotency_key IS NULL) OR ((length(idempotency_key) >= 8) AND (length(idempotency_key) <= 120))))
);

COMMENT ON SCHEMA public IS 'standard public schema';

COMMENT ON COLUMN ledger.audit_log.recorded_change IS 'Exact changes applied by audited_write in the same database transaction, written by the database, not the caller.';

COMMENT ON COLUMN ledger.bank_transactions.row_seq IS 'Position of the row within its import batch; part of the content fingerprint so identical rows in one file do not collide.';

-- Every row carries org_id (spec §3.4). Entries and transaction tags get it from
-- their transaction (set by a trigger, so callers don't pass it).
alter table ledger.entries add column org_id uuid;
alter table ledger.transaction_tags add column org_id uuid;

ALTER TABLE ONLY ledger.accounts
    ADD CONSTRAINT accounts_org_id_name_key UNIQUE (org_id, name);

ALTER TABLE ONLY ledger.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.bank_transactions
    ADD CONSTRAINT bank_transactions_org_id_account_id_fingerprint_key UNIQUE (org_id, account_id, fingerprint);

ALTER TABLE ONLY ledger.bank_transactions
    ADD CONSTRAINT bank_transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.categories
    ADD CONSTRAINT categories_org_id_name_key UNIQUE (org_id, name);

ALTER TABLE ONLY ledger.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.deleted_organizations
    ADD CONSTRAINT deleted_organizations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.entries
    ADD CONSTRAINT entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.funds
    ADD CONSTRAINT funds_org_id_name_key UNIQUE (org_id, name);

ALTER TABLE ONLY ledger.funds
    ADD CONSTRAINT funds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.import_profiles
    ADD CONSTRAINT import_profiles_account_id_name_key UNIQUE (account_id, name);

ALTER TABLE ONLY ledger.import_profiles
    ADD CONSTRAINT import_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.legal_acceptances
    ADD CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.legal_acceptances
    ADD CONSTRAINT legal_acceptances_user_id_document_type_version_key UNIQUE (user_id, document_type, version);

ALTER TABLE ONLY ledger.period_closes
    ADD CONSTRAINT period_closes_org_id_fiscal_year_end_key UNIQUE (org_id, fiscal_year_end);

ALTER TABLE ONLY ledger.period_closes
    ADD CONSTRAINT period_closes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.pledge_payments
    ADD CONSTRAINT pledge_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.pledges
    ADD CONSTRAINT pledges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.projects
    ADD CONSTRAINT projects_org_id_name_key UNIQUE (org_id, name);

ALTER TABLE ONLY ledger.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.reconciliations
    ADD CONSTRAINT reconciliations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.recurring_occurrences
    ADD CONSTRAINT recurring_occurrences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.recurring_occurrences
    ADD CONSTRAINT recurring_occurrences_template_id_due_date_key UNIQUE (template_id, due_date);

ALTER TABLE ONLY ledger.tags
    ADD CONSTRAINT tags_org_id_name_key UNIQUE (org_id, name);

ALTER TABLE ONLY ledger.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.transaction_tags
    ADD CONSTRAINT transaction_tags_pkey PRIMARY KEY (transaction_id, tag_id);

ALTER TABLE ONLY ledger.transaction_templates
    ADD CONSTRAINT transaction_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ledger.accounts
    ADD CONSTRAINT accounts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.ai_usage
    ADD CONSTRAINT ai_usage_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.audit_log
    ADD CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.bank_transactions
    ADD CONSTRAINT bank_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES ledger.accounts(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.bank_transactions
    ADD CONSTRAINT bank_transactions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES ledger.import_batches(id) ON DELETE SET NULL;

ALTER TABLE ONLY ledger.bank_transactions
    ADD CONSTRAINT bank_transactions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.bank_transactions
    ADD CONSTRAINT bank_transactions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES ledger.transactions(id) ON DELETE SET NULL;

ALTER TABLE ONLY ledger.budgets
    ADD CONSTRAINT budgets_account_id_fkey FOREIGN KEY (account_id) REFERENCES ledger.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.budgets
    ADD CONSTRAINT budgets_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES ledger.funds(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.budgets
    ADD CONSTRAINT budgets_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.budgets
    ADD CONSTRAINT budgets_project_id_fkey FOREIGN KEY (project_id) REFERENCES ledger.projects(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.categories
    ADD CONSTRAINT categories_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.entries
    ADD CONSTRAINT entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES ledger.accounts(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.entries
    ADD CONSTRAINT entries_category_id_fkey FOREIGN KEY (category_id) REFERENCES ledger.categories(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.entries
    ADD CONSTRAINT entries_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES ledger.funds(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.entries
    ADD CONSTRAINT entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES ledger.projects(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.entries
    ADD CONSTRAINT entries_reconciliation_id_fkey FOREIGN KEY (reconciliation_id) REFERENCES ledger.reconciliations(id) ON DELETE SET NULL;

ALTER TABLE ONLY ledger.entries
    ADD CONSTRAINT entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES ledger.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.funds
    ADD CONSTRAINT funds_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.import_batches
    ADD CONSTRAINT import_batches_account_id_fkey FOREIGN KEY (account_id) REFERENCES ledger.accounts(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.import_batches
    ADD CONSTRAINT import_batches_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.import_profiles
    ADD CONSTRAINT import_profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES ledger.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.import_profiles
    ADD CONSTRAINT import_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.legal_acceptances
    ADD CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.period_closes
    ADD CONSTRAINT period_closes_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.period_closes
    ADD CONSTRAINT period_closes_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES ledger.transactions(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.pledge_payments
    ADD CONSTRAINT pledge_payments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.pledge_payments
    ADD CONSTRAINT pledge_payments_pledge_id_fkey FOREIGN KEY (pledge_id) REFERENCES ledger.pledges(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.pledge_payments
    ADD CONSTRAINT pledge_payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES ledger.transactions(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.pledges
    ADD CONSTRAINT pledges_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES ledger.funds(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.pledges
    ADD CONSTRAINT pledges_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.pledges
    ADD CONSTRAINT pledges_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES ledger.transactions(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.projects
    ADD CONSTRAINT projects_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.reconciliations
    ADD CONSTRAINT reconciliations_account_id_fkey FOREIGN KEY (account_id) REFERENCES ledger.accounts(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.reconciliations
    ADD CONSTRAINT reconciliations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES ledger.import_batches(id) ON DELETE SET NULL;

ALTER TABLE ONLY ledger.reconciliations
    ADD CONSTRAINT reconciliations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.recurring_occurrences
    ADD CONSTRAINT recurring_occurrences_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.recurring_occurrences
    ADD CONSTRAINT recurring_occurrences_template_id_fkey FOREIGN KEY (template_id) REFERENCES ledger.transaction_templates(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.recurring_occurrences
    ADD CONSTRAINT recurring_occurrences_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES ledger.transactions(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ledger.tags
    ADD CONSTRAINT tags_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.transaction_tags
    ADD CONSTRAINT transaction_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES ledger.tags(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.transaction_tags
    ADD CONSTRAINT transaction_tags_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES ledger.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.transaction_templates
    ADD CONSTRAINT transaction_templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger.transactions
    ADD CONSTRAINT transactions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

alter table only ledger.entries
  add constraint entries_org_id_fkey foreign key (org_id) references public.organizations (id) on delete cascade;
alter table only ledger.transaction_tags
  add constraint transaction_tags_org_id_fkey foreign key (org_id) references public.organizations (id) on delete cascade;
alter table ledger.entries alter column org_id set not null;
alter table ledger.transaction_tags alter column org_id set not null;

CREATE INDEX ai_usage_user_time ON ledger.ai_usage USING btree (org_id, user_id, created_at DESC);

CREATE UNIQUE INDEX budgets_scope_key ON ledger.budgets USING btree (org_id, account_id, period_type, period_start, COALESCE(fund_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX entries_reconciliation_idx ON ledger.entries USING btree (reconciliation_id);

CREATE INDEX idx_entries_account ON ledger.entries USING btree (account_id);

CREATE INDEX idx_entries_transaction ON ledger.entries USING btree (transaction_id);

CREATE INDEX pledge_payments_pledge_idx ON ledger.pledge_payments USING btree (pledge_id);

CREATE INDEX pledges_org_idx ON ledger.pledges USING btree (org_id);

CREATE UNIQUE INDEX reconciliations_one_open_per_account ON ledger.reconciliations USING btree (account_id) WHERE (status = 'in_progress'::ledger.reconcile_status);

CREATE UNIQUE INDEX transactions_org_idempotency_key ON ledger.transactions USING btree (org_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

-- Indexes for org-scoped reads (row level security filters on org_id).
create index on ledger.accounts (org_id);
create index on ledger.audit_log (org_id, created_at desc);
create index on ledger.bank_transactions (org_id, account_id, bank_date);
create index on ledger.bank_transactions (transaction_id);
create index on ledger.bank_transactions (batch_id);
create index on ledger.budgets (org_id);
create index on ledger.entries (org_id);
create index on ledger.import_batches (org_id);
create index on ledger.reconciliations (org_id);
create index on ledger.recurring_occurrences (org_id);
create index on ledger.transaction_tags (org_id);
create index on ledger.transaction_tags (tag_id);
create index on ledger.transaction_templates (org_id);
create index on ledger.transactions (org_id, transaction_date desc);
create index on ledger.member_roles (user_id);

-- Functions (from the old schema, ported) --------------------------------------------

CREATE FUNCTION ledger.audit_append_in_write(p_org uuid, p_user uuid, p_audit jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  a jsonb;
  v_ops jsonb;
BEGIN
  IF coalesce(current_setting('openledgerapp.audited_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'History entries can only be written together with a change'
      USING ERRCODE = '42501';
  END IF;
  v_ops := nullif(coalesce(current_setting('openledgerapp.audited_ops', true), ''), '')::jsonb;
  FOR a IN
    SELECT value FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_audit) = 'array' THEN p_audit ELSE jsonb_build_array(p_audit) END
    )
  LOOP
    INSERT INTO ledger.audit_log (id, org_id, user_id, action, entity, entity_id, before, after, kind, recorded_change)
    VALUES (
      (a->>'id')::uuid,
      p_org,
      p_user,
      a->>'action',
      a->>'entity',
      nullif(a->>'entity_id', '')::uuid,
      nullif(a->'before', 'null'::jsonb),
      nullif(a->'after', 'null'::jsonb),
      coalesce(a->>'kind', 'change'),
      v_ops
    );
  END LOOP;
END;
$$;

CREATE FUNCTION ledger.audited_write(p_org uuid, p_ops jsonb, p_audit jsonb, p_user uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_user uuid;
  o jsonb;
  t text;
  op text;
  vals jsonb;
  m jsonb;
  inl jsonb;
  cols text;
  setl text;
  wherel text;
  n int;
  results jsonb := '[]'::jsonb;
  recorded jsonb := '[]'::jsonb;
  allowed text[] := ARRAY[
    'org_settings','member_roles','accounts','budgets','reconciliations',
    'entries','bank_transactions','import_batches','import_profiles','pledges','pledge_payments','funds',
    'categories','tags','projects','period_closes',
    'transaction_templates','recurring_occurrences'
  ];
BEGIN
  v_user := CASE WHEN v_service THEN p_user ELSE auth.uid() END;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'audited_write needs at least one change';
  END IF;
  IF p_audit IS NULL OR p_audit = 'null'::jsonb THEN
    RAISE EXCEPTION 'audited_write needs a history entry';
  END IF;

  FOR o IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    t := o->>'table';
    op := o->>'op';
    IF NOT (t = ANY (allowed)) THEN
      RAISE EXCEPTION 'Table % is not writable here', t;
    END IF;
    IF t = 'entries' AND (op <> 'update' OR (SELECT array_agg(k) FROM jsonb_object_keys(o->'values') k) <> ARRAY['reconciliation_id']) THEN
      RAISE EXCEPTION 'Entries can only change their statement check';
    END IF;
    IF t = 'org_settings' AND op = 'delete' THEN
      RAISE EXCEPTION 'Organization settings are reset, not deleted';
    END IF;

    m := coalesce(o->'match', '{}'::jsonb);
    inl := coalesce(o->'in', '{}'::jsonb);
    IF t <> 'entries' THEN
      m := m || jsonb_build_object('org_id', p_org);
    END IF;

    IF op = 'insert' THEN
      vals := o->'values';
      IF jsonb_typeof(vals) = 'object' THEN vals := jsonb_build_array(vals); END IF;
      IF vals IS NULL OR jsonb_array_length(vals) = 0 THEN
        results := results || jsonb_build_array(jsonb_build_object('count', 0));
        CONTINUE;
      END IF;
      SELECT jsonb_agg(e || jsonb_build_object('org_id', p_org))
        INTO vals FROM jsonb_array_elements(vals) e;
      SELECT string_agg(quote_ident(k), ', ') INTO cols FROM jsonb_object_keys(vals->0) k;
      EXECUTE format(
        'INSERT INTO ledger.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::ledger.%I, $1) %s',
        t, cols, cols, t,
        CASE WHEN o->>'conflict' = 'nothing' THEN 'ON CONFLICT DO NOTHING' ELSE '' END
      ) USING vals;
      GET DIAGNOSTICS n = ROW_COUNT;
      recorded := recorded || jsonb_build_array(jsonb_build_object(
        'table', t, 'op', op, 'values', vals, 'rows', n));
    ELSIF op IN ('update', 'delete') THEN
      SELECT string_agg(x, ' AND ') INTO wherel FROM (
        SELECT format('t.%I IS NOT DISTINCT FROM mm.%I', k, k) AS x FROM jsonb_object_keys(m) k
        UNION ALL
        SELECT format('t.%I::text IN (SELECT jsonb_array_elements_text($3->%L))', k, k)
          FROM jsonb_object_keys(inl) k
      ) s;
      IF wherel IS NULL THEN RAISE EXCEPTION 'A change needs a filter'; END IF;
      IF op = 'update' THEN
        vals := o->'values';
        SELECT string_agg(format('%I = r.%I', k, k), ', ') INTO setl FROM jsonb_object_keys(vals) k;
        IF setl IS NULL THEN RAISE EXCEPTION 'An update needs values'; END IF;
        EXECUTE format(
          'UPDATE ledger.%I t SET %s FROM jsonb_populate_record(NULL::ledger.%I, $1) r, jsonb_populate_record(NULL::ledger.%I, $2) mm WHERE %s',
          t, setl, t, t, wherel
        ) USING vals, m, inl;
        GET DIAGNOSTICS n = ROW_COUNT;
      ELSE
        vals := NULL;
        EXECUTE format(
          'DELETE FROM ledger.%I t USING jsonb_populate_record(NULL::ledger.%I, $2) mm WHERE %s',
          t, t, wherel
        ) USING NULL::jsonb, m, inl;
        GET DIAGNOSTICS n = ROW_COUNT;
      END IF;
      recorded := recorded || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'table', t, 'op', op, 'values', vals, 'match', m,
        'in', nullif(inl, '{}'::jsonb), 'rows', n)));
    ELSE
      RAISE EXCEPTION 'Unknown change type %', op;
    END IF;

    IF n < coalesce((o->>'min_rows')::int, 0) THEN
      RAISE EXCEPTION '%', coalesce(o->>'min_rows_message', 'The record was not found or was already changed')
        USING ERRCODE = 'P0002';
    END IF;
    results := results || jsonb_build_array(jsonb_build_object('count', n));
  END LOOP;

  IF NOT v_service AND NOT ledger.can_read(p_org) THEN
    RAISE EXCEPTION 'Not a member of this organization' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('openledgerapp.audited_ops', recorded::text, true);
  PERFORM set_config('openledgerapp.audited_write', 'on', true);
  PERFORM ledger.audit_append_in_write(p_org, v_user, p_audit);
  PERFORM set_config('openledgerapp.audited_write', 'off', true);
  PERFORM set_config('openledgerapp.audited_ops', '', true);
  RETURN results;
END;
$_$;

CREATE FUNCTION ledger.guard_account_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM ledger.entries WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ledger.bank_transactions WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ledger.import_batches WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ledger.reconciliations WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ledger.budgets WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'This account has activity, so it can only be archived.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION ledger.guard_account_type() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.type <> OLD.type AND EXISTS (SELECT 1 FROM ledger.entries WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'Account type cannot change once the account has transactions';
  END IF;
  IF NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION 'Account cannot move between organizations';
  END IF;
  IF NEW.is_active <> OLD.is_active AND NOT ledger.is_admin(OLD.org_id) THEN
    RAISE EXCEPTION 'Only organization admins can archive or reactivate accounts';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION ledger.guard_bank_evidence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id) THEN
      RAISE EXCEPTION 'Bank rows posted to the ledger cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.org_id, NEW.account_id, NEW.bank_date, NEW.description, NEW.amount_cents,
         NEW.external_id, NEW.fingerprint, NEW.raw, NEW.batch_id, NEW.row_seq, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.org_id, OLD.account_id, OLD.bank_date, OLD.description, OLD.amount_cents,
         OLD.external_id, OLD.fingerprint, OLD.raw, OLD.batch_id, OLD.row_seq, OLD.created_at) THEN
    RAISE EXCEPTION 'Imported bank rows are evidence and cannot be edited.';
  END IF;
  IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
    IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM ledger.transactions WHERE id = OLD.transaction_id AND status = 'posted') THEN
        RAISE EXCEPTION 'A bank row can only be unlinked after its transaction is voided.';
      END IF;
    ELSIF OLD.transaction_id IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM ledger.entries e JOIN ledger.transactions t ON t.id = e.transaction_id
                     WHERE t.id = NEW.transaction_id AND t.status = 'posted'
                       AND e.account_id = NEW.account_id AND e.amount_cents = NEW.amount_cents) THEN
        RAISE EXCEPTION 'A bank row can only link to a posted transaction with a matching amount on the same account.';
      END IF;
    ELSE
      RAISE EXCEPTION 'A linked bank row cannot be re-pointed to another transaction.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_bank_refs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger.accounts WHERE id = NEW.account_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Account does not belong to this organization';
  END IF;
  IF NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger.transactions WHERE id = NEW.transaction_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Transaction does not belong to this organization';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_books_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  lock_date date;
  org uuid;
BEGIN
  org := COALESCE(NEW.org_id, OLD.org_id);
  SELECT books_locked_through INTO lock_date FROM ledger.org_settings WHERE org_id = org;
  IF lock_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.transaction_date <= lock_date THEN
    RAISE EXCEPTION 'Books are locked through %. Choose a later date or ask an admin to unlock.', lock_date;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.transaction_date <= lock_date OR NEW.transaction_date <= lock_date)
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Books are locked through %. This transaction cannot be voided or changed.', lock_date;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

CREATE FUNCTION ledger.guard_budget_account() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger.accounts a WHERE a.id = NEW.account_id AND a.org_id = NEW.org_id AND a.type IN ('revenue','expense')) THEN
    RAISE EXCEPTION 'Budget account must be an income or expense account in this organization';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_budget_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.fund_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger.funds f WHERE f.id = NEW.fund_id AND f.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Fund belongs to another organization';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger.projects p WHERE p.id = NEW.project_id AND p.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Project belongs to another organization';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_entry_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF ROW(NEW.id, NEW.transaction_id, NEW.account_id, NEW.amount_cents, NEW.category_id,
         NEW.project_id, NEW.fund_id, NEW.memo, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.transaction_id, OLD.account_id, OLD.amount_cents, OLD.category_id,
         OLD.project_id, OLD.fund_id, OLD.memo, OLD.created_at) THEN
    RAISE EXCEPTION 'Ledger entries cannot be edited. Void the transaction and record a new one.';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_entry_refs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE tx_org uuid;
BEGIN
  SELECT org_id INTO tx_org FROM ledger.transactions WHERE id = NEW.transaction_id;
  IF NOT EXISTS (SELECT 1 FROM ledger.accounts WHERE id = NEW.account_id AND org_id = tx_org) THEN
    RAISE EXCEPTION 'Account does not belong to this organization';
  END IF;
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger.categories WHERE id = NEW.category_id AND org_id = tx_org) THEN
    RAISE EXCEPTION 'Category does not belong to this organization';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger.projects WHERE id = NEW.project_id AND org_id = tx_org) THEN
    RAISE EXCEPTION 'Project does not belong to this organization';
  END IF;
  IF NEW.fund_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger.funds WHERE id = NEW.fund_id AND org_id = tx_org) THEN
    RAISE EXCEPTION 'Fund does not belong to this organization';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_one_opening_balance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  -- The offsetting equity account legitimately appears in every opening balance.
  IF EXISTS (SELECT 1 FROM ledger.transactions WHERE id = NEW.transaction_id AND source = 'opening_balance')
     AND NOT EXISTS (SELECT 1 FROM ledger.accounts WHERE id = NEW.account_id AND type = 'equity') THEN
    PERFORM pg_advisory_xact_lock(hashtext('opening:' || NEW.account_id::text));
    IF EXISTS (SELECT 1 FROM ledger.entries e JOIN ledger.transactions t ON t.id = e.transaction_id
               WHERE e.account_id = NEW.account_id AND t.source = 'opening_balance'
                 AND t.status = 'posted' AND t.id <> NEW.transaction_id) THEN
      RAISE EXCEPTION 'This account already has an opening balance. Void it first.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_reconciled_entry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE rid uuid; tx_org uuid;
BEGIN
  rid := OLD.reconciliation_id;
  IF TG_OP = 'DELETE' THEN
    SELECT org_id INTO tx_org FROM ledger.reconciliations WHERE id = rid;
    IF rid IS NOT NULL AND (tx_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = tx_org)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF rid IS NOT NULL AND EXISTS (SELECT 1 FROM ledger.reconciliations WHERE id = rid AND status = 'completed') THEN
    IF TG_OP = 'DELETE' OR NEW.amount_cents <> OLD.amount_cents OR NEW.account_id <> OLD.account_id
       OR NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id THEN
      RAISE EXCEPTION 'Entry % is locked by a completed reconciliation', OLD.id;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION ledger.guard_reconciled_transaction() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger.entries e JOIN ledger.reconciliations r ON r.id = e.reconciliation_id
    WHERE e.transaction_id = OLD.id AND r.status = 'completed'
  ) AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date) THEN
    RAISE EXCEPTION 'Transaction % is part of a completed reconciliation; reopen it first', OLD.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION ledger.guard_reconciliation_complete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE acct_type ledger.account_type; cleared bigint; sgn int;
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    SELECT type INTO acct_type FROM ledger.accounts WHERE id = NEW.account_id;
    sgn := CASE WHEN acct_type IN ('asset','expense') THEN 1 ELSE -1 END;
    SELECT COALESCE(SUM(e.amount_cents), 0) INTO cleared
      FROM ledger.entries e JOIN ledger.transactions t ON t.id = e.transaction_id
     WHERE e.reconciliation_id = NEW.id AND t.status = 'posted';
    IF NEW.ending_balance_cents <> NEW.beginning_balance_cents + sgn * cleared THEN
      RAISE EXCEPTION 'Statement check cannot be finished: difference is % cents, it must be zero.',
        NEW.ending_balance_cents - (NEW.beginning_balance_cents + sgn * cleared);
    END IF;
    IF NEW.completed_by IS DISTINCT FROM auth.uid() AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'completed_by must be the current user';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_reconciliation_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    IF NEW.status = 'in_progress' THEN
      IF NOT ledger.can_close_books(OLD.org_id) THEN
        RAISE EXCEPTION 'Only admins and treasurers can reopen a completed reconciliation';
      END IF;
    ELSIF NEW.period_start <> OLD.period_start OR NEW.period_end <> OLD.period_end
       OR NEW.beginning_balance_cents <> OLD.beginning_balance_cents
       OR NEW.ending_balance_cents <> OLD.ending_balance_cents OR NEW.account_id <> OLD.account_id THEN
      RAISE EXCEPTION 'A completed reconciliation cannot be changed; reopen it first';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_template_refs() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger.transaction_templates t WHERE t.id = NEW.template_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Template belongs to another organization';
  END IF;
  IF NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger.transactions x WHERE x.id = NEW.transaction_id AND x.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Transaction belongs to another organization';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ledger.guard_transaction_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.org_id, NEW.transaction_date, NEW.posted_date, NEW.description, NEW.source,
           NEW.created_by, NEW.created_at, NEW.idempotency_key)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.org_id, OLD.transaction_date, OLD.posted_date, OLD.description, OLD.source,
           OLD.created_by, OLD.created_at, OLD.idempotency_key) THEN
      RAISE EXCEPTION 'Posted transactions cannot be edited. Void and re-enter.';
    END IF;
    IF NEW.status <> OLD.status AND NOT (OLD.status = 'posted' AND NEW.status = 'void') THEN
      RAISE EXCEPTION 'A voided transaction cannot be restored. Enter a new one.';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id)
     AND (OLD.status = 'void' OR EXISTS (SELECT 1 FROM ledger.entries WHERE transaction_id = OLD.id)) THEN
    RAISE EXCEPTION 'Transactions with entries (or voided ones) cannot be deleted; they are part of the audit trail.';
  END IF;
  RETURN OLD;
END $$;

CREATE FUNCTION ledger.guard_unique_name() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  dup boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND ledger.normalize_name(NEW.name) = ledger.normalize_name(OLD.name) THEN
    RETURN NEW;
  END IF;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM ledger.%I WHERE org_id = $1 AND id <> $2 AND ledger.normalize_name(name) = ledger.normalize_name($3))',
    TG_TABLE_NAME
  ) INTO dup USING NEW.org_id, NEW.id, NEW.name;
  IF dup THEN
    RAISE EXCEPTION '"%" already exists. Choose a different name.', btrim(NEW.name)
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$_$;

CREATE FUNCTION ledger.normalize_name(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) $$;

CREATE FUNCTION ledger.post_transaction_atomic(p_tx jsonb, p_entries jsonb, p_tags jsonb, p_audit jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_org uuid := (p_tx->>'org_id')::uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT ledger.can_edit(v_org) THEN
    RAISE EXCEPTION 'Not allowed to post in this organization' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(p_tags,'[]'::jsonb)) t(id)
             LEFT JOIN ledger.tags g ON g.id = t.id::uuid AND g.org_id = v_org WHERE g.id IS NULL) THEN
    RAISE EXCEPTION 'Tag does not belong to this organization';
  END IF;
  INSERT INTO ledger.transactions (id, org_id, transaction_date, posted_date, description, source, created_by, idempotency_key)
  VALUES ((p_tx->>'id')::uuid, v_org, (p_tx->>'transaction_date')::date, (p_tx->>'posted_date')::date,
          p_tx->>'description', (p_tx->>'source')::ledger.transaction_source, v_uid, p_tx->>'idempotency_key');
  INSERT INTO ledger.entries (id, transaction_id, account_id, amount_cents, category_id, project_id, fund_id, memo)
  SELECT (e->>'id')::uuid, (p_tx->>'id')::uuid, (e->>'account_id')::uuid, (e->>'amount_cents')::bigint,
         (e->>'category_id')::uuid, (e->>'project_id')::uuid, (e->>'fund_id')::uuid, e->>'memo'
  FROM jsonb_array_elements(p_entries) e;
  INSERT INTO ledger.transaction_tags (transaction_id, tag_id)
  SELECT (p_tx->>'id')::uuid, t::uuid FROM jsonb_array_elements_text(coalesce(p_tags,'[]'::jsonb)) t;
  IF p_audit IS NOT NULL THEN
    INSERT INTO ledger.audit_log (id, org_id, user_id, action, entity, entity_id, before, after, kind)
    VALUES ((p_audit->>'id')::uuid, v_org, v_uid, p_audit->>'action', p_audit->>'entity',
            (p_audit->>'entity_id')::uuid, p_audit->'before', p_audit->'after', 'ledger');
  END IF;
END $$;

CREATE FUNCTION ledger.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE FUNCTION ledger.validate_transaction_balanced() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  tx_id UUID;
  total BIGINT;
  entry_count INT;
  pos_count INT;
  neg_count INT;
  tx_status ledger.transaction_status;
BEGIN
  tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT status INTO tx_status FROM ledger.transactions WHERE id = tx_id;
  -- Transaction itself is gone (organization delete cascade): its entries went with it.
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF tx_status = 'void' THEN RETURN NULL; END IF;

  SELECT COUNT(*),
         COALESCE(SUM(amount_cents), 0),
         COUNT(*) FILTER (WHERE amount_cents > 0),
         COUNT(*) FILTER (WHERE amount_cents < 0)
    INTO entry_count, total, pos_count, neg_count
    FROM ledger.entries
   WHERE transaction_id = tx_id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'Transaction % must have at least 2 entries (has %)', tx_id, entry_count;
  END IF;
  IF total <> 0 THEN
    RAISE EXCEPTION 'Transaction % is not balanced: entries sum to % cents', tx_id, total;
  END IF;
  IF pos_count = 0 OR neg_count = 0 THEN
    RAISE EXCEPTION 'Transaction % must have at least one positive and one negative entry', tx_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION ledger.void_transaction_atomic(p_org uuid, p_id uuid, p_audit jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT ledger.can_edit(p_org) THEN
    RAISE EXCEPTION 'Not allowed to void in this organization' USING ERRCODE = '42501';
  END IF;
  UPDATE ledger.transactions SET status = 'void' WHERE org_id = p_org AND id = p_id AND status = 'posted';
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_audit IS NOT NULL THEN
    INSERT INTO ledger.audit_log (id, org_id, user_id, action, entity, entity_id, before, after, kind)
    VALUES ((p_audit->>'id')::uuid, p_org, v_uid, p_audit->>'action', p_audit->>'entity',
            p_id, p_audit->'before', p_audit->'after', 'ledger');
  END IF;
  RETURN true;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

-- Entries and transaction tags take org_id from their transaction.
create or replace function ledger.set_org_from_transaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select t.org_id into v_org from ledger.transactions t where t.id = new.transaction_id;
  if v_org is null then raise exception 'Transaction not found'; end if;
  if new.org_id is not null and new.org_id <> v_org then
    raise exception 'Transaction belongs to another organization';
  end if;
  new.org_id := v_org;
  return new;
end $$;

-- Settings: currency is supported and frozen once there are transactions.
create or replace function ledger.guard_org_currency()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.currency is distinct from old.currency then
    if new.currency not in ('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'CHF') then
      raise exception 'Currency % is not supported (amounts are stored with two decimals).', new.currency;
    end if;
  end if;
  if new.currency is distinct from (case when tg_op = 'INSERT' then 'USD' else old.currency end)
     and exists (select 1 from ledger.transactions where org_id = new.org_id) then
    raise exception 'Currency cannot change once the organization has transactions.';
  end if;
  return new;
end $$;

-- A treasurer (not admin) may only move the books lock.
create or replace function ledger.guard_settings_non_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
begin
  if coalesce(current_setting('role', true), '') <> 'authenticated' or auth.uid() is null
     or ledger.is_admin(new.org_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_before := to_jsonb(row(new.org_id, 'business', 'USD', 1, 'simplest', '{}'::jsonb, 'America/Chicago', false,
      null::date, false, 'drafts', new.updated_at)::ledger.org_settings);
  else
    v_before := to_jsonb(old);
  end if;
  if (to_jsonb(new) - 'books_locked_through' - 'updated_at') is distinct from (v_before - 'books_locked_through' - 'updated_at') then
    raise exception 'Only organization admins can change organization settings';
  end if;
  return new;
end $$;

-- A treasurer must hold core member or higher.
create or replace function ledger.check_member_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m
                 where m.org_id = new.org_id and m.user_id = new.user_id and m.role in ('owner', 'admin', 'member')) then
    raise exception 'A treasurer must be a member of the organization (not a viewer)';
  end if;
  return new;
end $$;

-- Invitations (spec §4.3): an invitation made in Ledger can carry the treasurer
-- overlay: app = 'ledger', app_payload = {"ledger_role": "treasurer"}.
create or replace function ledger.on_invitation_accepted(p_invitation_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where id = p_invitation_id;
  if v_inv.id is null or v_inv.accepted_by is distinct from auth.uid() then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if v_inv.app is distinct from 'ledger' or v_inv.app_payload ->> 'ledger_role' is null then return; end if;
  if v_inv.app_payload ->> 'ledger_role' <> 'treasurer' then
    raise exception 'Unknown Ledger role %', v_inv.app_payload ->> 'ledger_role' using errcode = '22023';
  end if;
  if v_inv.role is null or v_inv.role not in ('admin', 'member') then
    raise exception 'The treasurer role needs a member role' using errcode = '22023';
  end if;
  insert into ledger.member_roles (org_id, user_id, role) values (v_inv.org_id, auth.uid(), 'treasurer')
  on conflict (org_id, user_id) do nothing;
end $$;

-- Self-hosted organization deletion: the owner records it, then calls core
-- public.delete_organization (MIGRATION-NOTES §4.5). The log outlives the org.
create or replace function ledger.log_org_deletion(p_org uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.has_role(p_org, '{owner}'::public.org_role[]) then
    raise exception 'Only the owner can delete this organization.' using errcode = '42501';
  end if;
  insert into ledger.deleted_organizations (id, org_id, name, deleted_by)
  select gen_random_uuid(), o.id, o.name, auth.uid() from public.organizations o where o.id = p_org;
end $$;

-- Triggers ------------------------------------------------------------------------------

CREATE TRIGGER accounts_guard_type BEFORE UPDATE ON ledger.accounts FOR EACH ROW EXECUTE FUNCTION ledger.guard_account_type();

CREATE TRIGGER bank_transactions_guard_evidence BEFORE DELETE OR UPDATE ON ledger.bank_transactions FOR EACH ROW EXECUTE FUNCTION ledger.guard_bank_evidence();

CREATE TRIGGER bank_transactions_guard_refs BEFORE INSERT OR UPDATE OF org_id, account_id, transaction_id ON ledger.bank_transactions FOR EACH ROW EXECUTE FUNCTION ledger.guard_bank_refs();

CREATE TRIGGER budgets_guard BEFORE INSERT OR UPDATE ON ledger.budgets FOR EACH ROW EXECUTE FUNCTION ledger.guard_budget_account();

CREATE TRIGGER budgets_scope_guard BEFORE INSERT OR UPDATE ON ledger.budgets FOR EACH ROW EXECUTE FUNCTION ledger.guard_budget_scope();

CREATE CONSTRAINT TRIGGER entries_balanced_after_write AFTER INSERT OR DELETE OR UPDATE ON ledger.entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.validate_transaction_balanced();

CREATE TRIGGER entries_guard_immutable BEFORE UPDATE ON ledger.entries FOR EACH ROW EXECUTE FUNCTION ledger.guard_entry_immutable();

CREATE TRIGGER entries_guard_one_opening_balance BEFORE INSERT ON ledger.entries FOR EACH ROW EXECUTE FUNCTION ledger.guard_one_opening_balance();

CREATE TRIGGER entries_guard_reconciled BEFORE DELETE OR UPDATE ON ledger.entries FOR EACH ROW EXECUTE FUNCTION ledger.guard_reconciled_entry();

CREATE TRIGGER entries_guard_refs BEFORE INSERT OR UPDATE OF transaction_id, account_id, category_id, project_id, fund_id ON ledger.entries FOR EACH ROW EXECUTE FUNCTION ledger.guard_entry_refs();

CREATE TRIGGER guard_account_delete BEFORE DELETE ON ledger.accounts FOR EACH ROW EXECUTE FUNCTION ledger.guard_account_delete();

CREATE TRIGGER guard_unique_name BEFORE INSERT OR UPDATE OF name ON ledger.accounts FOR EACH ROW EXECUTE FUNCTION ledger.guard_unique_name();

CREATE TRIGGER guard_unique_name BEFORE INSERT OR UPDATE OF name ON ledger.categories FOR EACH ROW EXECUTE FUNCTION ledger.guard_unique_name();

CREATE TRIGGER guard_unique_name BEFORE INSERT OR UPDATE OF name ON ledger.funds FOR EACH ROW EXECUTE FUNCTION ledger.guard_unique_name();

CREATE TRIGGER guard_unique_name BEFORE INSERT OR UPDATE OF name ON ledger.projects FOR EACH ROW EXECUTE FUNCTION ledger.guard_unique_name();

CREATE TRIGGER guard_unique_name BEFORE INSERT OR UPDATE OF name ON ledger.tags FOR EACH ROW EXECUTE FUNCTION ledger.guard_unique_name();

CREATE TRIGGER reconciliations_guard_complete BEFORE UPDATE ON ledger.reconciliations FOR EACH ROW EXECUTE FUNCTION ledger.guard_reconciliation_complete();

CREATE TRIGGER reconciliations_guard_update BEFORE UPDATE ON ledger.reconciliations FOR EACH ROW EXECUTE FUNCTION ledger.guard_reconciliation_update();

CREATE TRIGGER recurring_occurrences_refs BEFORE INSERT ON ledger.recurring_occurrences FOR EACH ROW EXECUTE FUNCTION ledger.guard_template_refs();

CREATE TRIGGER transaction_templates_updated_at BEFORE UPDATE ON ledger.transaction_templates FOR EACH ROW EXECUTE FUNCTION ledger.update_updated_at_column();

CREATE TRIGGER transactions_guard_books_lock BEFORE INSERT OR UPDATE ON ledger.transactions FOR EACH ROW EXECUTE FUNCTION ledger.guard_books_lock();

CREATE TRIGGER transactions_guard_immutable BEFORE DELETE OR UPDATE ON ledger.transactions FOR EACH ROW EXECUTE FUNCTION ledger.guard_transaction_immutable();

CREATE TRIGGER transactions_guard_reconciled BEFORE UPDATE ON ledger.transactions FOR EACH ROW EXECUTE FUNCTION ledger.guard_reconciled_transaction();

CREATE TRIGGER update_import_batches_updated_at BEFORE UPDATE ON ledger.import_batches FOR EACH ROW EXECUTE FUNCTION ledger.update_updated_at_column();

CREATE TRIGGER update_import_profiles_updated_at BEFORE UPDATE ON ledger.import_profiles FOR EACH ROW EXECUTE FUNCTION ledger.update_updated_at_column();

CREATE TRIGGER update_reconciliations_updated_at BEFORE UPDATE ON ledger.reconciliations FOR EACH ROW EXECUTE FUNCTION ledger.update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON ledger.transactions FOR EACH ROW EXECUTE FUNCTION ledger.update_updated_at_column();

create trigger entries_set_org before insert or update of transaction_id on ledger.entries
  for each row execute function ledger.set_org_from_transaction();
create trigger transaction_tags_set_org before insert or update of transaction_id on ledger.transaction_tags
  for each row execute function ledger.set_org_from_transaction();
create trigger org_settings_guard_currency before insert or update on ledger.org_settings
  for each row execute function ledger.guard_org_currency();
create trigger org_settings_guard_non_admin before insert or update on ledger.org_settings
  for each row execute function ledger.guard_settings_non_admin();
create trigger org_settings_updated_at before update on ledger.org_settings
  for each row execute function ledger.update_updated_at_column();
create trigger member_roles_check before insert or update on ledger.member_roles
  for each row execute function ledger.check_member_role();
create trigger user_preferences_updated_at before update on ledger.user_preferences
  for each row execute function ledger.update_updated_at_column();

-- Row level security, policies and grants --------------------------------------------

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'ledger' loop
    execute format('alter table ledger.%I enable row level security', t);
  end loop;
end $$;

-- Same grants as before the move: history, closes and evidence can't be deleted,
-- even where a policy would allow it. period_closes gains insert to match its
-- existing "Admins and treasurers can record closes" policy.
grant select, insert, update, delete on
  ledger.accounts, ledger.budgets, ledger.categories, ledger.entries, ledger.funds, ledger.import_batches,
  ledger.import_profiles, ledger.projects, ledger.reconciliations, ledger.tags, ledger.transaction_tags,
  ledger.transactions, ledger.member_roles, ledger.user_preferences
to authenticated;
grant select, insert, update on
  ledger.bank_transactions, ledger.pledges, ledger.transaction_templates, ledger.org_settings
to authenticated;
grant select, insert on
  ledger.ai_usage, ledger.legal_acceptances, ledger.pledge_payments, ledger.recurring_occurrences, ledger.period_closes
to authenticated;
grant select on ledger.audit_log to authenticated;
-- deleted_organizations: no access (written by ledger.log_org_deletion).
grant all on all tables in schema ledger to service_role;

CREATE POLICY "Admins and treasurers can record closes" ON ledger.period_closes FOR INSERT TO authenticated WITH CHECK (ledger.can_close_books(org_id));

CREATE POLICY "Admins delete unused accounts" ON ledger.accounts FOR DELETE TO authenticated USING (ledger.is_admin(org_id));

CREATE POLICY "Members can view closes" ON ledger.period_closes FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members read org ai usage" ON ledger.ai_usage FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view accounts" ON ledger.accounts FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view audit log" ON ledger.audit_log FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view bank transactions" ON ledger.bank_transactions FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view budgets" ON ledger.budgets FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view categories" ON ledger.categories FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view entries" ON ledger.entries FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ledger.transactions t
  WHERE ((t.id = entries.transaction_id) AND ledger.can_read(t.org_id)))));

CREATE POLICY "Members view funds" ON ledger.funds FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view import batches" ON ledger.import_batches FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view import profiles" ON ledger.import_profiles FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view occurrences" ON ledger.recurring_occurrences FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view pledge payments" ON ledger.pledge_payments FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view pledges" ON ledger.pledges FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view projects" ON ledger.projects FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view reconciliations" ON ledger.reconciliations FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view tags" ON ledger.tags FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view templates" ON ledger.transaction_templates FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Members view transaction tags" ON ledger.transaction_tags FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ledger.transactions t
  WHERE ((t.id = transaction_tags.transaction_id) AND ledger.can_read(t.org_id)))));

CREATE POLICY "Members view transactions" ON ledger.transactions FOR SELECT TO authenticated USING (org_id IN (SELECT ledger.readable_org_ids()));

CREATE POLICY "Users can accept legal documents for themselves" ON ledger.legal_acceptances FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Users can view their own legal acceptances" ON ledger.legal_acceptances FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY "Writers add budgets" ON ledger.budgets FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers add templates" ON ledger.transaction_templates FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete budgets" ON ledger.budgets FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete categories" ON ledger.categories FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete funds" ON ledger.funds FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete import batches" ON ledger.import_batches FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete import profiles" ON ledger.import_profiles FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete in-progress reconciliations" ON ledger.reconciliations FOR DELETE TO authenticated USING (((org_id IN (SELECT ledger.writable_org_ids())) AND (status = 'in_progress'::ledger.reconcile_status)));

CREATE POLICY "Writers delete projects" ON ledger.projects FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete tags" ON ledger.tags FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers delete transactions" ON ledger.transactions FOR DELETE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert accounts" ON ledger.accounts FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert bank transactions" ON ledger.bank_transactions FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert categories" ON ledger.categories FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert entries" ON ledger.entries FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM ledger.transactions t
  WHERE ((t.id = entries.transaction_id) AND ledger.can_edit(t.org_id)))));

CREATE POLICY "Writers insert funds" ON ledger.funds FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert import batches" ON ledger.import_batches FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert import profiles" ON ledger.import_profiles FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert pledge payments" ON ledger.pledge_payments FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert pledges" ON ledger.pledges FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert projects" ON ledger.projects FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert reconciliations" ON ledger.reconciliations FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert tags" ON ledger.tags FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers insert transactions" ON ledger.transactions FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers log own ai usage" ON ledger.ai_usage FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND ledger.can_edit(org_id)));

CREATE POLICY "Writers manage transaction tags" ON ledger.transaction_tags TO authenticated USING ((EXISTS ( SELECT 1
   FROM ledger.transactions t
  WHERE ((t.id = transaction_tags.transaction_id) AND ledger.can_edit(t.org_id)))));

CREATE POLICY "Writers record occurrences" ON ledger.recurring_occurrences FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update accounts" ON ledger.accounts FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update bank transactions" ON ledger.bank_transactions FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update budgets" ON ledger.budgets FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids())) WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update categories" ON ledger.categories FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update entries" ON ledger.entries FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ledger.transactions t
  WHERE ((t.id = entries.transaction_id) AND ledger.can_edit(t.org_id)))));

CREATE POLICY "Writers update funds" ON ledger.funds FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update import batches" ON ledger.import_batches FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update import profiles" ON ledger.import_profiles FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update pledges" ON ledger.pledges FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update projects" ON ledger.projects FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update reconciliations" ON ledger.reconciliations FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update tags" ON ledger.tags FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update templates" ON ledger.transaction_templates FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids())) WITH CHECK (org_id IN (SELECT ledger.writable_org_ids()));

CREATE POLICY "Writers update transactions" ON ledger.transactions FOR UPDATE TO authenticated USING (org_id IN (SELECT ledger.writable_org_ids()));

-- Entries and transaction tags now carry org_id: read straight from it.
drop policy "Members view entries" on ledger.entries;
create policy "Members view entries" on ledger.entries for select to authenticated using (org_id in (select ledger.readable_org_ids()));
drop policy "Members view transaction tags" on ledger.transaction_tags;
create policy "Members view transaction tags" on ledger.transaction_tags for select to authenticated using (org_id in (select ledger.readable_org_ids()));

-- Settings: members read; owner/admin change everything; treasurers move the books lock.
create policy "Members read settings" on ledger.org_settings for select to authenticated using (public.is_member(org_id));
create policy "Admins and treasurers add settings" on ledger.org_settings for insert to authenticated
  with check (ledger.is_admin(org_id) or ledger.can_close_books(org_id));
create policy "Admins and treasurers update settings" on ledger.org_settings for update to authenticated
  using (ledger.is_admin(org_id) or ledger.can_close_books(org_id))
  with check (ledger.is_admin(org_id) or ledger.can_close_books(org_id));

-- The treasurer overlay: members read; owner/admin manage.
create policy "Members read Ledger roles" on ledger.member_roles for select to authenticated using (public.is_member(org_id));
create policy "Admins add Ledger roles" on ledger.member_roles for insert to authenticated with check (ledger.is_admin(org_id));
create policy "Admins update Ledger roles" on ledger.member_roles for update to authenticated
  using (ledger.is_admin(org_id)) with check (ledger.is_admin(org_id));
create policy "Admins remove Ledger roles" on ledger.member_roles for delete to authenticated using (ledger.is_admin(org_id));

-- Preferences: your own.
create policy "Own preferences" on ledger.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Functions: nothing for anon.
revoke all on all functions in schema ledger from public, anon;
grant execute on all functions in schema ledger to authenticated, service_role;
