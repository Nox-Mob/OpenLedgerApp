# v0.0.4: Stability and foundations

Goal: make the app harder to break before the next big round of changes (desktop, deeper nonprofit accounting). No big new features. Work happens on a new `v0.0.4` branch; main stays on v0.0.3.

## What the review got right, and what I checked
- **History can silently go missing (confirmed).** Today, if saving a history entry fails, the change still goes through and the user sees "Success". That's the top priority.
- **Two package lock files (confirmed).** Both `bun.lock` and `package-lock.json` exist.
- **Possibly unused packages (partly confirmed).** Drizzle, `postgres` and `sql.js` need checking. `@lovable.dev/cloud-auth-js` is in use for Google sign-in, so it stays.
- **Loose version ranges (confirmed).** React, the database client, TanStack and the test tools all allow automatic upgrades.
- **The `.env` file:** left as is, per your instruction.
- **Already done:** shared adapter tests for memory and SQLite, signed backups, app-generated IDs, cash-basis-only scope. These just get extended.

## Planned work

### 1. Changes and their history save together (top priority)
- When a change and its history entry are saved, either both are kept or neither is. If history can't be saved, the change is undone and the user sees an error.
- Cloud: each history entry is saved in the same database step as the change it records. Desktop and test storage: the change and its history go in one save.
- An automated test simulates a history failure on every kind of change and checks that nothing was kept.

### 2. Three kinds of history
- Each history entry gets a kind: **change** (someone edited something), **money** (a posting or void), or **system** (backup, restore, import, invite, removal).
- The History page gets a filter for these. Existing entries are sorted into kinds automatically.

### 3. One workflow layer for everything
- Members, invites, pledges, budgets, backups, imports and categories move into the shared workflow code, as transactions and reports already did. The server code then only checks sign-in and permissions.
- A test fails if any server code writes to the database directly instead of going through the shared code.

### 4. Permissions written down in one place
- One fixed table says what each role can do (for example "void a transaction" or "invite members"). Every check reads from it. Organizations can't change it.
- Roles stay admin, member and viewer for now. A Bookkeeper role is easy to add later.

### 5. Wider shared tests
- The shared adapter tests also cover: blocking access across organizations, history, the history-failure rollback, and backup then restore.
- New scenario tests walk through a full year for a small nonprofit and a small business: opening balances, bank import, statement check, fund release, year-end close and reports, with expected totals checked to the cent.

### 6. Tooling cleanup
- Bun becomes the only package manager. `package-lock.json` is removed and the README is updated.
- A dependency review sorts every package into core, feature, desktop, development, or unused, and removes the unused ones. The list goes in `docs/dependencies.md`.
- Pin exact versions for React, TanStack (as one matching set), Vite, the database client, Vitest and TypeScript. Upgrades then happen on purpose, not by surprise.
- Clean up the roughly 17 remaining loose-type warnings in the backup code.

### 7. Backup format ready for the future
- The backup manifest also records the app version and leaves space for attachments later. Old version 2 backups still restore.

### 8. Architecture written down
- `docs/architecture.md` covers the layers (screens, workflows, accounting rules, storage), which rules live where, and the "keep it simple" stance: no microservices or extra infrastructure.
- AGENTS.md gets one rule for each new decision.

## Not in v0.0.4
Desktop app, sync, A/R and A/P, MFA, UI polish. They stay on the roadmap.

## Technical section
- Atomic audit (cloud): add `SECURITY DEFINER` Postgres functions for each audited mutation, or AFTER triggers that insert into `audit_log` using `auth.uid()`, so the audit row commits in the same transaction. `writeAudit()` is kept only for system events and throws on error. Add a `kind` column (`change|ledger|system`) with a backfill migration.
- Ports: add `UnitOfWork.run(fn)` to `src/lib/ports`. Memory and SQLite wrap it in BEGIN/COMMIT on one connection. Supabase delegates to an RPC for multi-step writes.
- New services under `src/lib/services/`: members, pledges, budgets, backup, import, taxonomy. Add a lint/test guard that `*.functions.ts` never calls `.from(` for writes.
- `src/lib/permissions.ts` becomes a declarative `ROLE_CAPABILITIES` map plus `can(role, capability)`, covered by an exhaustive test.
- contract.test.ts: add tenant isolation, audit and unit-of-work rollback, and a backup roundtrip through the ports.
- `src/lib/scenarios/*.test.ts`: fixture-driven yearly books with golden report totals.
- Dependencies: check whether drizzle-kit, drizzle-orm and postgres are still needed (migration tooling vs dead code). sql.js stays as a dev/test dependency if only the tests use it.
- Backup manifest: add `appVersion`, an optional `attachments`, and format v3. The verifier accepts v2 and v3.
- Every step runs the full CI: tests, tsgo, lint, prettier, check:migrations, build. CHANGELOG Unreleased and roadmap.md are updated as we go.
