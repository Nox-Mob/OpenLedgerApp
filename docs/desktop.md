# Desktop edition (Phase 4) — SQLite bridge

Status: storage layer done and tested; the Tauri shell itself is not built yet.

## What exists

- `src/lib/adapters/sqlite/` — SQLite implementation of every repository port.
  - `schema.ts`: append-only migrations, applied on each start by `migrateSqlite()`.
  - Guards that mirror the Postgres triggers: entries and transactions can't be edited
    or deleted, void can't be undone, books lock, audit log is append-only, finished
    statement checks lock their entries, bank rows dedupe by FITID or hash+row,
    and a bank row can only link to a transaction with a matching amount and account.
  - Balance check at commit time (SQLite has no deferred constraints).
- `sqljs-driver.ts` — WebAssembly SQLite driver used by tests.
- `src/lib/adapters/contract.test.ts` — the same workflow tests run against the
  memory adapter and the SQLite adapter. Any new adapter must be added here.

## Wiring the Tauri shell (next step, needs Rust toolchain on a dev machine)

1. `npm install @tauri-apps/api @tauri-apps/plugin-sql` and `cargo tauri init`;
   enable `tauri-plugin-sql` with the `sqlite` feature.
2. Driver (plugin-sql already matches `SqlDriver`):
   ```ts
   import Database from "@tauri-apps/plugin-sql";
   const raw = await Database.load("sqlite:openledgerapp.db");
   const driver = {
     execute: (sql, p) => raw.execute(sql, p),
     select: (sql, p) => raw.select(sql, p),
   };
   await migrateSqlite(driver);
   const repos = createSqliteRepositories(driver);
   ```
3. A desktop build calls `src/lib/services/*` directly from the UI with these repos
   (no server functions, no sign-in; one local user is the admin).
4. Build as a static SPA (no SSR) for the Tauri webview.

## Known limits

- plugin-sql uses a connection pool; `BEGIN/COMMIT` must run on one connection.
  Set the pool to a single connection or move `post()` into one Rust command.
- Ready for the desktop UI through `src/lib/services/`: transactions, opening balances,
  bank rows (`ledger.ts`), statement checks (`reconciliation.ts`), reports (`reports.ts`),
  and organization settings, books lock and year-end close (`settings.ts`).
- Still cloud-only: member management, sign-in/legal acceptance, file import parsing and
  AI PDF reading, categories/tags/funds setup. These need ports before the desktop UI can use them.
- Sync between desktop and cloud is not designed yet; app-generated UUIDs keep that possible.

## Startup flow

- `npm run tauri dev` runs `dev:desktop` (`--mode desktop`, which loads `.env.desktop` with `VITE_EDITION=desktop`); `build:desktop` builds a static single-page app, then `scripts/desktop/prepare-dist.mjs` copies it into `desktop-dist/` with `index.html` as the start page (the build only writes `_shell.html`, which left the window blank).
- `isDesktop()` (`src/lib/edition.ts`) is the only edition check. On desktop, website and sign-in pages redirect via `desktopEntryRedirect`: no local organization opens `/onboarding`, otherwise `/ledger` for the last-used organization.
- The signed-in layout uses one fixed local user (`LOCAL_USER_ID`) as admin; no sign-in or legal acceptance gate.
- Organization setup saves through `createOrganizationWithAccounts` with the local SQLite file (`src/lib/desktop/local-repos.ts`).
- Every exported server function is wrapped with `desktopAware(name, fn)` (`src/lib/desktop/bridge.ts`). On desktop the call goes to `callLocal` in `src/lib/desktop/local-api.ts`, which runs the same `src/lib/services/*` workflow against the local SQLite file; on the web it calls the server as before. Pages need no changes.
- Answered locally: organizations and settings, account setup, accounts and opening balances, transactions (post, void, list), bank rows (list, post), all reports, books lock, month and year close, reopen, and statement checks.
- Local since v0.1.1: templates and recurring drafts, transaction search and filters, budgets (whole org or project), board package, first-run checklist, tutorial and diagnostics.
- Not yet local (shows "isn't available in the desktop app yet. Nothing was recorded."): members and invites, account deletion, bank file import and PDF reading, funds and pledges (fund budgets need local funds), categories and tags (lists are empty), backups, exports and history. Each needs a port and SQLite tables first.
