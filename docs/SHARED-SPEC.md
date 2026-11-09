# OpenAppHub Suite — Shared Specification (v2)

**Every coding agent working on any repo in the suite must read this file in full before starting.**
Place it at `docs/SHARED-SPEC.md` in all four app repos (the docs repo has its own `AGENTS.md`).
If this file and a repo's `AGENTS.md` conflict, this file wins; stop and ask the owner.

**v2.2 (2026-11-09, owner changes):** the design direction is chosen ("Civic, slightly warm", §9); dark mode is Light / Dark / System, shared across the suite (§9); money and dates use `shared/format.ts` in every app (§9); **deploys use Cloudflare's Git integration: merging to `main` deploys production** (§10.2), so the `CLOUDFLARE_*` GitHub secrets and `release.yml` are gone (§7.1); pull request descriptions carry no "Generated with Claude Code" line or session link (§2.2).

**v2.1 (2026-11-08, owner change):** the suite starts from **fresh databases**. The old Supabase projects are being deleted; nothing is copied or parked, and there is no legacy schema. `VITE_SUITE_URLS` is a JSON object (§7.1). Changes are in §0.1, §3.1 and §7.1.

**v2 (2026-11-08)** replaces v1. It answers the questions raised in each repo's `docs/MIGRATION-NOTES.md` (§0.2). Each repo's notes remain its step-by-step plan; where a note proposed something this spec now settles differently, this spec wins and the agent updates the note in its next PR.

---

## 0. Owner inputs and decisions

### 0.1 Inputs

| Input | Value |
|---|---|
| Apex domain | `openapphub.org` |
| GitHub org | `Nox-Mob` |
| Production Supabase project | `openapphub-prod`, a **new, empty** project: ref `ymlesgadawnjupnvgokd` (`https://ymlesgadawnjupnvgokd.supabase.co`). Publishable key in each repo's `wrangler.jsonc` production `vars` |
| Staging Supabase project | `openapphub-staging`, a **new, empty** project: ref `mbloxixlykmbuuoaprnx` (`https://mbloxixlykmbuuoaprnx.supabase.co`). Publishable key in each repo's `wrangler.jsonc` staging `vars`. Local development uses staging, never production |
| Old projects | `nxungwtxnctcqolfshcr` and `dnsqxiiexkdokgebysrt` are being **deleted**. Never use their IDs. Nothing is copied or parked from them; there is no legacy schema |
| Production database order | hub core (+ hub billing later) → Charter baseline → Board baseline → Ledger baseline. Staging: the same, plus each repo's seed data, once it exists |
| Design | **Full refresh** for all four apps (§9). No existing app is the reference. |
| Docs site | `https://docs.openapphub.org`, repo `Nox-Mob/OpenAppHub-docs` (§12) |
| Prices | **Not confirmed** (§6.1). Don't put prices anywhere except `pricing.ts` and the draft plans page. |

If a value you need is still missing, **stop and ask the owner**. Never guess a project ref or price.

### 0.2 Owner decisions (answers to the migration notes)

| # | Decision | Where it's specified |
|---|---|---|
| 1 | **Every app must run on its own when self-hosted.** Everything the hub takes over in hosted mode is built so a single self-hosted app still has it. | §1.2 |
| 2 | Apps run on **Cloudflare Workers** (TanStack Start with SSR), not Pages. The hub uses the same stack. | §2, §10 |
| 3 | **Ownership** of every organization lives in the core; ownership **transfer happens in the hub** (hosted). Exactly one owner per org. | §3.2, §4.4 |
| 4 | **Invitations are handled by the hub** through core tables and functions. Each app may show its own invitation page, but acceptance always goes through the core. | §4.3 |
| 5 | **New OpenCharterApp members sign up at the hub**, then join and pay dues on a signed-in join screen in Charter (option (a) of Charter F2). | §4.5 |
| 6 | Charter: the **top of the tree** (national or standalone) is the core organization; chapters and regions live in `charter.units`. **Only staff count** toward plan member limits; dues-paying members get Charter-only portal access. | §3.9, §5 |
| 7 | Core roles are the outer gate; each app keeps a **role overlay** for its own roles (Charter permissions, Board officers, Ledger treasurer). | §3.5 |
| 8 | A core **member directory** function provides names and emails; new accounts store the sign-up name. | §3.2 |
| 9 | **Demo data runs on staging only.** Never on production. The hub owns platform operators and demo organizations. | §11 |
| 10 | Charter's dues webhooks keep recording payments while an org is read-only. | §6.3 |
| 11 | The service-role key is allowed only on an approved list. | §7.2 |
| 12 | Ledger's AI PDF import is **off** until the owner picks a provider. | Ledger AGENTS |
| 13 | Storage buckets are prefixed with the app's name. | §3.7 |
| 15 | **Design:** "Civic, slightly warm"; dark mode a soft graphite gray; Light / Dark / System toggle that becomes the suite-wide default. | §9, `shared/design/DESIGN.md` |
| 16 | **Deploys:** Cloudflare's Git integration builds and deploys `main` (production) with `npm run build` + `npx wrangler deploy`. No Cloudflare API token in GitHub. | §10.2 |
| 17 | **Pull requests:** no "Generated with Claude Code" line and no session link in PR descriptions. Mandatory. | §2.2 |
| 14 | Accepted as proposed: Ledger keeps its own MFA check; each app audits only its own tables; Charter's public join page is self-hosted only; old deploy jobs are switched off so one tool writes to production. | various |

---

## 1. Architecture

