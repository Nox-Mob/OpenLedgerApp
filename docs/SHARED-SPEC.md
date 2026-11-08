# OpenAppHub Suite — Shared Specification

**Every coding agent working on any repo in the suite must read this file in full before starting.**
Place it at `docs/SHARED-SPEC.md` in all four app repos (the docs repo has its own `AGENTS.md`). The repo-specific `AGENTS.md` refers to it.
If this file and a repo's `AGENTS.md` conflict, this file wins; stop and ask the owner.

---

## 0. Owner inputs (filled in by the owner before agents start)

| Input | Value |
|---|---|
| Apex domain | `<apex-domain>` (e.g. `openapphub.org`) |
| Design reference apps (the two that already share a design language) | `<app 1>`, `<app 2>` |
| Design outlier app (to be restyled to match) | `<app 3>` |
| GitHub org | `Nox-Mob` |
| Production Supabase project ref | `<prod-ref>` (the current OpenCharterApp project) |
| Staging Supabase project ref | `<staging-ref>` (the current OpenBoardApp project, reused after Board is migrated) |
| Prices confirmed (§6.1) | yes / no |
| Docs site | `https://docs.<apex-domain>` (repo `Nox-Mob/OpenAppHub-Docs`, §12) |

If any value is still a placeholder when you need it, **stop and ask the owner**. Never guess a domain, project ref or price.

---

## 1. Architecture at a glance

```
                    ┌──────────────────────────────┐
                    │  OpenAppHub  (<apex-domain>)  │  sign-up, login, orgs, members,
                    │  repo: Nox-Mob/OpenAppHub     │  billing (Stripe), suite dashboard
                    └──────────────┬───────────────┘
        shared session cookie on .<apex-domain>   │
   ┌───────────────────┬──────────┴────────┬───────────────────┐
   │ charter.<apex>    │ board.<apex>      │ ledger.<apex>     │
   │ OpenCharterApp    │ OpenBoardApp      │ OpenLedgerApp     │
   └─────────┬─────────┴─────────┬─────────┴─────────┬─────────┘
             └──────── one Supabase project ─────────┘
               schemas: public (core) · billing · ops
                        charter · board · ledger
```

- **Four app repos, four Cloudflare Pages sites, one Supabase project** (plus one staging project).
- **A fifth repo, `Nox-Mob/OpenAppHub-Docs`, is the user documentation** at `docs.<apex-domain>`, with one tab per app (§12). It has no database and no secrets.
- **The hub is the front door** in hosted mode: sign-up, login, organization creation, member invites and payments happen only there.
- **Each sub-app still works on its own** when self-hosted (its own Supabase, its own landing page and sign-up, no billing).
- **Everything shares one organization ID** (`public.organizations.id`). Every app table that holds org data has an `org_id` column referencing it.

### 1.1 Two modes, one codebase

Every app (including the hub) builds in one of two modes, chosen by the env var `VITE_HOSTED`:

| | Hosted (`VITE_HOSTED=true`) | Self-hosted (`VITE_HOSTED=false`, the default) |
|---|---|---|
| Landing page | Removed from routing; `/` goes to the app dashboard | Kept |
| Sign-up / login | Redirect to hub (`VITE_HUB_URL/login?next=…`) | App's own screens |
| Org and member management | Link out to hub | App's own screens (using core tables) |
| Billing | Enforced in the database (§5) | Off (`instance_settings.billing_enabled = false`) |
| Suite switcher | Shown | Hidden unless `VITE_SUITE_URLS` is set |

**Never fork or delete self-hosting code to make hosted mode work.** Gate it with the flag. Unused pages must be excluded from routing, not deleted.

---

## 2. Tech stack and conventions

- React + Vite + TypeScript + Tailwind + shadcn/ui (the existing Lovable stack). Keep it.
- Supabase JS v2 via `@supabase/ssr`'s `createBrowserClient` (needed for cookie sessions, §4).
- Package manager: whatever the repo already uses (check the lockfile). Don't switch.
- Remove Lovable leftovers: `lovable-tagger`, Lovable badges and scripts, and any `supabase/config.toml` pointing at old project IDs (after migration).
- Money is stored as `bigint` minor units (cents) or `numeric(14,2)`. Never `float`/`real`.
- All timestamps are `timestamptz`, stored in UTC.
- IDs are `uuid default gen_random_uuid()`.
- App IDs (used in code, SQL and billing): `hub`, `charter`, `board`, `ledger`.

