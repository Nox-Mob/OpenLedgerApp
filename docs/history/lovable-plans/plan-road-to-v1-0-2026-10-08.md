# Plan: road to v1.0

Based on the security and controls review and the 1.0 feature review. Both say: keep the current design, no rewrite, and make 1.0 about trust (correct books, reconciliation, nonprofit funds, permissions, recovery) rather than a long feature list.

1.0 is the **web edition** (cloud and self-hosted). Desktop ships separately, only when its native storage is proven.

## Review findings and how each is handled

| Finding | Action | Release |
| --- | --- | --- |
| .env is tracked in Git | Keep it (Lovable needs it). It only holds public keys. Add a CI check that fails if any private key shape ever appears in it; document why it is tracked | v0.0.6 (done) |
| Prove "change and history roll back together" everywhere | Add a failure test for every remaining high-impact change: member removal, ownership transfer, org delete, invite claim, settings | v0.0.6 (done) |
| Direct-write check is text matching only | Add a code-structure rule that also catches multi-line calls, helper functions and admin-client use outside approved files | v0.0.6 (done) |
| Dev-only packages not audited | Add a separate full audit that reports but does not block | v0.0.6 (done) |
| Architecture doc out of date | Done in this change | now |
| Concurrent requests (double close, double post) | Tests that send the same request twice at once | v0.0.7 (still open) |
| SQLite tested with sql.js only | Native driver tests before any desktop release | Desktop track |

## v0.0.6 - Safety, controls and reports (released 2026-10-08)

Done: MFA (org can require it), delete my account, session safety, rollback tests, structural direct-write rule, .env check, full dependency audit, keyboard walk-through, release checklist.
Pulled in early: all v0.0.7 reports (general ledger, account activity, statement check, drill-down, cash basis labels, fund reports, 50k speed test), Export all to Excel and PDF, accounting-format Excel, plain report names in Settings, treasurer role and plain-language error pop-ups from v0.0.8.

## v0.0.7 - Concurrency and people checks

1. Tests that send the same request twice at once: double post, double close, double restore.
2. Screen reader walk-through by a person.
3. Password reset email checked end to end by hand.

## v0.0.8 - Periods

1. Month close with warnings (unreconciled accounts, open statement checks).
2. Audited reopen by an admin or treasurer.

## v0.0.9 - Everyday use

1. Transaction templates and recurring drafts (never auto-posted).
2. Search and filters across transactions.
3. Budget vs actual for funds and projects; board report package (one PDF).
4. Guided first-run checklist; support and diagnostics page (version, database type, last backup).
5. Tutorial on/off switch: a guided walkthrough for getting started (starting balances, checking and other accounts, adding transactions, importing and checking statements) and for the ongoing routine (regular entries, monthly statement check and month close, year-end). Can be turned off and back on any time.

## v0.1.0 to v0.9.x - Hardening

- Self-hosted installer and tested upgrade from the previous release.
- Backup restore tested across versions.
- Real users (non-accountants) complete common tasks with the docs.
- Security disclosure policy and contact published.

## v1.0 release gates (all required)

1. Accounting correctness: every report ties to the ledger.
2. Security and permissions: isolation, authorization and membership changes covered by automated tests.
3. Import and statement checks work end to end on a real statement.
4. Backup and recovery: full restore works; a failed restore changes nothing.
5. Clean install and upgrade both work.
6. A non-accountant can do common tasks.
7. Support, privacy and vulnerability-reporting pages published.

## Left out of 1.0

Bank feeds, invoices and bills, payroll, multi-currency, desktop and cloud sync, donor CRM, custom report builder, consolidation across organizations. AI statement reading stays opt-in and never posts by itself.

## Technical details

- .env check: CI step greps `.env` for `service_role`, `sb_secret_`, and JWT payloads with role service_role; fails if found.
- Structural direct-write rule: a custom ESLint rule (AST) over `src/lib/*.functions.ts` and `src/routes/**` flagging `.from(...).insert|update|delete|upsert` chains and `client.server` imports outside an allowlist; existing regex test stays.
- Atomicity tests use the memory adapter plus new `supabase/tests/*.sql` checks with a forced failure after the data step.
- Treasurer role needs a new `app_role` enum value (additive migration) and new CAPABILITIES rows pinned by test.
- Month close reuses `books_locked_through` and period_closes; reopen goes through audited_write.