```
                          ┌────────────────────────────────┐
                          │ OpenAppHub   openapphub.org     │  sign-up, login, orgs, members,
                          │ repo Nox-Mob/OpenAppHub         │  invitations, ownership, billing
                          └───────────────┬────────────────┘
          shared session cookie on .openapphub.org         │
   ┌───────────────────────┬──────────────┴─────┬───────────────────────┐
   │ charter.openapphub.org │ board.openapphub.org│ ledger.openapphub.org │
   │ OpenCharterApp         │ OpenBoardApp        │ OpenLedgerApp         │
   └───────────┬───────────┴──────────┬─────────┴───────────┬───────────┘
               └────────── one Supabase project ─────────────┘
                 schemas: public (core) · billing · hub · ops
                          charter · board · ledger

   docs.openapphub.org  ← Nox-Mob/OpenAppHub-docs (static, no database)
```

- Four app repos, each deployed as a **Cloudflare Worker**, all using one production Supabase project (plus one staging project).
- The hub is the front door in hosted mode.
- **Everything shares one organization ID**, `public.organizations.id`. Every app table holding org data has `org_id` referencing it.

### 1.1 Two modes, one codebase

Every app (including the hub) builds in one of two modes, chosen by `VITE_HOSTED`:

| | Hosted (`VITE_HOSTED=true`) | Self-hosted (`VITE_HOSTED=false`, default) |
|---|---|---|
| Landing page | Out of routing; `/` goes to the app | Kept |
| Sign-up / sign-in | Hub (`VITE_HUB_URL/login?next=…`) | App's own screens |
| Create, rename, delete an org | Hub | App's own screens |
| Members, roles, invitations | Hub (an app may host the accept page, §4.3) | App's own screens |
| Ownership transfer | Hub | App's own screen |
| Account deletion | Hub | App's own screen (if it has one) |
| App-specific roles (overlays, §3.5) | The app | The app |
| Billing | Enforced in the database (§5) | Off (`instance_settings.billing_enabled = false`) |
| Suite switcher | Shown | Hidden unless `VITE_SUITE_URLS` is set |
| Charter public join page | Signed-in join screen only (§4.5) | Public, with the app's own sign-up |

**Never fork or delete self-hosting code to make hosted mode work.** Gate it with the flag. Unused routes are excluded from routing, not deleted.

### 1.2 The rule that keeps every app standalone

> **Logic lives in the core (`db/core/`). In hosted mode the hub provides the screens; in self-hosted mode the app provides them. Both call the same core functions.**

Invitations, ownership transfer, organization creation and deletion, and the member directory are all core functions (§3.2). The hub owns the canonical copy of `db/core/`; every app vendors it (§8), so a self-hosted app gets the same functions on its own database. An app's self-hosted screens may only call core functions and its own schema, never the hub's `hub` schema.

---

## 2. Tech stack and conventions