### 2.1 Repo layout (all four repos)

```
/                     app source (src/, public/, …)
/db/core/             vendored core SQL (read-only in app repos, see §8)
/db/migrations/       this repo's own migrations, NNNN_description.sql
/db/seed/             demo seed data (idempotent, staging only)
/db/tests/            SQL tests for RLS
/scripts/migrate.mjs  vendored migration runner (§3.3)
/shared/              vendored shared code: design tokens, suite UI, supabase client helper
/supabase/functions/  Edge Functions (hub only, unless an app needs its own)
/docs/SHARED-SPEC.md  this file
/AGENTS.md            repo-specific instructions
/.env.example         every env var, no real values
```

### 2.2 How agents work

- One branch and one PR per task. Small PRs. Never push to `main` directly.
- Every PR must pass CI: typecheck, lint, build, and (if SQL changed) the DB test job.
- The PR description lists: what changed, any migration files, any manual owner steps, how it was tested, and the **docs** impact: the docs PR link, or "no user-facing change" (§12).
- **Agents never apply migrations to production and never run destructive SQL** (`drop`, `truncate`, `delete` without `where`, `alter … drop column`) except inside reviewed migration files that the owner explicitly approved in the PR.
- Agents never create, read or print real secrets. Use `.env.example` and tell the owner what to set and where.
- If something in this spec is impossible or wrong, stop and explain in the PR. Don't improvise around it.

---

## 3. Database

### 3.1 Schemas and ownership

| Schema | Owner repo | Contents | Exposed to Data API |
|---|---|---|---|
| `public` | OpenAppHub (canonical copy in `db/core/`) | Core: organizations, memberships, profiles, instance_settings, helper functions | yes (default) |
| `billing` | OpenAppHub | plans, subscriptions, Stripe event log | **no** |
| `ops` | OpenAppHub (created by the runner) | migration tracking | **no** |
| `charter` | OpenCharterApp | Charter tables | yes |
| `board` | OpenBoardApp | Board tables | yes |
| `ledger` | OpenLedgerApp | Ledger tables | yes |

**A repo only ever writes migrations for schemas it owns.** Need something in another schema? Open an issue on that repo.

The owner adds `charter`, `board` and `ledger` under Supabase → Project Settings → Data API → Exposed schemas.

### 3.2 Core schema (canonical; lives in OpenAppHub `db/core/`)

The hub agent writes these files exactly as specified (it may fix bugs; any change bumps the version in §8). The app repos vendor them unchanged. All statements must be **idempotent** (`if not exists`, `create or replace`, guarded `do` blocks), because the same core files run on self-hosted single-app databases too.

`db/core/0001_core.sql` must contain:

```sql
-- Instance settings (single row)
create table if not exists public.instance_settings (
  id boolean primary key default true check (id),
  billing_enabled boolean not null default false,
  hub_url text
);
insert into public.instance_settings (id) values (true) on conflict do nothing;

-- Roles
do $$ begin
  create type public.org_role as enum ('owner','admin','member','viewer');
exception when duplicate_object then null; end $$;

-- Organizations: THE shared org ID for the whole suite
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships(user_id);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.instance_settings enable row level security;
alter table public.organizations   enable row level security;
alter table public.memberships     enable row level security;
alter table public.profiles        enable row level security;
```

`db/core/0002_core_functions.sql` must define (all `security definer`, `set search_path = ''`, fully qualified names):

| Function | Returns | Behaviour |
|---|---|---|
| `public.is_member(p_org uuid)` | boolean | caller (`auth.uid()`) has any membership in org |
| `public.has_role(p_org uuid, p_roles public.org_role[])` | boolean | caller's role in org is in list |
| `public.has_app_access(p_org uuid, p_app text)` | boolean | **plpgsql**. If `instance_settings.billing_enabled` is false, return true. Otherwise return `billing.org_has_app_access(p_org, p_app)`. (plpgsql resolves the billing call at run time, so this compiles on self-hosted DBs that have no `billing` schema.) |
| `public.can_write(p_org uuid, p_app text)` | boolean | `has_role(p_org, '{owner,admin,member}') and has_app_access(p_org, p_app)` |
| `public.create_organization(p_name text)` | uuid | inserts org (`created_by = auth.uid()`) and an `owner` membership for the caller, then returns the id |
| `public.handle_new_user()` | trigger | inserts a `profiles` row for a new `auth.users` row |

