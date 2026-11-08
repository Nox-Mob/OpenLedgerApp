# OpenLedgerApp → OpenAppHub suite: migration notes

Inventory written against v0.1.1 (`df00971`); updated for **SHARED-SPEC v2** and the owner's answers (2026-11-08).
Contract: [`docs/SHARED-SPEC.md`](SHARED-SPEC.md) (v2 wins over this file). Owner answers: [`AGENTS.md`](../AGENTS.md) → Suite migration.

**Status:** steps 1–3 done (this PR: inventory, secret scan, hygiene). Next: step 3b (AI PDF import off), then step 4 once the hub's `shared/` and `db/core/` exist.

Goal: Ledger stops being its own Supabase project and runs inside the **shared production project `nxungwtxnctcqolfshcr` (today's OpenCharterApp project)** in schema `ledger` (staging: `dnsqxiiexkdokgebysrt`), using the hub's core tables (`public.organizations`, `public.memberships`, `public.profiles`) and the hub's billing. Self-hosted, it still runs alone on its own database.

All existing Ledger data is demo/test data. **Nothing is copied across.** Ledger is built fresh in the shared project; the old project is retired at the end.

---

## 1. Where Ledger's data lives today

| | Today |
|---|---|
| Backend | **Lovable Cloud** managed Supabase project `pzzmmltmghmgfwhgzlvl` (`supabase/config.toml`, `.env`). Not on the owner's own Supabase account. |
| Schema | Everything in **`public`**: 26 tables, 8 enum types, ~35 functions, 27 triggers. |
| Migrations | Two copies kept in sync by hand: `supabase/migrations/` (38 files, used by CI and self-hosters) and `drizzle/migrations/` (3 files, applied by Lovable). |
| Storage buckets | **None.** Statement files (CSV/OFX/PDF) are parsed in memory and never stored. |
| Edge Functions | **None.** Server logic runs in TanStack Start server functions (`src/lib/*.functions.ts`, `*.server.ts`) on a Cloudflare Worker (nitro, `cloudflare` target). |
| Local data | Desktop edition (Tauri) uses SQLite via `src/lib/adapters/sqlite`; not affected by this migration. No mock data in the web build. |
| Seed | `supabase/seed/demo.sql` (manual dev seed; refuses databases with real orgs). |
| DB tests | `supabase/tests/*.sql` (7 files: tenant isolation, ledger invariants, audited write, bank/opening, catalog guards, member lifecycle, treasurer role), run by `scripts/ci/run-db-tests.sh` in CI. |

## 2. Database objects

Money is already **`bigint` cents** everywhere (`amount_cents`, `budget_cents`, `*_balance_cents`, …), with one org-level `currency text default 'USD'`, frozen once transactions exist (`guard_org_currency`). No floats. This is kept.

### 2.1 Tables (`public` today → `ledger` target)

"org_id" = has an `org_id` column today. "who" = records `created_by`/`user_id` today.

| Table | org_id | who | Kind | Target |
|---|---|---|---|---|
| `organizations` | (is the org) | yes | core concept + Ledger settings | **Split:** identity and owner → core (`public.organizations`, owner membership). Ledger columns → `ledger.org_settings` (§4.1). |
| `user_roles` | yes | yes | core concept | **Replace** with `public.memberships` + `ledger.member_roles` overlay (see §4.2). |
| `profiles` | — | (is the user) | core concept + Ledger pref | **Split:** `display_name` → `public.profiles`. `terminology` → `ledger.user_preferences`. |
| `org_invites` | yes | yes | membership | **Not recreated.** Core `public.invitations` in both modes (§4.4). |
| `accounts` | yes | **no** | books | `ledger.accounts` (+ `created_by`) |
| `transactions` | yes | yes | books (immutable once posted) | `ledger.transactions` |
| `entries` | **no** | **no** | books (immutable) | `ledger.entries` (+ `org_id`, kept equal to the transaction's by trigger; + `created_by`) |
| `transaction_tags` | **no** | no | books link | `ledger.transaction_tags` (+ `org_id`) |
| `bank_transactions` | yes | no | evidence (immutable) | `ledger.bank_transactions` (+ `created_by`) |
| `import_batches` | yes | yes | evidence | `ledger.import_batches` |
| `import_profiles` | yes | no | settings | `ledger.import_profiles` (+ `created_by`) |
| `reconciliations` | yes | yes | books | `ledger.reconciliations` |
| `period_closes` | yes | (`closed_by`) | books | `ledger.period_closes` |
| `budgets` | yes | no | planning | `ledger.budgets` (+ `created_by`) |
| `transaction_templates` | yes | no | planning | `ledger.transaction_templates` (+ `created_by`) |
| `recurring_occurrences` | yes | no | planning | `ledger.recurring_occurrences` (+ `created_by`) |
| `funds` | yes | no | catalog | `ledger.funds` (+ `created_by`) |
| `pledges` | yes | yes | books-adjacent | `ledger.pledges` |
| `pledge_payments` | yes | no | books-adjacent | `ledger.pledge_payments` (+ `created_by`) |
| `categories`, `tags`, `projects` | yes | no | catalog | `ledger.*` (+ `created_by`) |
| `audit_log` | yes | yes | history (append-only) | `ledger.audit_log` |
| `ai_usage` | yes | yes | metering (cloud-only) | `ledger.ai_usage` (kept for when AI PDF import returns) |
| `legal_acceptances` | yes | yes | legal (append-only) | `ledger.legal_acceptances`: self-hosted sign-up and Ledger-specific consent (AI PDF). Hosted sign-up acceptance is the hub's. |
| `deleted_organizations` | yes | no | tombstone log | `ledger.deleted_organizations`, self-hosted only (hosted deletion is the hub's). |

### 2.2 Enum types

`app_role` (admin, treasurer, member, viewer), `org_type` (nonprofit, business), `account_type`, `transaction_source` (incl. `closing`, `release`, `pledge`), `transaction_status`, `import_format`, `reconcile_mode`, `reconcile_status`. All move to `ledger.*` except `app_role`, which is replaced by `public.org_role` + the overlay (§4.2).

### 2.3 Functions

- **Membership/permission helpers** (replaced by core + Ledger helpers `ledger.mfa_ok`, `ledger.can_edit`, `ledger.can_close_books`, `ledger.is_admin`): `is_org_member`, `is_org_member_any_aal`, `has_org_role`, `can_write_org`, `can_close_books`, `mfa_ok`, `add_creator_as_admin` (trigger; core `create_organization` makes the owner), `guard_last_admin` (trigger; core enforces exactly one owner).
- **Atomic RPCs** (move to `ledger`, `security invoker` where they are today, called with `.schema('ledger').rpc(...)`): `post_transaction_atomic`, `void_transaction_atomic`, `audited_write`, `audit_append_in_write`. `delete_organization_atomic` is **not** ported: self-hosted deletion calls core `public.delete_organization` (§4.5).
- **Integrity triggers** (move unchanged in behaviour): `validate_transaction_balanced` (deferred; debits = credits, ≥2 entries, both signs, void exempt), `guard_transaction_immutable`, `guard_entry_immutable`, `guard_entry_refs`, `guard_reconciled_entry`, `guard_reconciled_transaction`, `guard_reconciliation_complete`, `guard_reconciliation_update`, `guard_bank_evidence`, `guard_bank_refs`, `guard_books_lock`, `guard_one_opening_balance`, `guard_account_delete`, `guard_account_type`, `guard_budget_account`, `guard_budget_scope`, `guard_template_refs`, `guard_unique_name`, `normalize_name`, `guard_org_currency`, `guard_org_non_admin_update`, `update_updated_at_column`.

These already satisfy AGENTS step 5 "integrity": posted entries can't be edited or deleted (corrections are voids/reversals), and the balance check is a DB trigger. The baseline ports them; it does not add accounting features.

## 3. Every place the code calls a backend

All access is server-side through server functions, except auth calls in screens. The typed client is `Db` (`src/lib/db.ts`).

| File | Tables / RPCs / auth calls |
|---|---|
| `src/integrations/supabase/client.ts` | browser client (`createClient`, localStorage / Lovable preview broker storage) — **replaced by `shared/supabase/client.ts`** |
| `src/integrations/supabase/client.server.ts` | service-role admin client (`SUPABASE_SERVICE_ROLE_KEY`) |
| `src/integrations/supabase/auth-middleware.ts`, `auth-attacher.ts` | per-request user client from bearer token (`auth.getClaims`, `auth.getSession`) |
| `src/integrations/supabase/cron-auth.ts` | Lovable cron secret check — **unused**, remove |
| `src/integrations/lovable/index.ts` | Lovable OAuth broker (`@lovable.dev/cloud-auth-js`, `auth.setSession`) — remove; use `supabase.auth.signInWithOAuth` |
| `src/lib/adapters/supabase/index.ts` | accounts, audit_log, bank_transactions, budgets, entries, import_batches, organizations, period_closes, pledge_payments, pledges, projects, reconciliations, recurring_occurrences, transaction_templates, transactions, user_roles; `post_transaction_atomic`, `void_transaction_atomic` |
| `src/lib/org.functions.ts` | organizations, user_roles, profiles, accounts, bank_transactions, budgets, entries, import_batches, reconciliations |
| `src/lib/members.functions.ts` | org_invites, organizations, user_roles; `delete_organization_atomic`; **admin**: `auth.admin.deleteUser`, invite claim. Becomes core calls (`create_invitation`, `accept_invitation`, `transfer_ownership`, `delete_organization`) + `ledger.member_roles` |
| `src/lib/permissions.ts` | user_roles (+ `organizations.require_mfa`); `mfa_ok` |
| `src/lib/import.functions.ts` | ai_usage, bank_transactions, import_batches, import_profiles, organizations; `can_write_org`; **admin** client; **Lovable AI gateway** `ai.gateway.lovable.dev` (`LOVABLE_API_KEY`) — turned off in step 3b |
| `src/lib/funds.functions.ts` | entries, funds, pledge_payments, pledges |
| `src/lib/taxonomy.functions.ts` | accounts, categories, entries, funds, projects, tags |
| `src/lib/transactions.functions.ts` | transactions |
| `src/lib/legal.functions.ts` | legal_acceptances |
| `src/lib/audited-write.ts` / `src/lib/audit.ts` | `audited_write` RPC / audit_log via **admin** client |
| `src/lib/backup.functions.ts`, `backup-export.server.ts` | audit_log, entries, profiles, organizations, transaction_tags (table-walking `UntypedDb`) |
| `src/lib/restore.server.ts` | accounts, audit_log, deleted_organizations, entries, organizations, reconciliations; **admin** client (creates and, on failure, deletes the restored org). Becomes `public.create_organization()` / `public.delete_organization()` as the caller |
| `src/routes/auth.tsx`, `reset-password.tsx`, `invite.$token.tsx`, `_authenticated/route.tsx`, `settings/security.tsx`, `components/AppShell.tsx` | `signUp`, `signInWithPassword`, `signInWithOAuth`, `resend`, `resetPasswordForEmail`, `updateUser`, `getSession`, `getUser`, `onAuthStateChange`, `signOut` |

Because every table access already goes through ports/adapters and a small set of server-function files, the schema move is mostly: `db: { schema: 'ledger' }` on the client, `.schema('public')` for the four core lookups, and new generated types.

## 4. Mapping onto core (settled by SHARED-SPEC v2)

### 4.1 Organizations

Core `public.organizations` holds `id, name, slug, created_by, created_at`; ownership is the single core `owner` membership. Ledger's extra org columns move to:

`ledger.org_settings (org_id uuid primary key references public.organizations on delete cascade, org_type, currency char(3), fiscal_year_start_month, terminology, term_overrides, timezone, ai_pdf_enabled, books_locked_through, require_mfa, recurring_mode)`

**A missing row means defaults** (spec §3.4), so an org created in the hub opens in Ledger without setup; onboarding writes the row. Existing guards (`guard_org_currency`, `guard_org_non_admin_update`, the books-lock moves) move onto `org_settings`. Name changes go through `public.rename_organization` (self-hosted) or the hub (hosted).

### 4.2 Roles

| Ledger today | Core role | Ledger in v2 |
|---|---|---|
| owner = `organizations.created_by` (+ `admin`) | `owner` | admin rights; transfer via core `transfer_ownership` |
| `admin` | `admin` | `admin` |
| `treasurer` | `member` (or higher) | core role + `ledger.member_roles (org_id, user_id, role = 'treasurer')` overlay |
| `member` | `member` | `member` |
| `viewer` | `viewer` | `viewer` |

- The overlay is managed in Ledger by owner/admin, in both modes. A treasurer row requires core `member` or higher, and is removed when the membership goes (cascade via a trigger on read, or a check in `ledger.can_close_books`).
- `CAPABILITIES` in `src/lib/permissions.ts` stays the only role table; `assertCan` derives the Ledger role from core role + overlay. `owner` gets admin's capabilities.
- Ledger helpers, used by every policy (spec §3.4–3.5):
  - read: `public.is_member(org_id) and ledger.mfa_ok(org_id)`
  - write (`ledger.can_edit`): `public.can_write(org_id,'ledger') and ledger.mfa_ok(org_id)`
  - close books / reopen statement checks (`ledger.can_close_books`): `ledger.can_edit(org_id)` and (`public.has_role(org_id,'{owner,admin}')` or treasurer overlay)
  - settings, accounts, overlay (`ledger.is_admin`): `ledger.can_edit(org_id) and public.has_role(org_id,'{owner,admin}')`

### 4.3 Profiles

`display_name` → `public.profiles` (core `handle_new_user` fills it from the sign-up name; Ledger's own `on_auth_user_created` is replaced by core 0002). `terminology` → `ledger.user_preferences (user_id pk → auth.users on delete cascade, terminology)`. Names and emails for the members screen come from `public.org_member_directory(org)`.

### 4.4 Invitations

- **Core in both modes.** `org_invites` is not recreated; expiry becomes the core default **14 days** (Ledger offered 1–30, default 7).
- Ledger keeps `/invite/<token>`, rebuilt on `shared/ui/InvitationPage`: `get_invitation` → sign in (hub when hosted) → `public.accept_invitation` → `ledger.on_invitation_accepted(p_invitation_id)`, which checks `accepted_by = auth.uid()` and applies `app_payload` (`{"ledger_role":"treasurer"}` sets the overlay).
- Hosted: the hub creates and emails invitations. Self-hosted: Ledger's members screen calls `public.create_invitation` and shows the link to copy, as today.

### 4.5 Ownership, org deletion, account deletion

| | Hosted | Self-hosted |
|---|---|---|
| Transfer ownership | link to the hub | Ledger screen → `public.transfer_ownership` (candidates from `ownership_transfer_candidates`) |
| Delete organization | link to the hub | Ledger screen → `public.delete_organization(org, confirm_name)`; Ledger logs `ledger.deleted_organizations` first |
| Delete my account | link to the hub | Ledger's existing flow (`auth.admin.deleteUser`), service role allowed behind `VITE_HOSTED=false` on the server (spec §7.2) |
| Remove / leave | link to the hub | core RLS on `public.memberships` (never the owner) |

Org deletion cascades every app's tables through `org_id`. Ledger's "deferrable no action FKs + balance trigger skipping deleted transactions" rule is kept so the cascade can't trip the balance check.

### 4.6 Two-step sign-in (MFA)

Kept in Ledger: `require_mfa` lives in `ledger.org_settings`, and `ledger.mfa_ok(org)` is inside every Ledger helper. The org row and the caller's own role stay readable without MFA so the app can explain why the books are hidden.

### 4.7 Service role

| Use today | v2 |
|---|---|
| Invite claim (`members.functions.ts`) | gone: `accept_invitation` runs as the caller |
| Org delete (`delete_organization_atomic`) | gone: `public.delete_organization` as the caller |
| Account delete (`auth.admin.deleteUser`) | self-hosted only, server checks `VITE_HOSTED` |
| History writes (`audit.ts` → `audit_log` insert) | `ledger.audited_write` / event-only history RPC as the caller |
| Restore (`restore.server.ts`) | `public.create_organization()` as the caller; cleanup on failure via `public.delete_organization` |
| AI usage meter (`import.functions.ts`) | off (step 3b); when it returns, a `ledger` RPC as the caller |

Hosted Ledger ends up with **no** service-role key (spec §7.2). The only Ledger Worker secret is `BACKUP_SIGNING_SEED`.

## 5. Charter and Board

**No links today.** Nothing in the code or schema refers to Charter or Board. Ledger publishes `ledger.api_budgets` and `ledger.api_period_summaries` in step 13. Candidate links to propose as issues, not build: a budget approved by a Board decision (`ledger.budgets.board_decision_id`, read via `board.api_decisions`), and a restricted fund's governing document from Charter. Board and Ledger see only the top Charter org (spec §3.9); per-chapter books are a later feature.

## 6. Decisions (owner answers, 2026-11-08)

All the questions raised in v1 of these notes are answered. Spec v2 wins wherever the original proposal differed.

| # | Question | Answer |
|---|---|---|
| D1 | Owner inputs | Filled in (spec §0.1): `openapphub.org`, production `nxungwtxnctcqolfshcr`, staging `dnsqxiiexkdokgebysrt`. **Design is a full refresh**; Ledger restyles in step 14 after the hub's direction is approved. |
| D2 | Hosting, service role | **Cloudflare Workers.** No service role in hosted mode (§4.7). |
| D3 | Treasurer | `ledger.member_roles` overlay (§4.2). |
| D4 | MFA | Keep `ledger.mfa_ok` in Ledger's policies (§4.6). |
| D5 | Sessions | Shared cookie client in the browser; server functions keep the bearer token. |
| D6 | Deletion | Hosted: hub. Self-hosted: Ledger screens on `public.delete_organization`; `deleted_organizations` self-hosted only (§4.5). |
| D7 | Legal | Hosted: hub records acceptance. Ledger keeps `ledger.legal_acceptances` for self-hosted and Ledger-specific consent. |
| D8 | AI PDF import | **Off** (hide the option, refuse on the server) until the owner picks a provider. Google sign-in: plain Supabase OAuth (self-hosted), the hub (hosted). |
| D9–D13 | ids, currency, routing, migration folders, desktop parity | Accepted as proposed. |
| — | Invitations | Core, sent by the hub; 14 days; `ledger.on_invitation_accepted` (§4.4). |
| — | Ownership | Core; transfer in the hub (hosted) or via `public.transfer_ownership` (self-hosted). |
| — | Demo | Staging only. `db/seed/0001_ledger_demo.sql` keeps the refusal to run on real data; demo addresses on `@demo.openapphub.org`. |

## 7. Plan (one PR per step)

Production order is fixed by START-HERE: Charter park → Hub core + billing → Charter → Board → **Ledger baseline (5th)** → staging.

| Step | What | Depends on | Status |
|---|---|---|---|
| 1 | Inventory, `docs/SHARED-SPEC.md`, `AGENTS.md` suite section | — | **done** (this PR) |
| 2 | Secret scan (§8) | — | **done** (this PR) |
| 3 | Hygiene: `.env` untracked; `.env.example` with every v2 variable; security headers set in `src/server.ts` (Workers ignore `_headers`; no `_redirects`); `wrangler.jsonc` (staging + production); `staging.yml` + `release.yml` behind `scripts/deploy/preflight.sh`, which refuses until steps 4, 5 and 8 are done; 64 lockfile entries moved off Lovable's private npm cache (403 outside Lovable) to registry.npmjs.org, same integrity hashes; unused Lovable `cron-auth.ts` removed; `check-env.mjs` now fails if any `.env*` other than `.env.example` / `.env.desktop` is tracked | owner disconnects Lovable before merge | **done** (this PR) |
| 3b | AI PDF import off: hide the option, server refuses, remove the Lovable AI gateway call; docs PR (importing, troubleshooting, known limits, FAQ) | — | next |
| 4 | Vendor `shared/`, `db/core/`, `scripts/migrate.mjs`; `migrate.yml`; CI `db` job on `db/`; **retire** `supabase/migrations/`, `drizzle/`, the old `database` CI job, and point `check-migrations.mjs` at `db/` | Hub Phase 1–2 merged | blocked on hub |
| 5 | `db/migrations/0001_ledger_baseline.sql`: schema `ledger`, every table of §2.1 with `org_id` (incl. `entries`, `transaction_tags`) and `created_by`/`created_at`; `org_settings`, `user_preferences`, `member_roles`; helpers of §4.2; ported triggers and RPCs; `on_invitation_accepted`; RLS + grants per spec §3.4. Bucket name `ledger-files` if files are ever stored (none today) | 4 | |
| 6 | `db/seed/0001_ledger_demo.sql` (port of `supabase/seed/demo.sql`, refuses real orgs, `@demo.openapphub.org`) | 5 | |
| 7 | `db/tests/`: port the 7 existing suites; add non-member can't read, viewer can't write, expired trial = read-only, treasurer overlay rules, posted entries immutable, balance check | 5 | |
| 8 | Client: `shared/supabase/client.ts` (`VITE_APP_SCHEMA=ledger`), `.schema('public')` for core, regenerated types (`gen-types.yml`); remove `previewAuthStorage`, Lovable OAuth broker | 5 | |
| 9 | Org scoping via `shared/supabase/org.ts` (`oah_org`) | 8 | |
| 10 | Hosted vs self-hosted: hub links for sign-in, org create/delete, core roles, invitations, ownership, account deletion; `/invite/<token>` on `InvitationPage`; hosted `/` → `/ledger`; service role only behind `VITE_HOSTED=false` | 9 | |
| 11 | `BillingBanner`, write controls disabled when read-only, link to `${VITE_HUB_URL}/billing` | 10 | |
| 12 | Export: CSV per table + JSON bundle, works read-only, tested | 8 | |
| 13 | `ledger.api_budgets`, `ledger.api_period_summaries`; `docs/INTEGRATION.md` | 5 | |
| 14 | New shared design in web **and** desktop builds; separate PRs; before/after screenshots; behaviour and visible text unchanged | hub design approved | |
| 15–16 | Help map `src/config/help.ts`; docs PR (AGENTS → Phase 5) | 14 | |
| — | Retire Lovable project `pzzmmltmghmgfwhgzlvl`; remove `supabase/config.toml`, `@lovable.dev/*` (incl. the Vite config wrapper), `.lovable/`, the Lovable note in `AGENTS.md` | Ledger live on the shared project | |

### 7.1 Codebase rules that change, and when

| Rule in `AGENTS.md` → Codebase rules | Replaced by | Step |
|---|---|---|
| "Members: `organizations.created_by` is the owner; invite links store only a SHA-256 hash … claimed atomically" | core owner membership; core `invitations` (still hashed, still atomic in `accept_invitation`) | 5, 10 |
| "Org delete needs deferrable no action FKs …" | still true inside `ledger`; the delete itself is `public.delete_organization` | 5 |
| "Org data: requireSupabaseAuth + assertCan + member RLS; settings/accounts admin-only" | same, with core roles + overlay; admin-only = `ledger.is_admin` | 5, 8 |
| "MFA: org require_mfa enforced in DB via mfa_ok inside membership helpers" | `ledger.mfa_ok` inside Ledger helpers (core helpers don't check it) | 5 |
| "IDs: app-generated UUID, never a DB default" | app still supplies ids; `default gen_random_uuid()` exists only as a fallback (spec §2) | 5 |
| "Routing: public website owns `/`" | self-hosted only; hosted `/` → `/ledger` | 10 |
| "Demo login: manual dev seed only" | demo on staging only, through `staging.yml` | 6 |
| "AI PDF: org opt-in, upload ack, limits …" | feature off until a provider is chosen; rule returns with it | 3b |
| "Database changes live in both `drizzle/migrations` and `supabase/migrations`" (`docs/architecture.md`, `scripts/ci/AGENTS.md`) | `db/migrations/` only, applied by `scripts/migrate.mjs` | 4 |
| `.env` "tracked on purpose (Lovable needs it)" (`scripts/ci/check-env.mjs`) | `.env` untracked; CI fails if any `.env*` other than `.env.example` / `.env.desktop` is tracked | 3 |

## 8. Secret scan (step 2 result)

Scanned the working tree and all 645 commits for `sb_secret_`, `sk_live_`/`sk_test_`, `whsec_`, service-role JWTs, private keys, Postgres URLs with passwords, `LOVABLE_API_KEY` and `BACKUP_SIGNING_SEED` values.

- **No secrets found.**
- `.env` held only the **publishable** key, URL and project id of the Lovable project (public by design). It is **untracked in step 3** (its history stays; nothing in it needs rotating). `.env.desktop` stays tracked: it only sets `VITE_EDITION=desktop`.
- `postgresql://postgres:postgres@127.0.0.1:54322/postgres` in CI and README is the local Supabase CLI default, not a real credential.

Nothing to rotate.

## 9. Owner actions now

Before merging this PR:

1. **Disconnect Lovable** from this repo (spec §2). This PR untracks `.env`, which Lovable's preview reads, and later steps move tables out of `public`, which breaks Lovable's editor.
2. **Switch off** any Cloudflare Git integration or Lovable publish that deploys production from `main` (spec §10.2). From now on production deploys only from **Release**.

When convenient (needed before the first staging/production deploy, not before merging):

3. Replace the four `<… publishable key …>` placeholders in `wrangler.jsonc` with the **publishable** keys of the staging (`dnsqxiiexkdokgebysrt`) and production (`nxungwtxnctcqolfshcr`) projects. They're public; a PR or a direct edit is fine.
4. Add GitHub Actions secrets: `PROD_DATABASE_URL`, `STAGING_DATABASE_URL` (Session pooler, port 5432), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (plus `SUPABASE_ACCESS_TOKEN`, `PROD_REF`, `STAGING_REF` for type generation).
5. Set the Worker secret `BACKUP_SIGNING_SEED` on both environments (`npx wrangler secret put BACKUP_SIGNING_SEED --env staging` and `--env production`) after the first deploy creates the Workers. Use a new value for the hosted edition; never change it afterwards.
6. Add custom domains `ledger.openapphub.org` and `ledger-staging.openapphub.org` (wrangler creates them on first deploy from `routes`; check they appear on the Workers).
7. Turn on GitHub secret scanning and push protection for this repo.
8. Pick an AI provider for PDF statement reading whenever you want it back (step 3b turns it off).
9. Keep the Lovable project `pzzmmltmghmgfwhgzlvl` until Ledger is verified on the shared project; then delete it.
