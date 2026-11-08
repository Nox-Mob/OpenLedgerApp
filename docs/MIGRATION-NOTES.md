# OpenLedgerApp → OpenAppHub suite: migration notes

Status: **Phase 1, step 1 (inventory)**. Written against v0.1.1 (`df00971`).
Contract: [`docs/SHARED-SPEC.md`](SHARED-SPEC.md). Work order: [`AGENTS.md`](../AGENTS.md).

Goal: Ledger stops being its own Supabase project and runs inside the **shared production project (today's OpenCharterApp project)** in schema `ledger`, using the hub's core tables (`public.organizations`, `public.memberships`, `public.profiles`) and the hub's billing. Self-hosted, it still runs alone on its own database.

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
| `organizations` | (is the org) | yes | core concept + Ledger settings | **Split:** identity → `public.organizations` (core). Ledger columns → new `ledger.org_settings` (see §4.1). |
| `user_roles` | yes | yes | core concept | **Replace** with `public.memberships` + `ledger.member_roles` overlay (see §4.2). |
| `profiles` | — | (is the user) | core concept + Ledger pref | **Split:** `display_name` → `public.profiles`. `terminology` → `ledger.user_preferences`. |
| `org_invites` | yes | yes | membership | Self-hosted only (hosted invites happen in the hub). Becomes `ledger.org_invites`; claiming inserts into `public.memberships`. |
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
| `ai_usage` | yes | yes | metering (cloud-only) | `ledger.ai_usage` |
| `legal_acceptances` | yes | yes | legal (append-only) | `ledger.legal_acceptances` for now. **Decision D7.** |
| `deleted_organizations` | yes | no | tombstone log | Self-hosted only; in hosted mode org deletion is the hub's job. **Decision D6.** |

### 2.2 Enum types

`app_role` (admin, treasurer, member, viewer), `org_type` (nonprofit, business), `account_type`, `transaction_source` (incl. `closing`, `release`, `pledge`), `transaction_status`, `import_format`, `reconcile_mode`, `reconcile_status`. All move to `ledger.*` except `app_role`, which is replaced by `public.org_role` + the overlay (§4.2).

### 2.3 Functions

- **Membership/permission helpers** (replaced by core + thin Ledger wrappers): `is_org_member`, `is_org_member_any_aal`, `has_org_role`, `can_write_org`, `can_close_books`, `mfa_ok`, `add_creator_as_admin` (trigger), `guard_last_admin` (trigger; core has its own last-owner trigger).
- **Atomic RPCs** (move to `ledger`, `security invoker` where they are today, called with `.schema('ledger').rpc(...)`): `post_transaction_atomic`, `void_transaction_atomic`, `audited_write`, `audit_append_in_write`, `delete_organization_atomic` (self-hosted only, D6).
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
| `src/lib/members.functions.ts` | org_invites, organizations, user_roles; `delete_organization_atomic`; **admin**: `auth.admin.deleteUser`, invite claim |
| `src/lib/permissions.ts` | user_roles (+ `organizations.require_mfa`); `mfa_ok` |
| `src/lib/import.functions.ts` | ai_usage, bank_transactions, import_batches, import_profiles, organizations; `can_write_org`; **admin** client; **Lovable AI gateway** `ai.gateway.lovable.dev` (`LOVABLE_API_KEY`) |
| `src/lib/funds.functions.ts` | entries, funds, pledge_payments, pledges |
| `src/lib/taxonomy.functions.ts` | accounts, categories, entries, funds, projects, tags |
| `src/lib/transactions.functions.ts` | transactions |
| `src/lib/legal.functions.ts` | legal_acceptances |
| `src/lib/audited-write.ts` / `src/lib/audit.ts` | `audited_write` RPC / audit_log via **admin** client |
| `src/lib/backup.functions.ts`, `backup-export.server.ts` | audit_log, entries, profiles, organizations, transaction_tags (table-walking `UntypedDb`) |
| `src/lib/restore.server.ts` | accounts, audit_log, deleted_organizations, entries, organizations, reconciliations; **admin** client (creates and, on failure, deletes the restored org) |
| `src/routes/auth.tsx`, `reset-password.tsx`, `invite.$token.tsx`, `_authenticated/route.tsx`, `settings/security.tsx`, `components/AppShell.tsx` | `signUp`, `signInWithPassword`, `signInWithOAuth`, `resend`, `resetPasswordForEmail`, `updateUser`, `getSession`, `getUser`, `onAuthStateChange`, `signOut` |

Because every table access already goes through ports/adapters and a small set of server-function files, the schema move is mostly: `db: { schema: 'ledger' }` on the client, `.schema('public')` for the four core lookups, and new generated types.

## 4. Mapping onto core

### 4.1 Organizations

Core `public.organizations` has `id, name, slug, created_by, created_at`. Ledger's org row also carries settings that core must not hold (Ledger may not write `public` migrations):

`org_type, currency, fiscal_year_start_month, terminology, term_overrides, timezone, ai_pdf_enabled, books_locked_through, require_mfa, recurring_mode`

→ `ledger.org_settings (org_id uuid primary key references public.organizations on delete cascade, …those columns…)`, created on first Ledger use (onboarding already asks for all of them). Every query that reads `organizations.<setting>` reads `org_settings` instead; the name comes from core. Existing guards (`guard_org_currency`, `guard_org_non_admin_update`, books-lock moves) move onto `org_settings`.

### 4.2 Roles

| Ledger today | Core | Proposed in Ledger |
|---|---|---|
| owner = `organizations.created_by` (+ admin role) | `owner` | admin rights in Ledger |
| `admin` | `admin` | `admin` |
| `treasurer` | — (no core equivalent) | `ledger.member_roles(org_id, user_id, role = 'treasurer')` overlay, set by Ledger admins; requires a core membership of `member` or higher |
| `member` | `member` | `member` |
| `viewer` | `viewer` | `viewer` |

`CAPABILITIES` in `src/lib/permissions.ts` stays the only role table; `assertCan` derives the Ledger role from core role + overlay. Ledger's RLS becomes `public.is_member(org_id) and ledger.mfa_ok(org_id)` for reads and `public.can_write(org_id,'ledger') and ledger.mfa_ok(org_id)` for writes (so billing read-only applies), with settings/members/close-books policies using `public.has_role(...)` plus the overlay. **Decision D3.**

### 4.3 Profiles

`display_name` → `public.profiles` (created by core's `handle_new_user` trigger; Ledger's own `on_auth_user_created` is dropped by core 0002). `terminology` (per-user wording preference) → `ledger.user_preferences(user_id pk, terminology)`.

### 4.4 Members and invites

- Hosted: invites, role changes, removal, org creation/deletion and account deletion link out to the hub (`VITE_HUB_URL`). Ledger only edits the treasurer overlay.
- Self-hosted: Ledger keeps its own screens. They write `public.memberships` through core RLS (owner/admin), and `public.create_organization()` for onboarding. That is runtime use of core tables, which SHARED-SPEC §1.1 allows; Ledger still ships no migrations for `public`.
- Ledger's "last admin" guard is replaced by core's "last owner" trigger.

### 4.5 Two-step sign-in (MFA)

Core helpers don't check AAL. Ledger keeps `require_mfa` in `org_settings` and a `ledger.mfa_ok(org)` helper inside its own policies, so the current guarantee (books hidden from non-MFA sessions when required) is kept. **Decision D4** (suite-wide MFA would belong in core instead).

## 5. Charter and Board

**No links today.** Nothing in the code or schema refers to Charter or Board. Candidate integrations (to propose as issues, not build now): a budget approved by a Board motion (`ledger.budgets.board_decision_id` read via `board.api_*`), and a fund's governing document from Charter (`ledger.funds.charter_document_id`). Ledger will publish `ledger.api_budgets` and `ledger.api_period_summaries` in step 13.

## 6. Where the spec doesn't fit this repo (needs owner input)

Per SHARED-SPEC §2.2 ("if something is impossible or wrong, stop and explain"), these must be settled before Phase 2–3 code lands.

| # | Issue | Proposal |
|---|---|---|
| **D1** | §0 owner inputs are still placeholders (apex domain, prod/staging refs, design reference/outlier apps). | Owner fills them in. Inventory and Phase 2 SQL can be written meanwhile; nothing is applied until they are set. |
| **D2** | **Ledger is not a static SPA.** It is TanStack Start with SSR and server functions on a Cloudflare **Worker**. Several server functions use the **service-role key** (invite claim, account/org delete, restore, history writes) and `BACKUP_SIGNING_SEED`. §10 (Pages + `_redirects`) doesn't apply as written. In the shared project the service-role key bypasses RLS for **every** app's data. | Deploy Ledger as a Cloudflare Worker (Workers & Pages). Keep secrets as Worker secrets, never `VITE_*`. Reduce service-role use: hosted mode drops invites/org/account deletion (hub owns them); move audit writes fully into `audited_write`; restore uses `public.create_organization()` as the caller. Owner approves whatever service-role use remains, or asks for a separate restricted DB role. |
| **D3** | Core roles have no `treasurer`. | `ledger.member_roles` overlay (§4.2). Alternative: ask the hub to add a generic per-app role column. |
| **D4** | Core `is_member` ignores MFA; Ledger enforces org-required MFA in the DB. | Keep `ledger.mfa_ok` in Ledger policies (§4.5). |
| **D5** | Sessions: spec requires `@supabase/ssr` cookie sessions on `.<apex-domain>`; Ledger sends a bearer token to server functions (`auth-attacher.ts`). | Use `shared/supabase/client.ts` in the browser; server functions keep reading the bearer token, or read the shared cookie on the Worker. Verified in step 8. |
| **D6** | Org deletion and account deletion exist in Ledger (`delete_organization_atomic`, `auth.admin.deleteUser`). In a shared project, deleting an org deletes Charter and Board data too. | Hosted: hide both, link to the hub. Self-hosted: keep. `deleted_organizations` stays self-hosted only. |
| **D7** | Legal acceptance (terms/privacy versions) is per-app today; in hosted mode sign-up happens in the hub. | Hosted: the hub records acceptance; Ledger keeps `ledger.legal_acceptances` for self-hosted and for Ledger-specific terms (AI PDF import consent). |
| **D8** | AI PDF statement import uses the **Lovable AI gateway** (`LOVABLE_API_KEY`), a Lovable leftover. Google sign-in uses Lovable's OAuth broker. | Replace the gateway with a provider the owner picks (env-configured, server-only key), or disable AI PDF import until then. Google sign-in: plain Supabase OAuth (self-hosted) / hub login (hosted). |
| **D9** | Spec template uses `id … default gen_random_uuid()`; Ledger's rule is app-generated `newId()`. | Compatible: keep the default as a fallback, app keeps supplying ids. |
| **D10** | Spec asks for `currency char(3)` alongside money. Ledger stores one currency per org (two-decimal only, frozen once used). | Keep one `currency char(3)` on `ledger.org_settings`; no per-row currency (multi-currency is out of scope). |
| **D11** | Routing: Ledger's public website owns `/` and the app lives at `/ledger`. | Hosted: website routes excluded, `/` redirects to `/ledger`; self-hosted unchanged. |
| **D12** | Two migration copies (`supabase/migrations` + `drizzle/migrations`) and CI rules in `scripts/ci/check-migrations.mjs` that assume them. | New baseline lives only in `db/migrations/` (vendored runner). Old folders stay until the Lovable backend is retired (step 3), then removed in one hygiene PR; CI checks are pointed at `db/`. |
| **D13** | Desktop edition (SQLite) must keep working and mirror DB guards. | Unaffected by the schema move; the SQLite schema gets the same new columns (`org_id` on entries, `created_by`) so contract tests stay in parity. |

## 7. Plan (this repo, one PR per step)

Suite order is fixed by START-HERE: Hub core + billing reach production **before** Ledger's baseline (step 5 of the owner's order).