- **TanStack Start (React, SSR) on Cloudflare Workers**, with Tailwind and shadcn/ui. This is what Charter, Board and Ledger already use; the new hub uses it too, so shared components work everywhere.
- Server-side code runs as TanStack Start **server functions and server routes** on the Worker. Supabase Edge Functions are not used.
- Browser auth uses `@supabase/ssr`'s `createBrowserClient` (cookie sessions, §4.1). Server functions keep receiving the user's access token from the browser (each repo's existing `auth-attacher` / `auth-middleware`) and act as that user.
- Package managers stay as they are: **Charter: Bun.** **Board, Ledger, hub: npm.** Check the lockfile; never switch.
- **Remove Lovable:** `@lovable.dev/*` packages (including the Vite config wrapper and the OAuth broker), `previewAuthStorage`, Lovable hosts, `.lovable/`, the Lovable notes in `AGENTS.md`, `drizzle/` once nothing reads it, and `supabase/config.toml` pointing at old projects. Google sign-in uses plain `supabase.auth.signInWithOAuth` (self-hosted) or the hub (hosted).
- **Disconnect each repo from Lovable** (owner step) **before** its Phase 2 database work reaches `main`. Moving tables out of `public` breaks Lovable's editor.
- Money: `bigint` cents, or `numeric(14,2)`. Never `float`/`real`.
- Timestamps: `timestamptz`, UTC. IDs: `uuid`, `default gen_random_uuid()` as a fallback where the app supplies its own ids.
- App IDs: `hub`, `charter`, `board`, `ledger`.

### 2.1 Repo layout (all four app repos)

```
/src/...                 app source
/db/core/                vendored core SQL (read-only in app repos, §8)
/db/migrations/          this repo's own migrations, NNNN_description.sql
/db/seed/                demo and seed data (staging only, §11)
/db/tests/               SQL tests for RLS and rules
/scripts/migrate.mjs     vendored migration runner (§3.3)
/shared/                 vendored shared code (§8)
/docs/SHARED-SPEC.md     this file
/docs/MIGRATION-NOTES.md this repo's inventory and step plan
/AGENTS.md               repo-specific rules (suite section + the repo's own rules)
/wrangler.jsonc          Worker config (§10)
/.env.example            every env var, no real values
```

### 2.2 How agents work

- One branch and one PR per step. Small PRs. Never push to `main` directly.
- Every PR must pass CI: typecheck, lint, tests, build, and (if SQL changed) the DB test job.
- The PR description lists: what changed, migration files, owner steps, how it was tested, and the **docs** impact (§12).
- **PR descriptions never include a "Generated with Claude Code" line or a link to the agent session** (owner rule, mandatory).
- **Commit messages never include a "Co-Authored-By: Claude" line or a session link** (owner rule, mandatory).
- **Agents never apply migrations to production, never deploy production, and never run destructive SQL** (`drop`, `truncate`, unqualified `delete`, `alter … drop column`) except inside reviewed migration files the owner approved.
- Agents never create, read or print real secrets.
- The repo's own `AGENTS.md` rules still apply unless this spec replaces them. Each repo's `MIGRATION-NOTES.md` §7 (or equivalent) lists which rules are replaced and in which step.
- If something in this spec is impossible or wrong for your repo, stop and explain in the PR.

---

## 3. Database

### 3.1 Schemas and ownership

| Schema | Owner repo | Contents | Exposed to Data API |
|---|---|---|---|
| `public` | OpenAppHub (`db/core/`) | Core: organizations, memberships, profiles, invitations, instance settings, core functions | yes |
| `billing` | OpenAppHub | plans, subscriptions, Stripe event log | no |
| `hub` | OpenAppHub | hub-only: platform operators, demo-org registry, audit of core tables, legal acceptances, waitlist | no |
| `ops` | created by the runner | migration tracking | no |
| `charter` | OpenCharterApp | Charter tables | yes |
| `board` | OpenBoardApp | Board tables | yes |
| `ledger` | OpenLedgerApp | Ledger tables | yes |

**A repo only writes migrations for schemas it owns.** Need something in another schema (including core)? Open an issue on that repo.

The owner adds `charter`, `board` and `ledger` under Supabase → Data API → Exposed schemas.

### 3.2 Core (canonical in OpenAppHub `db/core/`)

All core SQL is **idempotent** (`if not exists`, `create or replace`, guarded blocks), because the same files run on self-hosted single-app databases. All functions: `security definer`, `set search_path = ''`, fully qualified names; `revoke … from public, anon`, `grant execute … to authenticated` unless stated.

**`0001_core.sql` — tables**

| Table | Columns | Notes |
|---|---|---|
| `instance_settings` | `id bool pk default true check (id)`, `billing_enabled bool default false`, `hub_url text` | single row |
| `organizations` | `id uuid pk`, `name text check (1–120 chars)`, `slug text unique`, `created_by uuid → auth.users on delete set null`, `created_at` | THE shared org ID |
| `memberships` | `org_id → organizations on delete cascade`, `user_id → auth.users on delete cascade`, `role public.org_role`, `created_at`; pk `(org_id, user_id)` | enum `org_role`: owner, admin, member, viewer. Partial unique index **one owner per org** |
| `profiles` | `id uuid pk → auth.users on delete cascade`, `display_name`, `avatar_url`, `updated_at` | |
| `invitations` | `id uuid pk`, `org_id`, `email text`, `role public.org_role null`, `app text null`, `app_payload jsonb not null default '{}'`, `token_hash text unique`, `expires_at`, `invited_by`, `created_at`, `accepted_by`, `accepted_at`, `revoked_at` | §4.3. `role` null = app-only invitation (for example a Charter portal member) |

RLS on all of them.

**`0002_core_functions.sql`**

| Function | Behaviour |
|---|---|
| `is_member(p_org)` | caller has a membership in org |
| `has_role(p_org, p_roles org_role[])` | caller's role is in the list |
| `has_app_access(p_org, p_app)` | plpgsql. `billing_enabled` false → true; else `billing.org_has_app_access(p_org, p_app)` (resolved at run time, so it compiles without `billing`) |
| `can_write(p_org, p_app)` | `has_role(p_org,'{owner,admin,member}') and has_app_access(p_org,p_app)` |
| `create_organization(p_name)` → uuid | inserts org with `created_by = auth.uid()` and an `owner` membership |
| `rename_organization(p_org, p_name)` | owner/admin |
| `delete_organization(p_org, p_confirm_name)` | owner only; confirm name must match exactly. Deletes the org; every app table cascades through its `org_id` foreign key |
| `transfer_ownership(p_org, p_new_owner)` | caller must be the owner; new owner must already be a member; new owner → `owner`, caller → `admin`, in one transaction |
| `ownership_transfer_candidates(p_org)` | members who can receive ownership (owner only) |
| `create_invitation(p_org, p_email, p_role, p_app, p_payload, p_days default 14)` → `(invitation_id, token)` | owner/admin. Stores only the token hash. Returns the raw token once. `p_role` null requires `p_app` |
| `get_invitation(p_token)` | **granted to `anon`**. Returns org name, role, app, email (masked), expired/used/revoked status. Nothing else |
| `accept_invitation(p_token)` → invitation row | caller signed in; email must match unless the invitation has no email; single use; not expired or revoked. If `role` is set, inserts the membership. Marks accepted. Returns `id, org_id, role, app, app_payload` |
| `revoke_invitation(p_id)`, `list_invitations(p_org)` | owner/admin |
| `org_member_directory(p_org)` | `is_member(p_org)`. Returns `user_id, display_name, email, role` for the org's members |
| `handle_new_user()` | trigger on `auth.users`: creates the profile, with `display_name` from `raw_user_meta_data` `full_name`, else `name`, else the email's local part |

Also in 0002: `drop trigger if exists on_auth_user_created on auth.users;` then recreate it.

**`0004_core_org_settings.sql`** (shared 1.2.0)

| Item | Behaviour |
|---|---|
| `organizations.time_zone` (default `UTC`), `organizations.currency` (default `USD`, `^[A-Z]{3}$`) | The org's time zone and currency. Every app passes them to `shared/format.ts` (`getOrgPreferences()` in `shared/supabase/org.ts`, which falls back to UTC / USD) |
| `set_organization_preferences(p_org, p_time_zone, p_currency)` | owner/admin; time zone must be in `pg_timezone_names`; currency upper-cased, three letters |
| `ownership_transfer_candidates(p_org)` | now only **active** members: email confirmed and not banned |
| `transfer_ownership(p_org, p_new_owner)` | now also requires an active new owner |
| `transfer_ownership(p_org, p_new_owner, p_confirm)` | the form the hub uses: `p_confirm` must be the new owner's display name, or their email when they have none, ignoring case and surrounding spaces |

**`0003_core_policies.sql`** (drop-if-exists, then create)

| Table | select | insert | update | delete |
|---|---|---|---|---|
| organizations | `is_member(id)` | none (use `create_organization`) | none (use `rename_organization`) | none (use `delete_organization`) |
| memberships | `is_member(org_id)` | none (use `accept_invitation` / `create_organization`) | `has_role(org_id,'{owner,admin}')`, role may not become or stop being `owner` | `has_role(org_id,'{owner,admin}') or user_id = auth.uid()`, never the owner |
| profiles | own row, or shares an org | none (trigger) | own row | none |
| invitations | `has_role(org_id,'{owner,admin}')` | none (functions) | none | none |
| instance_settings | `authenticated` | none | none | none |

A trigger enforces that the owner can only change through `transfer_ownership` (which sets a transaction-local flag such as `app.ownership_transfer`), and that an org always has exactly one owner.

### 3.3 Migrations: one database, four repos

Every repo uses the same vendored runner, `scripts/migrate.mjs` (Node, `pg`):

1. Connect with `DATABASE_URL`.
2. Create `ops` and `ops.schema_migrations(repo, version, checksum, applied_at, pk (repo, version))`.
3. Take `pg_advisory_lock(424242)`.
4. Apply `db/core/*.sql` under key `core`, then `db/migrations/*.sql` under the repo's key, in filename order, each file in its own transaction.
5. Skip recorded files; **fail loudly** if a recorded file's checksum changed.
6. `--seed`: also run `db/seed/*.sql` (staging only). `--dry-run`: print the plan. `--skip <name>`: skip a named migration (for self-hosters skipping the hub's billing).

Rules:
- Never edit an applied migration.
- Every table a migration creates gets RLS, policies and grants (§3.4).
- **Retire the repo's old tooling in the same PR that adds the runner:** switch off any job that runs `supabase db push` or applies `supabase/migrations/` / `drizzle/`, so only one tool ever writes to production. Point migration-lint scripts (Charter's `check:migrations`, Ledger's `check-migrations.mjs`) at `db/`.

**Workflows** (`.github/workflows/`, same pattern in every repo, see §10.2 for deploys):
- `migrate.yml`: `workflow_dispatch` with input `target: staging | production`. Production runs only when the owner triggers it.
- Connection strings are the Supabase **Session pooler** strings (port 5432 on the pooler host); GitHub runners can't reach the IPv6-only direct connection.

**CI DB tests** (`ci.yml`, job `db`): `supabase start` → runner → `db/tests/*.sql`. At minimum: non-members can't read; `viewer` can't write; with billing on and an expired trial, members read but can't write; app overlay rules (§3.5).

### 3.4 App schema template

```sql
create schema if not exists board;
grant usage on schema board to authenticated;
alter default privileges in schema board
  grant select, insert, update, delete on tables to authenticated;

create table board.example (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on board.example(org_id);
alter table board.example enable row level security;

create policy "read"   on board.example for select using (public.is_member(org_id));
create policy "insert" on board.example for insert with check (board.can_edit(org_id));
create policy "update" on board.example for update using (board.can_edit(org_id)) with check (board.can_edit(org_id));
create policy "delete" on board.example for delete using (board.can_edit(org_id));
```

- Every app defines its own write helper (`<app>.can_edit(org)` or finer ones), which **always includes `public.can_write(org, '<app>')`** and then adds the app's own rule (§3.5). That's how "subscription lapsed = read-only" applies everywhere.
- The database is the guard; the UI also disables controls and shows a banner.
- `anon` gets nothing in app schemas unless the owner approves it (approved: Charter's join-page lookups, **self-hosted only**, §4.5).
- App-specific org settings go in `<app>.org_settings (org_id pk → public.organizations on delete cascade, …)`. A missing row means defaults, so orgs created in the hub need no setup in the app.

### 3.5 App role overlays

Core has four roles. Apps that need more keep an overlay in their own schema, managed by the org's owner/admin (in the app, in both modes):

| App | Overlay | Rule |
|---|---|---|
| Charter | Charter's roles and permissions (custom roles, permission keys, downward inheritance) in `charter.*` | Write = `public.can_write(org,'charter')` **and** the Charter permission. Core `owner`/`admin` ⇒ Charter `org_admin` at the top unit |
| Board | `board.officers (org_id, user_id, office)`; office ∈ chair, secretary, treasurer | Edit records = `public.can_write(org,'board')` and (`has_role(org,'{owner,admin}')` or office ∈ chair, secretary). Board members = core `member`; observers = core `viewer` |
| Ledger | `ledger.member_roles (org_id, user_id, role)`; role = `treasurer` | Treasurer requires core `member` or higher. Close books etc. = `can_write` and (`owner`/`admin` or treasurer) |

Overlays never grant more than the core role allows to read, and they never bypass `can_write`.

### 3.6 Cross-app data

- Cross-app links are stored ids. An app exposes data to others **only** through read-only `api_*` views in its own schema, `with (security_invoker = true)`.
- Consumers **feature-detect**: if the schema or view is missing (self-hosted), hide the integration.
- Never write into another app's schema. To cause a change elsewhere, the owning app exposes a `security invoker` RPC.
- Document every view and RPC in the owning repo's `docs/INTEGRATION.md`.
- First integrations: Board publishes `board.api_meetings` and `board.api_decisions`; Charter publishes `charter.api_units` and `charter.api_board_seats`; Ledger publishes `ledger.api_budgets` and `ledger.api_period_summaries`. Board consumes Charter bylaw documents once Charter has them. Others are proposed as issues.

### 3.7 Storage

- Bucket names start with the app ID: `charter-branding`, `board-files`, `ledger-files` (if Ledger ever stores files). The hub uses `hub-…`.
- Object paths start with `<org_id>/`. Policies check `public.is_member` for read and the app's write helper for writes.
- Buckets are private; downloads use short-lived signed URLs.

### 3.8 Types

`gen-types.yml` (`workflow_dispatch`): `npx supabase gen types typescript --project-id $STAGING_REF --schema public,<app schema>` and opens a PR. Needs `SUPABASE_ACCESS_TOKEN`.

### 3.9 Charter's organization tree

- The **top of the tree** (a national or a standalone association) is one `public.organizations` row: the customer that's billed, and the shared org ID for Board and Ledger.
- Regions and chapters are `charter.units (id, org_id, parent_id, type, ancestor_ids, timezone, status, …)` under it. The top unit has `parent_id null` and represents the org itself in Charter.
- Every Charter table has `org_id` (the customer) and, where it belongs to a chapter or region, `unit_id → charter.units`.
- Core RLS guards the customer; Charter's permissions guard units inside it.
- Board and Ledger see only the top org. Per-chapter boards or books are a later feature.

---

## 4. Auth, sessions, invitations and ownership

### 4.1 Sessions

- One Supabase Auth for the suite. Users sign up once, at the hub (hosted).
- `shared/supabase/client.ts` creates the browser client with cookie storage on `.openapphub.org` in hosted mode (`VITE_COOKIE_DOMAIN`), so one sign-in covers every app. Self-hosted: no cookie domain.
- Server functions keep getting the access token from the browser and create a per-request client as that user.
- **Hosted sign-in:** no session → redirect to `${VITE_HUB_URL}/login?next=<url>`. The hub only follows `next` URLs on suite origins.
- **Current org:** cookie `oah_org` on the parent domain, re-checked against memberships. Invalid → the user's first org; none → the hub's "create organization" page (Charter portal members: their portal org, §4.5).
- Sign-out anywhere signs out everywhere.
- Session cookie names include the project ref, so staging and production sessions never collide.

### 4.2 Organizations

- Hosted: created, renamed and deleted only in the hub, through the core functions.
- Self-hosted: each app's own screens call the same core functions.
- Deleting an org deletes its data in **every** app. The hub's delete screen says so and lists the apps that hold data.

### 4.3 Invitations

- **One implementation:** `public.invitations` and the core functions (§3.2). Default expiry **14 days**.
- **Hosted:** the hub's members screen creates invitations and **sends the email** (§7.2). The link is `https://openapphub.org/invite/<token>`, unless the invitation has an `app`, in which case it's `https://<app>.openapphub.org/invite/<token>`.
- **Each app may provide an invitation page** at `/invite/<token>`. It:
  1. calls `get_invitation` to show the org and role;
  2. sends a signed-out visitor to the hub to sign in or sign up (hosted) or to the app's own sign-in (self-hosted), returning to the same page;
  3. calls `public.accept_invitation`;
  4. if the invitation has `app` = this app, calls the app's follow-up RPC, `<app>.on_invitation_accepted(p_invitation_id)`, which checks `accepted_by = auth.uid()` and applies `app_payload`. Examples: Charter links a roster record and grants portal access; Board sets an office; Ledger sets the treasurer overlay.
- The hub's own invitation page does steps 1–3 and, for an invitation with an `app`, redirects to that app's invitation page to finish step 4.
- **Self-hosted:** the app's members screen creates invitations through the same core functions and shows the link to copy (no email unless the self-hoster configures it).

### 4.4 Ownership

- Exactly one owner per org, enforced in the core.
- **Hosted:** transfer happens only in the hub (Settings → Transfer ownership), through `transfer_ownership`. Apps link there.
- **Self-hosted:** each app keeps a transfer screen calling the same function.
- The owner can't leave or be removed; they transfer first.

### 4.5 Charter members who pay dues

- Dues-paying members **are not core members** (they'd count toward plan limits). They sign up for an account **at the hub** (hosted), then Charter gives them portal access through Charter's own tables (`charter.member_profiles.user_id`, checked by `charter.is_portal_member(org_id, unit_id)`).
- **Hosted join flow:**
  1. A visitor opens `https://charter.openapphub.org/join/<slug>`.
  2. Not signed in → the hub's sign-up/sign-in with `next` back to the join page. The hub's sign-up form must not ask them to create an organization when `next` points at a join page.
  3. Signed in → Charter's join screen (no sign-up form) asks the level, "About you" questions and takes the dues payment through the org's own Stripe account.
- **Self-hosted:** the public join page works as today, with Charter's own sign-up and the `anon` lookups (`public_join_info`, `public_home_chapter_info`), which are created only when `instance_settings.billing_enabled` is false.
- Charter staff (admins, officers, anyone holding a role beyond Charter's built-in Member role) get a **core membership**: core `owner`/`admin` for `org_admin` at the top unit, core `member` otherwise.

---

## 5. Billing (database side)

Owned by the hub, schema `billing` (not exposed).

- `billing.plans(id pk, name, max_members int null, storage_gb int, apps_included int null, max_units int null, active)`. `apps_included null` = all apps. `max_units` is reserved for Charter unit-based pricing (§6.1) and is null until the owner decides.
- `billing.subscriptions(org_id pk → organizations on delete cascade, plan_id null, status, apps text[], trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id unique, stripe_subscription_id unique, updated_at)`; `status` ∈ trialing, active, past_due, canceled, unpaid, incomplete, expired.
- `billing.stripe_events(id pk, type, received_at)` for idempotency.
- `billing.org_has_app_access(p_org, p_app)`: trialing and not expired; or active/past_due and `p_app = any(apps)`.
- **Trial:** an `after insert` trigger on `public.organizations` (in the hub's billing migration) creates a trialing subscription for all apps, 30 days. One trial per user: if `created_by` already had a trial, the new org starts `expired`.
- **Member limit:** a trigger on `public.memberships` insert rejects inserts beyond `max_members` when billing is on. **It counts core memberships only**, so Charter portal members never count (§4.5).
- `public.get_org_billing(p_org)`: definer RPC, requires `is_member(p_org)` **or** `charter.is_portal_member(p_org, null)` (resolved at run time), returns plan, status, dates and apps.
- The billing migration ends with `update public.instance_settings set billing_enabled = true;`. Self-hosters skip it (`--skip 0002_billing`). (The hub's own schema is `db/migrations/0001_hub.sql`, which applies first.)

---

## 6. Payments

There are **two separate kinds of payment**. Never mix them.

| | Suite billing | Charter dues |
|---|---|---|
| Who pays whom | The organization pays OpenAppHub for hosting | Association members pay their association |
| Stripe account | OpenAppHub's | Each organization's own (connected in Charter) |
| Code | Hub only | Charter only |

### 6.1 Plans (not confirmed)

The owner hasn't set prices. The owner is weighing one price per organization against pricing that depends on how many chapters (Charter units) an organization has. Until confirmed:

- The hub reads all displayed prices from `src/config/pricing.ts`; the docs plans page stays a draft.
- Build plans so limits come from `billing.plans` rows, not code, so a later price model needs data changes only.
- Charter publishes `charter.api_unit_count (org_id, units)` so the hub can read it if pricing ends up depending on units.

Placeholder rows for development: `starter` (1 app, 10 members), `suite` (all apps, 25 members), `plus` (all apps, unlimited). Trial: all apps, 10 members, 30 days, no card. Lapsed: read-only, export still allowed.

### 6.2 Suite billing (hub)

Hub server functions and routes on its Worker:

- **`createCheckoutSession`** (signed in, owner/admin of the org): reuse or create the Stripe customer; Checkout in subscription mode, `client_reference_id = org_id`, metadata `{org_id, plan, apps}`. Price IDs come from the `STRIPE_PRICE_MAP` secret, never code.
- **`createPortalSession`** (owner/admin): Stripe Customer Portal URL.
- **`/api/stripe/webhook`** server route: verify the signature (`STRIPE_WEBHOOK_SECRET`), skip seen events, handle `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`; write `billing.*` with the service-role client (§7.2).
- Sub-apps show billing state from `get_org_billing` and link to `${VITE_HUB_URL}/billing`.
- Go live only after the owner tests: trial → checkout → renewal → failed payment → cancel → read-only → export, in Stripe test mode.

### 6.3 Charter dues

- Stay entirely in Charter, unchanged in behaviour, with each org's own Stripe keys stored encrypted by Charter.
- **While an org is read-only** (plan lapsed): Charter's webhook and payment-completion paths **still record** payments members already made, refunds and receipts. Starting a new join or renewal (`begin_join`, `begin_renewal`) is refused with a clear message.

---

## 7. Secrets and the service-role key

### 7.1 Where values live

**Anything starting with `VITE_` is shipped to the browser and is public.**

| Variable | Where | Public? | Used by |
|---|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Worker `vars` | yes | all |
| `VITE_HOSTED`, `VITE_APP_ID`, `VITE_APP_SCHEMA` | Worker `vars` / code defaults | yes | all |
| `VITE_HUB_URL`, `VITE_COOKIE_DOMAIN`, `VITE_SUITE_URLS`, `VITE_DOCS_URL` | Worker `vars` | yes | all (hosted) |

`VITE_SUITE_URLS` is a JSON object of app origins, the same shape everywhere: `{"hub":"https://openapphub.org","charter":"https://charter.openapphub.org","board":"https://board.openapphub.org","ledger":"https://ledger.openapphub.org"}`. `shared/supabase/hosted.ts` (`parseSuiteUrls`) parses it; unknown keys and invalid URLs are ignored.

| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret | **NO** | hub, Charter (allowlist §7.2) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MAP` | Worker secret | **NO** | hub |
| Charter's gateway encryption key | Worker secret | **NO** | Charter |
| `BACKUP_SIGNING_SEED` | Worker secret | **NO** | Ledger |
| `SMTP_*` (or Supabase Auth SMTP) | Supabase Auth settings / hub Worker secret | **NO** | hub email |
| `STAGING_DATABASE_URL`, `PROD_DATABASE_URL` | GitHub Actions secrets | **NO** | migrate, release |
| `SUPABASE_ACCESS_TOKEN`, `STAGING_REF`, `PROD_REF` | GitHub Actions secrets | **NO** | gen-types |

Rules:
- Secrets never go in frontend code, `VITE_*`, the repo, logs or PR text.
- Commit `.env.example`; ignore every other `.env*`. Stop tracking `.env` (values move to Worker `vars` and a local untracked file).
- Enable GitHub secret scanning and push protection on all five repos (owner).

### 7.2 Service-role allowlist (hosted, shared project)

In the shared project the service-role key bypasses RLS for **every app's data**. It's allowed only for:

| Repo | Use |
|---|---|
| Hub | Stripe webhook writes to `billing`; sending invitation emails (`auth.admin.inviteUserByEmail` or generating the link); account deletion; platform-operator tasks (demo orgs on staging) |
| Charter | Dues payment completion, failure and refund recording from Stripe (`payments.server.ts`, the dues webhook route) |
| Ledger | None in hosted mode. Restore creates the org with `public.create_organization()` as the caller; history writes go through `ledger.audited_write`. |

Any other use needs the owner's written approval in the PR. Self-hosted-only features (for example Ledger's own account deletion) may use the service role on the self-hoster's database, behind `VITE_HOSTED=false` on the server too.

---

## 8. Shared code (vendored)

The hub repo holds the canonical copies; each app repo keeps a read-only copy.

```
shared/VERSION
shared/design/tokens.css, tailwind-preset.ts, DESIGN.md      (§9)
shared/ui/AppShell.tsx, SuiteSwitcher.tsx, OrgSwitcher.tsx, BillingBanner.tsx, HelpLink.tsx
shared/ui/InvitationPage.tsx      reusable /invite/<token> page (§4.3), with an app follow-up hook
shared/supabase/client.ts         §4.1
shared/supabase/org.ts            current-org helpers (oah_org)
shared/supabase/hosted.ts         isHosted(), hubUrl(path), loginRedirect(next)
shared/docs.ts                    docsUrl() and help-map helpers (§12.3)
db/core/*.sql                     §3.2
scripts/migrate.mjs               §3.3
```

- Never edit these in an app repo. Change the hub, bump `shared/VERSION`, then copy them in a PR titled `chore: sync shared vX.Y.Z` (`scripts/sync-shared.mjs`).
- Each app's CI runs `node scripts/check-shared.mjs` (vendored with the code): it checks `shared/VERSION` against `package.json` → `"oahShared"` and every vendored file against `shared/MANIFEST.json`, so hand edits fail CI. The sync script also copies this spec into `docs/SHARED-SPEC.md`.
- Shared components must work under TanStack Start SSR (no `window` access during render).

---

## 9. Design system: a full refresh

The owner wants **one new design language for the whole suite**. Charter and Ledger's current semi-shared style may inform it but doesn't constrain it. Every app, including the hub and the docs site, adopts it.

**Process (hub repo, Phase 2):**
1. **Audit** all three apps: list every component and pattern in use (tables, forms, dialogs, tabs, status badges, money and date formats, empty states, mobile layouts).
2. **Propose 2–3 distinct directions** in one PR. For each: a name, the reasoning, colour tokens (light and dark), type scale and font pairing, spacing, radius, elevation, and the same three sample screens rendered as screenshots: a dashboard, a data table (members or transactions) and a form dialog, on desktop and phone.
3. **The owner picks one** (or mixes) in the PR. Nothing else in Phase 2 continues until then.
4. Write the chosen direction into `shared/design/` and `DESIGN.md`.

**Chosen (2026-11-09): "Civic, slightly warm"**: Civic's clarity, density, Inter and ink-navy primary on warm neutrals; dark mode is a soft graphite gray. Canonical tokens: hub `shared/design/tokens.css`.

**Rules for the chosen system:**
- Tokens as CSS variables in the shadcn convention (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`, …), light and dark.
- **Per-app accent** (`--app-accent`, `--app-accent-foreground`) set by `VITE_APP_ID`; the hub uses the neutral primary. Accents are approved with the direction.
- Components are shadcn/ui themed only through tokens. **No hard-coded colours** in app code.
- **Layout:** `AppShell` with a left sidebar and a top bar (SuiteSwitcher, OrgSwitcher, BillingBanner, user menu with **Help**). Below 768px the sidebar becomes a drawer. The apps must work on phones.
- **Data:** numbers right-aligned with tabular figures; one money format (`$1,234.56`) and one date format (`Nov 9, 2026`, `Nov 9, 2026, 2:30 PM`) suite-wide, defined in `DESIGN.md` and implemented once in `shared/format.ts`. Every app uses those helpers.
- **Dark mode:** Light / Dark / System (default System), toggle in the user menu. The choice is the `oah_theme` cookie on the parent domain, so choosing it in one app makes it the default in every app (`shared/theme.ts`, `shared/ui/ThemeToggle.tsx`).
- **Accessibility:** contrast ≥ 4.5:1, visible focus, full keyboard use, labels on every input.
- **Cookie consent (GDPR/ePrivacy, owner decision 2026-11-09):** every app renders the shared `CookieConsent` once. Required cookies (session, `oah_org`, `oah_consent`) are always on; anything else (today: `oah_theme`) is off until the visitor opts in, with "Accept" and "Reject" equally easy and choices changeable any time. One choice covers the suite. **Any new cookie or browser storage** is added to `COOKIES` in `shared/consent.ts`, and non-required ones check `hasConsent()` first. No advertising or tracking cookies without an owner decision and a new consent category.
- **Restyling an app** happens in its own PRs, separate from data and auth work, with before/after screenshots, **without changing behaviour**. Visible text stays the same unless the owner approves, because the docs quote it.
- Later revisions are token changes plus a `shared` sync.

---

## 10. Hosting and deploys (Cloudflare Workers)

### 10.1 Workers

- Each app repo deploys one Worker, configured by `wrangler.jsonc`, with two environments: `staging` and `production`.
- Security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a CSP allowing self plus the Supabase URL, and Stripe where needed) are set by the server entry, not `_headers`. No `_redirects`; the router handles routes.
- Public settings are Worker `vars`; secrets are Worker secrets (§7.1).

**Domains** (all one level under the apex, so Cloudflare's free certificate covers them):

| | Production | Staging |
|---|---|---|
| Hub | `openapphub.org` | `staging.openapphub.org` |
| Charter | `charter.openapphub.org` | `charter-staging.openapphub.org` |
| Board | `board.openapphub.org` | `board-staging.openapphub.org` |
| Ledger | `ledger.openapphub.org` | `ledger-staging.openapphub.org` |
| Docs | `docs.openapphub.org` | — |

Old domains (for example `opencharterapp.org`) redirect to the new ones once the app is live there.

### 10.2 Release flow

**Owner decision (2026-11-09): Cloudflare's Git integration deploys.** Each Worker is connected to its repo in Cloudflare; a push to `main` runs `npm run build` and `npx wrangler deploy`. So:

- The **top level of `wrangler.jsonc` is production** (a plain build + deploy must produce production). `env.staging` is staging, built with `CLOUDFLARE_ENV=staging` (`npm run build:staging`); `env.development` is local development.
- **Merging to `main` deploys production.** Database changes therefore go first: the owner runs `migrate.yml` against production on the PR's branch, then merges. Migrations must be additive (the running code must keep working until the deploy finishes); a destructive change is split across two releases.
- Staging deploys through a second Cloudflare Worker (`<app>-staging`) connected the same way with `npm run build:staging`, or not at all until needed.

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | every PR and push | typecheck, lint, tests, build, DB tests |
| `staging.yml` | push to `main` | `migrate.mjs --seed` against staging. Skips with a notice until `STAGING_DATABASE_URL` exists |
| `migrate.yml` | owner, `workflow_dispatch` | migrations only, `target: staging | production` (dry run by default) |

---

## 11. Demo and seed data

- **Production has no demo accounts, demo orgs or seed data.** Delete any that exist (owner step).
- **Demo runs on staging** (`staging.openapphub.org` and the `*-staging` apps), seeded by each repo's `db/seed/*.sql` through `staging.yml`.
- Seed files are idempotent and must refuse to run when the database has real (non-demo) organizations.
- Demo accounts use addresses on a reserved domain such as `@demo.openapphub.org`. Their password is shown publicly only on staging's sign-in page; it's never in a repo.
- The hub owns demo organizations and platform operators (`hub` schema). Apps don't recreate Charter's old platform-operator tables. Charter's "create demo organization" screens stay out of routing until the hub offers it.
- Scheduled demo resets (Board's `pg_cron` job) run on staging only, as a scheduled `staging.yml` run, not `pg_cron`.
- The free staging project pauses after a week without traffic; demo visits keep it awake.
- The owner provides suite-wide seed content later (Charter Q5). Until then each repo's seed is minimal.

---

## 12. Documentation site

User docs live in **`Nox-Mob/OpenAppHub-docs`**, published at `https://docs.openapphub.org` (Astro Starlight, deployed by Cloudflare on push to `main`). Read that repo's `AGENTS.md` before editing it.

### 12.1 Where pages live

| Tab | Folder | Owner repo |
|---|---|---|
| OpenAppHub | `src/content/docs/hub/` | OpenAppHub |
| OpenCharterApp | `src/content/docs/charter/` | OpenCharterApp |
| OpenBoardApp | `src/content/docs/board/` | OpenBoardApp |
| OpenLedgerApp | `src/content/docs/ledger/` | OpenLedgerApp |

Each app tab has `help/faq.md`, `troubleshooting.md`, `known-limits.md`, `self-hosting.md` and `glossary.md`. URL = path without `.md`.

### 12.2 Docs change with the code

A PR that changes anything users see needs a **matching docs PR**:
- the feature page, using the app's exact on-screen words in **bold**;
- `troubleshooting.md` for changed messages, `known-limits.md` when something becomes available, `glossary.md` for new terms, `self-hosting.md` for setup changes;
- link both PRs; merge the docs PR **after the production release**;
- docs describe today's behaviour; planned work goes in Known limits;
- run `npm ci && npm run build && npm run check:links` in the docs repo first.

If an agent can't open a docs PR, it lists the needed changes in its PR under **Docs changes needed**.

### 12.3 Help links

- `shared/docs.ts` exports `docsUrl(path)` from `VITE_DOCS_URL` (default `https://docs.openapphub.org`).
- The user menu's **Help** opens the app's tab; screens with non-obvious tasks show a `HelpLink` to their page.
- Each app keeps its help map in `src/config/help.ts`, with a unit test checking every path against a checked-in copy of the docs page list.

### 12.4 Suite pages that change with v2

When they ship, update in the docs repo:
- `hub/start/how-the-apps-fit.md`, `hub/accounts/signing-in.md`, `hub/accounts/invitations.md`, `hub/accounts/organizations-and-roles.md`, `hub/help/faq.md`: one sign-in, organizations, invitations (14 days everywhere) and ownership in the hub.
- Each app's sign-in, invitation, roles and ownership pages: hosted versus self-hosted.
- `hub/hosting/plans.md` stays a draft until prices are confirmed.
- The demo instructions point at staging.

---

## 13. Definition of done (every repo)

- [ ] Builds and runs in both modes; **a self-hosted build works on an empty database with only this repo's migrations and `db/core`** (§1.2).
- [ ] Every table in this repo's schema has `org_id`, RLS, policies with the app's write helper (§3.4–3.5). DB tests pass.
- [ ] Invitations, ownership and org management use core functions only (§4).
- [ ] Service-role use matches §7.2.
- [ ] No secrets in code or history (or the owner was told). `.env` untracked.
- [ ] Old migration and deploy tooling switched off (§3.3, §10.2). Lovable removed and disconnected.
- [ ] `.env.example`, `README.md` (self-hosting + hosted notes), `docs/INTEGRATION.md`, `docs/MIGRATION-NOTES.md` up to date.
- [ ] Uses `shared/` at the current version; no hard-coded colours.
- [ ] Owners/admins can export all org data in this app, including when read-only.
- [ ] No demo data on production.
- [ ] Docs PRs merged for every user-facing change; Help links resolve.
