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

# AGENTS.md — OpenLedgerApp

- Double-entry: ≥2 entries, sum=0, both signs (deferred trigger; void exempt). amount_cents >0 debit, <0 credit.
- DB-enforced immutability: transactions only posted→void; entries only reconciliation_id; bank rows are evidence (FITID/hash+row_seq; link must match amount/account).
- Void: idempotent, blocked by completed reconciliation, unticks/unlinks in-progress evidence.
- Reconciliation finish needs difference=0 (DB trigger); completed ones lock entries.
- Audit rows: change + history in one DB transaction: post/void_transaction_atomic RPCs, else audited_write (src/lib/audited-write.ts). writeAudit() only for event-only history (e.g. backup export). Users can't INSERT audit_log.
- Org data: requireSupabaseAuth + assertCan + member RLS; settings/accounts admin-only.
- Terminology is presentation-only; reports/PDFs use org level only.
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
- Desktop/SQLite/backup rules: src/lib/adapters/AGENTS.md, src/lib/domain/AGENTS.md.
- Storage ports: data access goes through interfaces in src/lib/ports/ using models from src/lib/domain/models.ts (no DB types); adapters implement them so cloud and desktop share app code.
- Adapters/services: workflows live in src/lib/services/ (ports only); server functions do auth + assertCan, then call a service with createSupabaseRepositories(context.supabase). src/lib/adapters/memory is the reference adapter for tests and future SQLite parity.
- Funds: balances/restricted split derived from fund-tagged rows (domain/funds.ts); releases are balanced Net Assets to Net Assets (source 'release') so equity never changes.
- Members: organizations.created_by is the owner; invite links store only a SHA-256 hash of the token and are claimed atomically before the role is granted.
- Budgets and templates go through ports (services/budgets.ts, services/templates.ts); one budget row per account+period+fund/project scope, updated in place; recurring templates never auto-post (key recurring:<tpl>:<date>). Exports/history still cloud-only; exports escape formula-like text via src/lib/export.ts.
- Org delete needs deferrable "no action" FKs and a balance trigger skipping deleted transactions; keep new FKs deferrable.
- Package manager: npm only (package-lock.json, installed with npm ci); no bun.lock, so every install resolves the same tree.
- Permissions: CAPABILITIES in src/lib/permissions.ts is the only role table; permissions.test.ts pins every cell so changes are deliberate.
- Direct table writes: *.functions.ts never write tables directly (services or audited_write); only cloud-only non-book records may, each marked `// cloud-only-write: <reason>`. Enforced by direct-writes.test.ts as its own CI step.
- Inputs: amounts, dates and names go through src/lib/validation.ts on both form and server so every form shows the same message.
- Page states: lists use PageStates.tsx components; read errors with errorMessage() (src/lib/errors.ts), never `catch (e: any)`.
- Types: no-explicit-any is an error in app code (tests exempt); typed client is `Db`, table-walking backup code uses `UntypedDb` (src/lib/db.ts).
- Periods: month close/reopen only move books_locked_through (services/periods.ts); moving it back needs a saved reason so no lock change goes unexplained.
- Edition: isDesktop() is the only desktop check; server fns wrapped in desktopAware() (docs/desktop.md).