Also in 0002:
- `drop trigger if exists on_auth_user_created on auth.users;` then recreate it to call `public.handle_new_user()`. (Lovable projects often already have a trigger with this name pointing at an old function.)
- `revoke all on function … from public, anon;` then `grant execute … to authenticated` for each helper.

`db/core/0003_core_policies.sql` (drop-if-exists then create each policy):

| Table | select | insert | update | delete |
|---|---|---|---|---|
| organizations | `is_member(id)` | none (use `create_organization`) | `has_role(id,'{owner,admin}')` | `has_role(id,'{owner}')` |
| memberships | `is_member(org_id)` | `has_role(org_id,'{owner,admin}')` | `has_role(org_id,'{owner,admin}')` | `has_role(org_id,'{owner,admin}') or user_id = auth.uid()` |
| profiles | own row, or shares an org with the caller | none (trigger) | own row | none |
| instance_settings | `authenticated` | none | none | none |

Add a trigger on memberships that blocks removing or demoting the last `owner` of an org.

### 3.3 Migrations: one database, four repos

`supabase db push` can't be shared by several repos (each repo would see the others' migrations as unknown). So every repo uses the same small **vendored runner** instead: `scripts/migrate.mjs` (Node, `pg` package).

Runner behaviour:
1. Connect using `DATABASE_URL`.
2. `create schema if not exists ops;` and create `ops.schema_migrations(repo text, version text, checksum text, applied_at timestamptz default now(), primary key (repo, version))`.
3. Take `pg_advisory_lock(424242)` so two repos can't migrate at once.
4. Apply `db/core/*.sql` under repo key `core`, then `db/migrations/*.sql` under this repo's key (`hub`, `charter`, `board`, `ledger`), in filename order, **each file in its own transaction**.
5. Skip files already recorded. If a recorded file's checksum differs from the file on disk, **fail loudly** (it means someone edited an applied migration, or `db/core` is out of date).
6. `--seed` flag: also run `db/seed/*.sql` (staging only; never production).
7. `--dry-run` flag: print what would run.

Rules:
- Never edit an applied migration. Add a new one.
- Every app migration that creates a table in its schema must also: enable RLS, add policies, and grant table privileges (§3.4).

**GitHub Actions** (`.github/workflows/migrate.yml`, same in every repo):
- On push to `main`: run against **staging** (`STAGING_DATABASE_URL`), with `--seed`. If the secret isn't set yet (staging doesn't exist until Board's old project is freed), skip the job with a notice instead of failing.
- `workflow_dispatch` with input `target: production`: run against **production** (`PROD_DATABASE_URL`), no seed. Only the owner triggers this.
- Connection strings must be the Supabase **Session pooler** string (port 5432 on the pooler host). The direct connection is IPv6-only on the free plan and GitHub runners can't reach it.

