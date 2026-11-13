-- S-18 / L-17: OpenCharterApp payments into the books, always reviewed first (owner decision
-- 2026-11-13). Charter's `charter.api_payments` (Charter 0015) is the source. Ledger groups what
-- isn't booked yet into one draft per day and channel (card: into the Stripe balance, net of an
-- estimated processing fee; everything else: into Undeposited funds), and refunds into a draft of
-- their own. A person posts or skips each draft; posting goes through Ledger's usual transaction
-- service (balanced, books not closed, an idempotency key), then `record_charter_import` notes
-- which payments it covered, so nothing is booked twice.
--
-- Choices made without an owner answer (see OpenAppHub docs/review-notes.md):
--   * the card fee is an estimate: the organization sets the rate (default 2.9% + 30¢ per card
--     payment) and the reviewer can change a draft's fee before posting;
--   * the organization chooses whose payments: the national organization only (default), or
--     every chapter too, each chapter on its own line;
--   * only payments received on or after the day the import starts are offered (so what the
--     treasurer already booked by hand isn't offered again);
--   * Charter doesn't record when a refund happened, so refunds are offered on the day they're
--     first seen, and a refund only of what hasn't been booked yet.

create table ledger.charter_import_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  scope text not null default 'national' check (scope in ('national', 'all')),
  starts_on date not null default current_date,
  card_account_id uuid references ledger.accounts (id) on delete set null,
  other_account_id uuid references ledger.accounts (id) on delete set null,
  fee_account_id uuid references ledger.accounts (id) on delete set null,
  join_account_id uuid references ledger.accounts (id) on delete set null,
  renew_account_id uuid references ledger.accounts (id) on delete set null,
  fee_percent_bp integer not null default 290 check (fee_percent_bp between 0 and 2000),
  fee_fixed_cents integer not null default 30 check (fee_fixed_cents between 0 and 1000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
comment on table ledger.charter_import_settings is
  'S-18: whether and how OpenCharterApp payments are offered for the books, per organization.';

create table ledger.charter_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  channel text not null check (channel in ('card', 'other')),
  kind text not null check (kind in ('payments', 'refunds')),
  status text not null check (status in ('posted', 'skipped')),
  transaction_id uuid references ledger.transactions (id) on delete set null,
  payment_count integer not null,
  gross_cents bigint not null,
  fee_cents bigint not null default 0,
  decided_by uuid,
  decided_at timestamptz not null default now()
);
create index charter_imports_org_idx on ledger.charter_imports (org_id, decided_at desc);
comment on table ledger.charter_imports is
  'S-18: each OpenCharterApp draft someone posted or skipped, with the transaction it became.';

create table ledger.charter_import_payments (
  import_id uuid not null references ledger.charter_imports (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  payment_id uuid not null,
  kind text not null check (kind in ('payments', 'refunds')),
  amount_cents bigint not null,
  primary key (import_id, payment_id)
);
-- A payment is booked (or skipped) once; refunds may come in parts.
create unique index charter_import_payments_once on ledger.charter_import_payments (payment_id)
  where kind = 'payments';
create index charter_import_payments_pay_idx on ledger.charter_import_payments (payment_id, kind);
comment on table ledger.charter_import_payments is
  'S-18: which OpenCharterApp payments (and refunded amounts) each import covered.';

alter table ledger.charter_import_settings enable row level security;
alter table ledger.charter_imports enable row level security;
alter table ledger.charter_import_payments enable row level security;
create policy charter_import_settings_read on ledger.charter_import_settings for select to authenticated
  using (org_id in (select ledger.readable_org_ids()));
create policy charter_imports_read on ledger.charter_imports for select to authenticated
  using (org_id in (select ledger.readable_org_ids()));
create policy charter_import_payments_read on ledger.charter_import_payments for select to authenticated
  using (org_id in (select ledger.readable_org_ids()));
grant select on ledger.charter_import_settings, ledger.charter_imports, ledger.charter_import_payments to authenticated;

-- The settings, with whether OpenCharterApp is installed here at all.
create or replace function ledger.charter_import_config(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s ledger.charter_import_settings;
begin
  if not ledger.can_read(p_org) then
    raise exception 'You don''t have access to these books.' using errcode = '42501';
  end if;
  select * into s from ledger.charter_import_settings where org_id = p_org;
  return jsonb_build_object(
    'available', to_regclass('charter.api_payments') is not null,
    'can_change', ledger.is_admin(p_org),
    'enabled', coalesce(s.enabled, false),
    'scope', coalesce(s.scope, 'national'),
    'starts_on', coalesce(s.starts_on, current_date),
    'card_account_id', s.card_account_id,
    'other_account_id', s.other_account_id,
    'fee_account_id', s.fee_account_id,
    'join_account_id', s.join_account_id,
    'renew_account_id', s.renew_account_id,
    'fee_percent_bp', coalesce(s.fee_percent_bp, 290),
    'fee_fixed_cents', coalesce(s.fee_fixed_cents, 30));
end;
$$;

create or replace function ledger.save_charter_import_config(p_org uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  k text;
  t text;
  v uuid;
begin
  if not ledger.is_admin(p_org) then
    raise exception 'Only the owner and OpenLedgerApp admins change this.' using errcode = '42501';
  end if;
  -- Each account must be this organization's, of the right type.
  foreach k in array array['card_account_id', 'other_account_id', 'fee_account_id', 'join_account_id', 'renew_account_id'] loop
    v := nullif(p ->> k, '')::uuid;
    continue when v is null;
    select a.type::text into t from ledger.accounts a where a.id = v and a.org_id = p_org and a.is_active;
    if t is null then
      raise exception 'That account isn''t one of this organization''s active accounts.' using errcode = '22023';
    end if;
    if (k in ('card_account_id', 'other_account_id') and t <> 'asset')
       or (k = 'fee_account_id' and t <> 'expense')
       or (k in ('join_account_id', 'renew_account_id') and t <> 'revenue') then
      raise exception 'Choose an % account for that.',
        case when k in ('card_account_id', 'other_account_id') then 'asset' when k = 'fee_account_id' then 'expense' else 'income' end
        using errcode = '22023';
    end if;
  end loop;
  if coalesce((p ->> 'enabled')::boolean, false) and (
       nullif(p ->> 'card_account_id', '') is null or nullif(p ->> 'other_account_id', '') is null
       or nullif(p ->> 'fee_account_id', '') is null or nullif(p ->> 'join_account_id', '') is null
       or nullif(p ->> 'renew_account_id', '') is null) then
    raise exception 'Choose every account before switching this on.' using errcode = '22023';
  end if;
  insert into ledger.charter_import_settings as s (org_id, enabled, scope, starts_on, card_account_id,
    other_account_id, fee_account_id, join_account_id, renew_account_id, fee_percent_bp, fee_fixed_cents,
    updated_by, updated_at)
  values (p_org, coalesce((p ->> 'enabled')::boolean, false), coalesce(p ->> 'scope', 'national'),
    coalesce((p ->> 'starts_on')::date, current_date),
    nullif(p ->> 'card_account_id', '')::uuid, nullif(p ->> 'other_account_id', '')::uuid,
    nullif(p ->> 'fee_account_id', '')::uuid, nullif(p ->> 'join_account_id', '')::uuid,
    nullif(p ->> 'renew_account_id', '')::uuid,
    coalesce((p ->> 'fee_percent_bp')::int, 290), coalesce((p ->> 'fee_fixed_cents')::int, 30),
    auth.uid(), now())
  on conflict (org_id) do update set enabled = excluded.enabled, scope = excluded.scope,
    starts_on = excluded.starts_on, card_account_id = excluded.card_account_id,
    other_account_id = excluded.other_account_id, fee_account_id = excluded.fee_account_id,
    join_account_id = excluded.join_account_id, renew_account_id = excluded.renew_account_id,
    fee_percent_bp = excluded.fee_percent_bp, fee_fixed_cents = excluded.fee_fixed_cents,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- What's waiting, one row per day, channel and kind. `lines` breaks the gross down by purpose and,
-- with every chapter included, by chapter: [{purpose, unit_id, unit_name, is_national, cents}].
create or replace function ledger.charter_drafts(p_org uuid)
returns table (day date, channel text, kind text, payment_count integer, gross_cents bigint,
  fee_cents bigint, payment_ids uuid[], lines jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  s ledger.charter_import_settings;
  v_currency text;
begin
  if not ledger.can_read(p_org) then
    raise exception 'You don''t have access to these books.' using errcode = '42501';
  end if;
  select * into s from ledger.charter_import_settings x where x.org_id = p_org;
  if s.org_id is null or not s.enabled or to_regclass('charter.api_payments') is null then
    return;
  end if;
  select coalesce(o.currency, 'USD') into v_currency from ledger.org_settings o where o.org_id = p_org;
  v_currency := coalesce(v_currency, 'USD');
  return query execute $q$
    with pay as (
      select p.*, coalesce((select sum(ip.amount_cents) from ledger.charter_import_payments ip
                            where ip.payment_id = p.id and ip.kind = 'refunds'), 0) as refund_booked,
             exists (select 1 from ledger.charter_import_payments ip
                     where ip.payment_id = p.id and ip.kind = 'payments') as booked
      from charter.api_payments p
      where p.org_id = $1 and upper(p.currency) = upper($2) and p.received_on >= $3
        and ($4 = 'all' or p.is_national)
    ), items as (
      select p.received_on as day, p.channel, 'payments'::text as kind, p.id, p.amount_minor::bigint as cents,
             case when p.channel = 'card' then round(p.amount_minor * $5 / 10000.0)::bigint + $6 else 0 end as fee,
             p.purpose, p.unit_id, p.unit_name, p.is_national
      from pay p where not p.booked
      union all
      -- A refund is offered once the payment itself is in the books (or was skipped).
      select current_date, p.channel, 'refunds', p.id, (p.refunded_amount_minor - p.refund_booked)::bigint, 0,
             p.purpose, p.unit_id, p.unit_name, p.is_national
      from pay p where p.booked and p.refunded_amount_minor > p.refund_booked
    )
    select i.day, i.channel, i.kind, count(distinct i.id)::int, sum(i.cents)::bigint, sum(i.fee)::bigint,
           array_agg(distinct i.id),
           (select jsonb_agg(jsonb_build_object('purpose', g.purpose, 'unit_id', g.unit_id,
                     'unit_name', g.unit_name, 'is_national', g.is_national, 'cents', g.cents)
                     order by not g.is_national, g.unit_name, g.purpose)
            from (select i2.purpose, i2.unit_id, i2.unit_name, i2.is_national, sum(i2.cents)::bigint as cents
                  from items i2 where i2.day = i.day and i2.channel = i.channel and i2.kind = i.kind
                  group by 1, 2, 3, 4) g)
    from items i
    where i.cents > 0
    group by i.day, i.channel, i.kind
    order by i.day, i.kind, i.channel $q$
  using p_org, v_currency, s.starts_on, s.scope, s.fee_percent_bp, s.fee_fixed_cents;
end;
$$;

-- Note what a draft covered: after posting it (p_status 'posted', with its transaction) or when
-- skipping it. The amounts are read again here, and a payment already covered refuses the whole
-- call, so two people acting on the same draft can't book it twice.
create or replace function ledger.record_charter_import(p_org uuid, p_day date, p_channel text,
  p_kind text, p_status text, p_payment_ids uuid[], p_transaction_id uuid, p_fee_cents bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n int;
  v_gross bigint;
  v_ids uuid[];
  v_cents bigint[];
begin
  if not ledger.can_edit(p_org) then
    raise exception 'You can''t change these books.' using errcode = '42501';
  end if;
  if p_status not in ('posted', 'skipped') or p_kind not in ('payments', 'refunds')
     or p_channel not in ('card', 'other') or coalesce(cardinality(p_payment_ids), 0) = 0 then
    raise exception 'That isn''t a draft from OpenCharterApp.' using errcode = '22023';
  end if;
  if p_status = 'posted' and not exists (
       select 1 from ledger.transactions t where t.id = p_transaction_id and t.org_id = p_org) then
    raise exception 'The transaction for this draft wasn''t found.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger.charter_import:' || p_org::text, 0));
  if p_kind = 'payments' and exists (
       select 1 from ledger.charter_import_payments ip
       where ip.payment_id = any (p_payment_ids) and ip.kind = 'payments') then
    raise exception 'Some of these payments are already in the books. Refresh to see what''s left.'
      using errcode = '23505';
  end if;
  execute $q$
    select array_agg(c.id), array_agg(c.cents)
    from (select p.id,
                 case when $2 = 'payments' then p.amount_minor::bigint
                      else p.refunded_amount_minor - coalesce((select sum(ip.amount_cents) from ledger.charter_import_payments ip
                                                               where ip.payment_id = p.id and ip.kind = 'refunds'), 0) end as cents
          from charter.api_payments p
          where p.org_id = $1 and p.id = any ($3)) c
    where c.cents > 0 $q$
  into v_ids, v_cents
  using p_org, p_kind, p_payment_ids;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n <> cardinality(p_payment_ids) then
    raise exception 'This draft changed in OpenCharterApp. Refresh to see it as it is now.' using errcode = '40001';
  end if;
  select sum(x) into v_gross from unnest(v_cents) x;
  insert into ledger.charter_imports (org_id, day, channel, kind, status, transaction_id, payment_count,
    gross_cents, fee_cents, decided_by)
  values (p_org, p_day, p_channel, p_kind, p_status, case when p_status = 'posted' then p_transaction_id end,
    v_n, v_gross, coalesce(p_fee_cents, 0), auth.uid())
  returning id into v_id;
  insert into ledger.charter_import_payments (import_id, org_id, payment_id, kind, amount_cents)
  select v_id, p_org, u.id, p_kind, u.cents from unnest(v_ids, v_cents) as u(id, cents);
  return v_id;
end;
$$;

-- Bring back a skipped draft (a posted one is undone by voiding its transaction, then this).
create or replace function ledger.reopen_charter_import(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not ledger.can_edit(p_org) then
    raise exception 'You can''t change these books.' using errcode = '42501';
  end if;
  delete from ledger.charter_imports i
  where i.id = p_id and i.org_id = p_org
    and (i.status = 'skipped' or i.transaction_id is null
         or not exists (select 1 from ledger.transactions t where t.id = i.transaction_id and t.status::text <> 'void'));
  if not found then
    raise exception 'Only a skipped draft, or one whose transaction was voided, can come back.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function ledger.charter_import_config(uuid), ledger.save_charter_import_config(uuid, jsonb),
  ledger.charter_drafts(uuid), ledger.record_charter_import(uuid, date, text, text, text, uuid[], uuid, bigint),
  ledger.reopen_charter_import(uuid, uuid) from public, anon;
grant execute on function ledger.charter_import_config(uuid), ledger.save_charter_import_config(uuid, jsonb),
  ledger.charter_drafts(uuid), ledger.record_charter_import(uuid, date, text, text, text, uuid[], uuid, bigint),
  ledger.reopen_charter_import(uuid, uuid) to authenticated;
