<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# AGENTS.md — OpenLedgerApp (Nox-Mob/OpenLedgerApp)

**Read `docs/SHARED-SPEC.md` first. It is the contract for the whole suite.** Migration status, inventory and open decisions: `docs/MIGRATION-NOTES.md`.

App ID: `ledger` · Schema: `ledger` · Hosted URL: `ledger.<apex-domain>`

OpenLedgerApp becomes one of three sub-apps of OpenAppHub. In hosted mode, it shares one Supabase database, one login and one organization ID with the other apps, and the hub handles sign-up and payments. Self-hosted, it must still work entirely on its own. All existing data is demo/test data.

**Special situation:** Ledger isn't yet on the owner's own Supabase. Its backend may still be Lovable's managed backend, or it may not have a database yet. It gets built directly in the shared production project under schema `ledger`.

---

## Work order (one PR per step)

### Phase 1 — Inventory and hygiene

1. **Inventory PR.** Write `docs/MIGRATION-NOTES.md`:
   - Where does Ledger's data live today (Lovable-managed backend, local state, mock data)?
   - Every table, function and bucket it uses, from `supabase/migrations/`, `types.ts` or the code itself.
   - Every place in the code that calls a backend.
   - Which concepts map onto core (`organizations`, `memberships`, `profiles`).
   - Any data that relates to Charter or Board (for example, budgets approved by a board motion).
2. **Secret scan** of files and git history (§7). Report findings to the owner.
3. **Hygiene:** `.env.example`, `.gitignore`, `public/_redirects` and `_headers`, CI. Remove Lovable leftovers and any Lovable-managed backend config once the new backend works.

### Phase 2 — Database

4. **Vendor shared code** from OpenAppHub (`shared/`, `db/core/`, `scripts/migrate.mjs`) plus `migrate.yml` and the `db` CI job.
5. **Ledger baseline** in `db/migrations/0001_ledger_baseline.sql`: tables in schema `ledger` per the §3.4 template. Every org-scoped table gets `org_id → public.organizations`.
   - **Money:** `bigint` minor units (cents) plus a `currency char(3)` column, or `numeric(14,2)`. Never `float`. Pick one and use it everywhere.
   - **Integrity:** if Ledger records transactions or journal entries, posted entries must not be editable or deletable. Corrections are reversing entries. Enforce it with a trigger, not just the UI.
     - If Ledger uses double entry, add a constraint or trigger that debits equal credits per entry.
     - Model what the existing app already does. Don't invent accounting features beyond it; propose them in an issue instead.
   - Record `created_by` and `created_at` on every financial row (audit trail).
   - Storage buckets (receipts, attachments) use org-id path prefixes with `is_member` policies.
6. **Seed:** `db/seed/0001_ledger_demo.sql` with idempotent demo data.
7. **DB tests:** isolation, viewer can't write, read-only on expiry, posted entries immutable, and the balance check if applicable.

### Phase 3 — App code

8. **Supabase client:** use `shared/supabase/client.ts` (`VITE_APP_SCHEMA=ledger`). Use `.schema('public')` for core. Regenerate types.
9. **Org scoping** on every query and insert via `shared/supabase/org.ts`.
10. **Hosted vs self-hosted** per SHARED-SPEC §1.1.
11. **Billing state:** `BillingBanner`, write controls disabled when read-only, link to the hub's billing page.
12. **Export** of all Ledger data for the org (CSV per table, JSON bundle), available when read-only. For a ledger this matters most, so test it.
13. **Integrations:**
    - Publish `ledger.api_*` views (for example, budgets and period summaries: id, name, period, totals) with `security_invoker = true`.
    - Where Ledger links to Board decisions or Charter documents, store the id and read details via their `api_*` views, feature-detected.
    - Document everything in `docs/INTEGRATION.md`.

### Phase 4 — Design

14. Adopt `shared/design` tokens and `AppShell`. Reference app: token swap. Outlier: restyle to match in separate PRs with before/after screenshots, without changing behaviour.
    - Numbers are right-aligned with tabular figures (`font-variant-numeric: tabular-nums`); negatives follow `DESIGN.md`.

---

### Phase 5 — Documentation

Docs for this app live in the docs repo under `src/content/docs/ledger/` (SHARED-SPEC §12).

15. **Help links.** Add the app's help map (`src/config/help.ts`, using `shared/docs.ts`) and link these screens to their pages. In the desktop edition, links open in the system browser.

    | Screen | Docs path |
    |---|---|
    | User menu → Help | `ledger/` |
    | Onboarding | `ledger/start/setting-up/` |
    | Wording setting | `ledger/start/wording/` |
    | Import | `ledger/everyday/importing/` |
    | Statement check | `ledger/everyday/statement-checks/` |
    | Settings → Close the books | `ledger/reports/closing/` |
    | Settings → Exports (backup and restore) | `ledger/admin/backups-and-exports/` |
    | Settings → Security | `ledger/admin/security/` |
    | Settings → Users & roles | `ledger/admin/members-and-roles/` |
    | Desktop "isn't available in the desktop app yet" messages | `ledger/start/desktop-app/` |

16. **Docs PR for this migration.** Update the `ledger/` tab for what Phases 2–4 changed:
    - `ledger/start/editions.md` and `ledger/index.md`: the hosted edition's status, and how hosted sign-in works through the hub.
    - `ledger/admin/members-and-roles.md`: if Ledger's roles are mapped onto the shared core roles, update the permissions table to match exactly; in hosted mode, invitations happen in the hub.
    - `ledger/help/known-limits.md` and `ledger/help/faq.md`: the read-only state when a hosted plan lapses.
    - `ledger/help/self-hosting.md`: new setup steps.
    - Any screen renamed or moved by the design work in Phase 4.