| Step | PR | Depends on |
|---|---|---|
| 1 | **This PR**: inventory, `docs/SHARED-SPEC.md`, merged `AGENTS.md` | — |
| 2 | Secret scan report (done in this session, see §8) | — |
| 3 | Hygiene: `.env.example` with all §7 vars, untrack `.env`, `public/_headers`, Worker deploy notes (D2), remove unused `cron-auth.ts`. Lovable backend config removed only after step 8 works. | D2 |
| 4 | Vendor `shared/`, `db/core/`, `scripts/migrate.mjs`, `migrate.yml`, CI `db` job | Hub Phase 1–2 merged |
| 5 | `db/migrations/0001_ledger_baseline.sql`: schema `ledger`, all tables of §2.1 with `org_id` + `created_by`, ported triggers and RPCs, RLS per §3.4 + MFA + overlay | D3, D4, D10 |
| 6 | `db/seed/0001_ledger_demo.sql` (port of `supabase/seed/demo.sql`) | 5 |
| 7 | `db/tests/`: port the 7 existing SQL suites + isolation, viewer can't write, read-only on expiry, posted immutable, balance check | 5 |
| 8 | Client: `shared/supabase/client.ts`, `VITE_APP_SCHEMA=ledger`, `.schema('public')` for core, regenerated types | 5, D5 |
| 9 | Org scoping via `shared/supabase/org.ts` (`oah_org` cookie) | 8 |
| 10 | Hosted vs self-hosted gating (D6, D7, D11) | 9 |
| 11 | `BillingBanner`, read-only write controls | 10 |
| 12 | Export: CSV per table + JSON bundle, read-only safe, tested (extends existing Export all / backups) | 8 |
| 13 | `ledger.api_*` views, `docs/INTEGRATION.md` | 5 |
| 14 | Design tokens + `AppShell` | Hub design PR approved |
| 15–16 | Help map + docs repo PR | 14 |
| — | Retire Lovable project `pzzmmltmghmgfwhgzlvl`, remove `supabase/config.toml`, `drizzle/`, `@lovable.dev/*` | Ledger live on shared project |

## 8. Secret scan (step 2 result)

Scanned the working tree and all 645 commits for `sb_secret_`, `sk_live_`/`sk_test_`, `whsec_`, service-role JWTs, private keys, Postgres URLs with passwords, `LOVABLE_API_KEY` and `BACKUP_SIGNING_SEED` values.

- **No secrets found.**
- `.env` and `.env.desktop` are committed. They contain only the **publishable** key, URL and project id of the Lovable project (public by design). They should still be untracked in step 3 so real values can't be committed later.
- `postgresql://postgres:postgres@127.0.0.1:54322/postgres` in CI and README is the local Supabase CLI default, not a real credential.

Nothing to rotate.

## 9. Owner actions now

1. Fill in SHARED-SPEC §0 (D1) and commit it to all repos.
2. Answer D2–D8 (accepting the proposals is fine).
3. Turn on GitHub secret scanning and push protection for this repo.
4. Leave the Lovable project running until step 8 is verified; then it can be retired.