**CI DB tests** (`.github/workflows/ci.yml`, job `db`): start a local Supabase with `supabase start` (Docker is available on GitHub's Ubuntu runners), run the migration runner against it, then run `db/tests/*.sql` (plain SQL assertions or pgTAP). Tests must cover at least:
- a non-member can't read org data;
- a `viewer` can't write;
- with `billing_enabled = true` and an expired trial, members can read but not write.

### 3.4 App schema template (each sub-app)

```sql
create schema if not exists charter;
grant usage on schema charter to authenticated;
alter default privileges in schema charter
  grant select, insert, update, delete on tables to authenticated;

create table charter.example (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
  -- …
);
create index on charter.example(org_id);
alter table charter.example enable row level security;

create policy "read"   on charter.example for select using (public.is_member(org_id));
create policy "insert" on charter.example for insert with check (public.can_write(org_id,'charter'));
create policy "update" on charter.example for update using (public.can_write(org_id,'charter'))
                                                    with check (public.can_write(org_id,'charter'));
create policy "delete" on charter.example for delete using (public.can_write(org_id,'charter'));
```

That pattern is how **"subscription lapsed = read-only"** is enforced: reads only need membership, writes need `can_write`. Don't rely on the UI for this. The UI should also disable write controls and show a banner, but the database is the real guard.

`anon` gets nothing in app schemas unless a feature truly needs public access, and that must be approved by the owner.

### 3.5 Cross-app data ("data flows between them")

- Every app shares `org_id`, so cross-app links are just foreign keys or ids. For example, a Board decision can reference a Charter document id.
- An app exposes data to other apps **only** through read-only views in its own schema named `api_*`, created `with (security_invoker = true)` so the caller's RLS applies. Example: `charter.api_documents`.
- Consumers call them with `supabase.schema('charter').from('api_documents')`.
- **Consumers must feature-detect**: in self-hosted mode the other app may not exist. On error (missing schema/relation), hide the integration and don't crash.
- Never write into another app's schema. If an app needs to cause a change elsewhere, the owning app exposes an RPC `security invoker` function in its schema.
- Document every `api_*` view and RPC in the owning repo's `docs/INTEGRATION.md`.

### 3.6 Types

Add `.github/workflows/gen-types.yml` (`workflow_dispatch`). It runs `npx supabase gen types typescript --project-id $STAGING_REF --schema public,<app schema>` and opens a PR updating `src/integrations/supabase/types.ts`. It needs `SUPABASE_ACCESS_TOKEN`.

---

## 4. Auth and sessions

- One Supabase Auth for the whole suite. Users sign up once.
- **Shared session across subdomains** comes from cookie storage on the parent domain. Put this in `shared/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

const cookieDomain = import.meta.env.VITE_COOKIE_DOMAIN; // ".<apex-domain>" in hosted mode, empty when self-hosted

export const supabase = createBrowserClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    db: { schema: import.meta.env.VITE_APP_SCHEMA ?? 'public' },
    ...(cookieDomain
      ? { cookieOptions: { domain: cookieDomain, path: '/', sameSite: 'lax', secure: true } }
      : {}),
  },
);
// Core tables: supabase.schema('public').from('organizations')
```

- **Hosted login flow:** if there's no session, the sub-app redirects to `${VITE_HUB_URL}/login?next=<current URL>`. The hub validates `next` against an allowlist of suite origins (no open redirects) and sends the user back after login.
- **Current org:** stored in a cookie named `oah_org` on the parent domain, so switching org in one app carries to the others. Always re-check it against `memberships`. If it's invalid, fall back to the user's first org; if there are no orgs, send the user to the hub's "create organization" page.
- Sign-out in any app calls `supabase.auth.signOut()`, which clears the shared cookie and so signs the user out of every app.
- Session cookie names include the Supabase project ref, so staging and production sessions don't collide even under the same parent domain.
- Self-hosted mode: no cookie domain, normal per-site session, app's own login and sign-up pages.

---

## 5. Billing model (database side)

Owned by the hub repo, in schema `billing` (not exposed to the Data API).

- `billing.plans(id text pk, name, max_members int null, storage_gb int, apps_included int null, active bool)`. Rows: `starter`, `suite`, `plus` (§6.1). `apps_included null` = all apps.
- `billing.subscriptions(org_id uuid pk → organizations, plan_id → plans null, status text, apps text[] not null, trial_ends_at timestamptz, current_period_end timestamptz, cancel_at_period_end bool default false, stripe_customer_id text unique, stripe_subscription_id text unique, updated_at timestamptz)`.
  - `status` ∈ `trialing, active, past_due, canceled, unpaid, incomplete, expired`.
- `billing.stripe_events(id text pk, type text, received_at timestamptz default now())`, for webhook idempotency.
- `billing.org_has_app_access(p_org uuid, p_app text) returns boolean`. True when:
  - `status = 'trialing' and trial_ends_at > now()`, or
  - `status in ('active','past_due') and p_app = any(apps)`.
  - `past_due` keeps access while Stripe retries the payment.
- **Trial:** an `after insert` trigger on `public.organizations` (defined in the hub's billing migration, so it doesn't exist when self-hosted) inserts a subscriptions row with `status = 'trialing'`, `apps = '{charter,board,ledger}'` and `trial_ends_at = now() + interval '30 days'`.
  - **One trial per user:** if `created_by` already created an org that had a trial, the new org starts as `expired` and must subscribe.
- Member limit: a trigger on `public.memberships` insert (also in the hub billing migration) rejects inserts beyond `plans.max_members` when billing is enabled.
- `public.get_org_billing(p_org uuid)`: a `security definer` RPC returning plan, status, trial_ends_at, current_period_end and apps. It requires `is_member(p_org)`. This is how every app's UI reads billing state.
- The hub's billing migration ends with `update public.instance_settings set billing_enabled = true;`. That line is what turns enforcement on in hosted mode only.

---

## 6. Payments (Stripe; hub only)

### 6.1 Plans (owner may change prices; per organization, USD)

| Plan | Monthly | Yearly | Apps | Members | File storage |
|---|---|---|---|---|---|
| Trial | free, 30 days, no card | — | all 3 | 10 | 1 GB |
| Starter | $9 | $90 | 1 (chosen at checkout) | 10 | 1 GB |
| Suite | $19 | $190 | all 3 + hub | 25 | 5 GB |
| Plus | $49 | $490 | all 3 + hub | unlimited | 25 GB, priority support |
| Self-hosted | free (open source) | — | any | unlimited | your own |

When the trial or subscription ends, the org becomes read-only and can still export its data.

### 6.2 Implementation

- The owner creates the products and prices in the Stripe dashboard (test mode first) and stores the IDs in the Edge Function secret `STRIPE_PRICE_MAP`. It's a JSON object: `{"starter_monthly":"price_…","starter_yearly":"price_…","suite_monthly":"price_…", …}`. Agents never hard-code price IDs.
- Edge Functions in OpenAppHub `supabase/functions/`:
  - **`create-checkout-session`** (JWT required): input `{org_id, plan, interval, app?}`.
    - Verify the caller is owner/admin of the org.
    - Reuse or create the Stripe customer (store `stripe_customer_id`).
    - Create a Checkout Session with `mode: 'subscription'`, `client_reference_id: org_id`, and `subscription_data.metadata = {org_id, plan, app}`.
    - Success and cancel URLs come from `SITE_URL`.
  - **`create-portal-session`** (JWT required, owner/admin): returns a Stripe Customer Portal URL.
  - **`stripe-webhook`** (`verify_jwt = false` in `supabase/config.toml`):
    - Verify the signature with `stripe.webhooks.constructEventAsync` and `STRIPE_WEBHOOK_SECRET`.
    - Skip events already in `billing.stripe_events`.
    - Handle `checkout.session.completed` and `customer.subscription.created|updated|deleted`: map price → plan via `STRIPE_PRICE_MAP`, then set `status`, `plan_id`, `apps`, `current_period_end` and `cancel_at_period_end`.
    - Handle `invoice.payment_failed` (status follows the subscription object).
    - Writes use the service-role client inside the function only.
- CORS on JWT functions: allow only the suite origins.
- Sub-apps never call Stripe. They show billing state from `get_org_billing` and link to `${VITE_HUB_URL}/billing`.
- Go live only after the owner has tested the full cycle in Stripe test mode: trial → checkout → renewal → failed payment → cancel → read-only.

---

## 7. Secrets and environment variables

**Rule: anything that starts with `VITE_` ends up in the browser and is public.** Only publishable values go there.

| Variable | Where it lives | Public? | Used by |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Cloudflare Pages env | yes | all |
| `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable/anon key) | Cloudflare Pages env | yes | all |
| `VITE_HOSTED` | Cloudflare Pages env | yes | all |
| `VITE_APP_ID`, `VITE_APP_SCHEMA` | Cloudflare Pages env / defaults in code | yes | all |
| `VITE_HUB_URL` | Cloudflare Pages env | yes | sub-apps |
| `VITE_COOKIE_DOMAIN` (`.<apex-domain>`) | Cloudflare Pages env | yes | all (hosted) |
| `VITE_SUITE_URLS` (JSON of app → URL) | Cloudflare Pages env | yes | all |
| `VITE_DOCS_URL` (default `https://docs.<apex-domain>`) | Cloudflare Pages env / default in code | yes | all (Help links, §12) |
| `STRIPE_SECRET_KEY` | Supabase Edge Function secrets | **NO** | hub functions |
| `STRIPE_WEBHOOK_SECRET` | Supabase Edge Function secrets | **NO** | stripe-webhook |
| `STRIPE_PRICE_MAP` | Supabase Edge Function secrets | no (keep private) | hub functions |
| `SITE_URL`, `ALLOWED_ORIGINS` | Supabase Edge Function secrets | no | hub functions |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | provided automatically inside Edge Functions | **NO** | functions only |
| `STAGING_DATABASE_URL`, `PROD_DATABASE_URL` | GitHub Actions secrets | **NO** | migrate.yml |
| `SUPABASE_ACCESS_TOKEN`, `STAGING_REF`, `PROD_REF` | GitHub Actions secrets | **NO** | gen-types, function deploy |

Rules:
- The service-role/secret key, Stripe secret key, webhook secret and database passwords **never** go into frontend code, `VITE_*` vars, the repo, logs or PR text.
- Commit `.env.example` with every variable and placeholder values. `.env*` (except `.env.example`) must be in `.gitignore`.
- **First task in every repo:** scan the files and git history for committed secrets (service-role keys, `sb_secret_`, `sk_live_`, `sk_test_`, DB passwords). If any are found, don't remove the history yourself. Tell the owner in the PR so they can rotate the key in Supabase/Stripe.
- Enable GitHub secret scanning and push protection (owner setting) on all four public repos.
- Edge Functions deploy from the hub repo via a `workflow_dispatch` workflow using `SUPABASE_ACCESS_TOKEN`: `supabase functions deploy <name> --project-ref <ref>`.

---

## 8. Shared code ("vendored" folder)

The hub repo holds the canonical `shared/` and `db/core/`. Each app repo keeps a copy.

```
shared/VERSION                 e.g. 1.0.0
shared/design/tokens.css       CSS variables (light + dark)
shared/design/tailwind-preset.ts
shared/design/DESIGN.md        the design rules (§9)
shared/ui/AppShell.tsx         layout: sidebar + top bar
shared/ui/SuiteSwitcher.tsx    links to the other apps (hidden when not configured)
shared/ui/OrgSwitcher.tsx      reads memberships, sets oah_org cookie
shared/ui/BillingBanner.tsx    trial / read-only banner from get_org_billing
shared/supabase/client.ts      §4
shared/supabase/org.ts         current-org helpers
shared/docs.ts                 docsUrl() and help-link helpers (§12.3)
db/core/*.sql                  §3.2
scripts/migrate.mjs            §3.3
```

- In app repos these files are **read-only**. Don't edit them there. Change the hub, bump `shared/VERSION`, then copy the folder into each app in a PR titled `chore: sync shared vX.Y.Z`.
- Each app's CI checks that `shared/VERSION` matches the version pinned in `package.json` → `"oahShared": "X.Y.Z"`, to catch half-synced copies.

---

## 9. Design system (one look for the whole suite)

Goal: the four apps feel like one product. Each app gets its own accent colour; everything else is identical.

- **Source of truth:** the two reference apps in §0. The hub agent extracts their shared tokens: colours as HSL CSS variables in the shadcn convention (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`, …), typography (font families, scale, weights), spacing, radii, shadows and icon set. It writes them into `shared/design/`.
- **Per-app accent:** `--app-accent` and `--app-accent-foreground`, set by `VITE_APP_ID`. The hub uses the neutral primary. The owner approves accent colours in the first design PR.
- **Components:** shadcn/ui components themed only through tokens. No hard-coded colours (`#hex`, `bg-blue-500`, etc.) in app code. Use token classes.
- **Layout:** every app uses `AppShell`: a left sidebar for app navigation, and a top bar with SuiteSwitcher, OrgSwitcher, BillingBanner and user menu. The user menu has a **Help** item that opens the app's docs tab (§12.3). It collapses to a drawer below 768px (the apps must work on phones).
- **Dark mode:** supported via `class` strategy, following the system preference, with a toggle in the user menu.
- **Accessibility:** text contrast ≥ 4.5:1, visible focus rings, every control reachable by keyboard, labels on all inputs.
- **The outlier app** (§0) restyles to the tokens and AppShell **without changing behaviour**. Do it in its own PRs, separate from data/auth work, with before/after screenshots.
- The design will go through a few revisions. Keep every visual decision in tokens and `DESIGN.md`, so a revision is a token change plus a `shared` sync, not edits across four codebases.

---

## 10. Hosting (Cloudflare Pages)

- One Pages project per repo, connected via GitHub. Build command: `npm run build` (or the repo's equivalent). Output: `dist`.
- SPA routing: `public/_redirects` containing `/* /index.html 200`.
- Domains: hub → `<apex-domain>`; apps → `charter.<apex-domain>`, `board.<apex-domain>`, `ledger.<apex-domain>`; docs → `docs.<apex-domain>` (a Cloudflare Worker serving static files, configured by the docs repo's `wrangler.jsonc`).
- Production env vars point at the production Supabase project; Preview env vars point at staging.
- Security headers in `public/_headers`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and a CSP that allows only self plus the Supabase URL (and Stripe on the hub).

---

## 11. Definition of done (every repo)

- [ ] Builds and runs in both modes (`VITE_HOSTED=true` and `false`).
- [ ] All tables in this repo's schema have `org_id`, RLS and policies following §3.4. DB tests pass.
- [ ] No secrets in code or history (or the owner has been told).
- [ ] `.env.example`, `README.md` (self-hosting steps + hosted notes) and `docs/INTEGRATION.md` are up to date.
- [ ] Uses `shared/` at the current version. No hard-coded colours.
- [ ] Data export (CSV or JSON of all org data in this app) is available to org owners/admins, including when read-only.
- [ ] Lovable leftovers are removed.
- [ ] Every user-facing change has a matching docs PR, and the app's in-app Help links resolve (§12).

---

## 12. Documentation site

User documentation lives in its own repo, **`Nox-Mob/OpenAppHub-Docs`**, published at `https://docs.<apex-domain>`. It's built with Astro Starlight and deployed by Cloudflare on every push to `main`. Read that repo's `AGENTS.md` before editing it.

### 12.1 Where each app's pages live

| Tab | Folder in the docs repo | Owner repo |
|---|---|---|
| OpenAppHub (suite: accounts, hosting, plans, data, help) | `src/content/docs/hub/` | OpenAppHub |
| OpenCharterApp | `src/content/docs/charter/` | OpenCharterApp |
| OpenBoardApp | `src/content/docs/board/` | OpenBoardApp |
| OpenLedgerApp | `src/content/docs/ledger/` | OpenLedgerApp |

Each app tab has a `help/` folder with `faq.md`, `troubleshooting.md`, `known-limits.md`, `self-hosting.md` and `glossary.md`. A page's URL is its path without `.md`, for example `charter/members/importing.md` → `https://docs.<apex-domain>/charter/members/importing/`.

### 12.2 Docs change with the code

A PR in an app repo that changes anything a user sees (a screen, button label, message, permission, limit, setting or workflow) needs a **matching PR in the docs repo**:

- Update the feature's page, using the app's exact on-screen words in **bold**.
- Changed or new error message → update `help/troubleshooting.md`.
- Something listed in `help/known-limits.md` now works → move it out of Known limits and document it.
- New term → add it to `help/glossary.md`.
- Self-hosting steps or settings changed → update `help/self-hosting.md` (and the suite page `hub/hosting/self-hosting.md` if it applies to every app).
- Link the two PRs to each other. Merge the docs PR **after** the app change is live, so the docs never describe something users can't do yet.
- Docs describe what the app does **today**. Planned features go in Known limits or a `:::note[Not available yet]` callout, never as instructions.
- Before opening the docs PR, run `npm ci && npm run build && npm run check:links` in the docs repo; it must pass with no broken links.

If an agent can't open a PR in the docs repo, it writes the required docs changes into the app PR's description under **Docs changes needed**, so the owner can apply them.

### 12.3 Help links in the apps

- `shared/docs.ts` exports `docsUrl(path)`, built from `VITE_DOCS_URL`, and a map of help topics to docs paths for the current app, for example `{ importMembers: 'charter/members/importing/' }`.
- The user menu's **Help** item opens the app's tab: `docsUrl('<app>/')`.
- Screens with a non-obvious task (setup flows, imports, statement checks, live voting, billing) show a small "Help" link to their docs page, opened in a new tab.
- Self-hosted builds keep the links pointing at the public docs unless `VITE_DOCS_URL` is set.
- A unit test checks that every path in the app's help map exists in the docs repo's page list. The docs repo publishes `sitemap-index.xml`; test against a checked-in copy of the page list, refreshed when docs change.

### 12.4 Suite pages and pricing

- The hub repo owns the `hub/` tab.
- `hub/hosting/plans.md` is a **draft** (`draft: true`) until the owner confirms prices and hosted billing is live. When it's published, its numbers must match `src/config/pricing.ts` in OpenAppHub and the Stripe prices. Prices appear on no other docs page.
- When the shared sign-in and shared organizations (§4) go live, update `hub/start/how-the-apps-fit.md`, `hub/accounts/signing-in.md` and `hub/accounts/invitations.md`, which currently say each app has its own sign-in.