From then on, every PR with a user-facing change has a matching docs PR (SHARED-SPEC §12.2). In particular, each step toward desktop parity (history, exports, backups, bank import) updates the lists in `ledger/start/desktop-app.md` and `ledger/help/known-limits.md`. The Ledger Solo plan (free desktop edition for one person) is described in `ledger/start/editions.md`; keep it in line with what the desktop release actually offers.

## Rules specific to this repo

- Never write to `public`, `billing`, `ops` or another app's schema.
- Financial calculations (totals, balances) happen in SQL or with integer arithmetic in TypeScript. Never sum floats.

## Done when

SHARED-SPEC §11 is satisfied, Ledger runs on the shared project, and a hub login carries over to `ledger.<apex-domain>` in the same org. The `ledger/` docs tab matches the app, and every Help link opens a real page.

---

## Codebase rules (still in force; where the migration changes one, `docs/MIGRATION-NOTES.md` says how)

- Double-entry: ≥2 entries, sum=0, both signs (deferred trigger; void exempt). amount_cents >0 debit, <0 credit.
- DB-enforced immutability: transactions only posted→void; entries only reconciliation_id; bank rows are evidence (FITID/hash+row_seq; link must match amount/account).
- Void: idempotent, blocked by completed reconciliation, unticks/unlinks in-progress evidence.
- Reconciliation finish needs difference=0 (DB trigger); completed ones lock entries.
- Audit rows: change + history in one DB transaction: post/void_transaction_atomic RPCs, else audited_write (src/lib/audited-write.ts). writeAudit() only for event-only history (e.g. backup export). Users can't INSERT audit_log.
- Org data: requireSupabaseAuth + assertCan + member RLS; settings/accounts admin-only.
- Terminology is presentation-only; reports/PDFs use org level only.
- Catalog archive: categories/tags/funds archive via is_active, projects via status='archived'; names stay unique across archived rows, so create returns {ok:false, archived} (UI offers restore) instead of a duplicate; restricted funds with money left can't be archived.
- Accounts: catalog-based; delete only if never used (domain/accounts.ts + DB trigger), otherwise archive. Names unique per org ignoring case/spaces (DB trigger backs it up).
- Dates YYYY-MM-DD in org.timezone; never toISOString.
- Reports: pure math; retained earnings derived; year-end close is virtual (no closing tx; legacy source='closing' excluded).
- Currency: two-decimal only, frozen once transactions exist.
- Idempotency keys: one per form submit; `bank:<id>`, `opening:<acct>:...`.
- AI PDF: org opt-in, upload ack, limits, balance or acceptMismatch.
- Legal acceptance append-only/versioned; U.S.-first; no GDPR claim. Demo login: manual dev seed only.
- CI, tests and migration-safety rules: see scripts/ci/AGENTS.md.
- Server functions: use createServerFn().validator(), never deprecated .inputValidator().
- Routing: public website owns `/`; the existing authenticated dashboard lives at `/ledger` so public visitors never need a session to read the website.
- Releases: two steps (docs/release-checklist.md); version/changelog date/architecture bump only after GitHub CI is confirmed green (release.test.ts). Desktop drafts build from main after all CI.
- MFA: org require_mfa enforced in DB via mfa_ok inside membership helpers; org row and own role stay visible to explain why.

- Domain rules: accounting invariants live in pure src/lib/domain/ (no storage imports) and run before every write; DB triggers are a backup, so a future SQLite edition gets the same guarantees.
- IDs: every new record gets an app-generated UUID (newId()), never a DB default, so identity survives future offline sync.
- Desktop/SQLite/backup: see src/lib/adapters, src/lib/domain AGENTS.md.
- Storage ports: data access goes through interfaces in src/lib/ports/ using models from src/lib/domain/models.ts (no DB types); adapters implement them so cloud and desktop share app code.
- Adapters/services: workflows live in src/lib/services/ (ports only); server functions do auth + assertCan, then call a service with createSupabaseRepositories(context.supabase). src/lib/adapters/memory is the reference adapter for tests and future SQLite parity.
- Funds: balances/restricted split derived from fund-tagged rows (domain/funds.ts); releases are balanced Net Assets to Net Assets (source 'release') so equity never changes.
- Members: organizations.created_by is the owner; invite links store only a SHA-256 hash of the token and are claimed atomically before the role is granted.
- Budgets/templates use ports; one budget row per account+period+scope, updated in place; recurring never auto-posts (key recurring:<tpl>:<date>). Exports/history cloud-only; exports escape formulas (src/lib/export.ts).
- Org delete needs deferrable "no action" FKs and a balance trigger skipping deleted transactions; keep new FKs deferrable.
- Package manager: npm only (package-lock.json, installed with npm ci); no bun.lock, so every install resolves the same tree.
- Permissions: CAPABILITIES in src/lib/permissions.ts is the only role table; permissions.test.ts pins every cell so changes are deliberate.
- Direct table writes: *.functions.ts never write tables directly (services or audited_write); only cloud-only non-book records may, each marked `// cloud-only-write: <reason>`. Enforced by direct-writes.test.ts as its own CI step.
- Inputs: amounts, dates and names go through src/lib/validation.ts on both form and server so every form shows the same message.
- Page states: lists use PageStates.tsx components; read errors with errorMessage() (src/lib/errors.ts), never `catch (e: any)`.
- Types: no-explicit-any is an error in app code (tests exempt); typed client is `Db`, table-walking backup code uses `UntypedDb` (src/lib/db.ts).
- Periods: month close/reopen only move books_locked_through (services/periods.ts); moving it back needs a saved reason so no lock change goes unexplained.
- Edition: isDesktop() is the only desktop check; server fns wrapped in desktopAware() (docs/desktop.md).
