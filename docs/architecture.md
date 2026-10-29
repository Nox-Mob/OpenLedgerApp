# OpenLedgerApp architecture

Current as of v0.1.0. One accounting application, several storage deployments. Keep it boring: a single app plus Postgres (cloud, self-hosted) or SQLite (desktop, future). No microservices, queues, caches or extra infrastructure.

```text
React screens (src/routes, src/components)
        |
Server functions (src/lib/*.functions.ts)   sign-in + assertCan only
        |
Services / workflows (src/lib/services)     use ports only
        |
Domain rules (src/lib/domain)               pure, no storage imports
        |
Ports (src/lib/ports)  ->  adapters: supabase | sqlite | memory
        |
Database guards (RLS, triggers, atomic RPCs) second line of defense
```

Status labels used below: **Implemented and tested**, **Implemented, partly verified**, **Planned**, **Not supported**.

## Layers

- **Screens** never talk to storage directly; they call server functions. Lists use the shared `EmptyState` / `LoadingState` / `ErrorState` components.
- **Server functions** authenticate (`requireSupabaseAuth`), authorize (`assertCan` against the `CAPABILITIES` table in `src/lib/permissions.ts`), validate input (`src/lib/validation.ts`), then call a service. They never write tables directly; `src/lib/direct-writes.test.ts` fails CI on any unmarked write. Only cloud-only non-book records (sign-in profile, legal acceptance, AI usage meter, deleted-org log) may, each marked `// cloud-only-write: <reason>`.
- **Services** (`src/lib/services`) hold workflows: ledger posting and voiding, statement checks, reports, funds, settings and year-end close. They only see ports.
- **Domain** (`src/lib/domain`) holds pure accounting rules (balanced entries, fund math, account deletion rules, budgets, backup hashing). Every rule here runs before every write.
- **Ports and adapters**: `src/lib/ports` defines storage interfaces using models from `src/lib/domain/models.ts`. Adapters: `supabase` (cloud and self-hosted), `memory` (reference adapter for tests), `sqlite` (sql.js today, groundwork for desktop).

## Status by area

| Area                                                                                                   | Status                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Double-entry posting, void, immutability                                                               | Implemented and tested (domain, contract tests, database checks)                                                         |
| Change and history saved in one database transaction                                                   | Implemented and tested for postings, voids, statement checks, month and year-end close, reopen and audited_write changes |
| Tenant isolation (RLS)                                                                                 | Implemented and tested (database checks run in CI)                                                                       |
| Permissions table (admin, treasurer, member, view only)                                                | Implemented and tested (every cell pinned, treasurer database check)                                                     |
| Plain-language error pop-ups (nothing recorded on failure)                                             | Implemented and tested (on-screen tests, unchanged-books checks)                                                         |
| Reports: general ledger, account activity, funds, statement check, drill-down, Export all (Excel, PDF) | Implemented and tested (pure math, 50k-line speed test)                                                                  |
| Two-step sign-in (org can require it)                                                                  | Implemented and tested (database checks, rule tests)                                                                     |
| Delete my account; organization delete in one step                                                     | Implemented and tested                                                                                                   |
| Architecture boundaries (no direct table writes, admin client allowlist)                               | Enforced by src/lib/architecture.test.ts in CI                                                                           |
| Signed backups and restore into a new organization                                                     | Implemented and tested (memory adapter roundtrip, tamper rejection)                                                      |
| Budgets, templates, funds, pledges, categories, tags, projects (with archive)                          | Implemented and tested on cloud and desktop (memory and SQLite contract tests)                                           |
| Exports, history viewer, backups, bank import on desktop                                               | Cloud only for now (desktop says so and records nothing)                                                                 |
| SQLite adapter                                                                                         | Implemented, partly verified (sql.js only, not a native desktop driver)                                                  |
| Desktop start flow (no website or sign-in; setup or ledger from the local file)                        | Implemented, run in a native Tauri build on Linux                                                                        |
| Desktop edition (Tauri), offline use                                                                   | Preview: core books work offline; Linux install checked in CI; draft installers per release                              |
| Desktop and cloud sync                                                                                 | Not supported                                                                                                            |
| Multi-currency, payroll, invoicing, bank feeds                                                         | Not supported                                                                                                            |

## Where rules live

- If a rule can be unit-tested without a database, it belongs in `src/lib/domain/` and runs before every write.
- The database enforces what it is best at: foreign keys, uniqueness (case and space insensitive names), RLS, immutability triggers, books lock, reconciliation balance, atomicity. These are a second line of defense, mirrored in the SQLite schema.
- Every adapter must pass `src/lib/adapters/contract.test.ts`.

## Changes and history are saved together

Every data change and its history entry are written in one database transaction; if either fails, both roll back.

- Postings and voids: `post_transaction_atomic` / `void_transaction_atomic`.
- Month close and reopen (`src/lib/services/periods.ts`): move the books lock with its history entry in one call; moving it back requires a written reason. Concurrency tests (`services/concurrency.test.ts`) prove double submits record once.
- Year-end close: the close record, the books lock and the history entry in one call (`PeriodCloseRepository.closeAndLock`).
- Everything else: `audited_write(org, ops, audit)`, called through `src/lib/audited-write.ts` or port methods that take an optional `audit` argument. It runs as the caller, so RLS still applies, works only on an allowlist of tables, and stores the change the database actually applied in `audit_log.recorded_change`.
- Users cannot insert, edit or delete history rows; the history helper refuses to run outside `audited_write`.
- `writeAudit()` is only for event-only history with no data change (for example a backup export).
- Memory and SQLite adapters wrap the same change in their own transaction.

## Identity and sync

- IDs are app-generated UUIDs (`newId()`), never database defaults. Posted transactions are immutable (void and re-post), which keeps future event-based sync possible. Sync is not scheduled.

## Backups

- Format v3: signed Ed25519 manifest over chained per-row SHA-256 hashes, app version recorded. Restore always creates a new organization with new IDs, re-runs domain checks, and deletes the partial organization if anything fails. CSV and Excel exports are read-only copies, not backups. See `src/lib/domain/backup.ts`.

## Sign-in and sessions

- Access is checked on every request by row level security, so a removed member loses access on their next request.
- When an organization requires two-step sign-in, its books are hidden in the database from sessions that didn't use it; `assertCan` gives the clear message.
- Deleting an account leaves history, transactions and closes in place with the old user id (no link to the sign-in table), shown as "Deleted user".

## Build and CI

- Release steps: docs/release-checklist.md.
- Organization settings: a database trigger refuses settings changes from signed-in non-admin users (treasurers may still lock books and close the year); server and maintenance steps are not blocked.

- npm 11+ only (`package-lock.json`, `npm ci`), Node 24 in CI.
- CI runs: tests, direct-writes check, type check, lint, formatting, migration checks (GRANTs and RLS), disposable-database safety checks (`supabase/tests/*.sql`), runtime dependency audit, build.
- Database changes live in both `drizzle/migrations` (applied by Lovable) and `supabase/migrations` (loaded by CI and self-hosters); keep them in sync.
