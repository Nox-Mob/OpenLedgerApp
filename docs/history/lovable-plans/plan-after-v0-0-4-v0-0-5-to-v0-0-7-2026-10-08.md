# Plan: after v0.0.4 (v0.0.5 to v0.0.7)

v0.0.4 is released (2026-10-07). The groundwork is in place: every change is saved together with its history, all features go through shared code, permissions sit in one table, backups are signed, and CI checks all of it. The next three releases build on that groundwork, smallest risk first.

## v0.0.5 - Close the gaps and tidy up

Goal: no known loose ends left from v0.0.4, and dependencies kept current.

1. **Year-end close in one step.** Saving "year closed" and locking the books now happen together; today the record can be left on its own if the lock fails.
2. **Pledge payment in one step.** The payment and the pledge's new status are saved together.
3. **Trusted history descriptions.** The server writes each history description from the real change, so a user can't attach a misleading one.
4. **Remove the unused database config tool** (drizzle-kit): clears two outdated-part warnings.
5. **Charts upgrade** (recharts 2 to 3) on the dashboard's two charts, with screenshots before and after.
6. **Code checker upgrade** (eslint 9 to 10) and its settings.
7. **Fewer loose types** in older code, so the checker's warnings drop to zero.
8. **Tests for each item above**, including database checks for 1 to 3.

## v0.0.6 - Safety and everyday use

Goal: features people expect before using it for real books.

1. **Two-step sign-in (MFA)** with an authenticator app, optional per user, with an admin setting to require it for the organization.
2. **Delete my account**: blocked while you own an organization; your name stays on history entries as "deleted user".
3. **Organization switcher** in the sidebar for people in more than one organization.
4. **Empty, loading and error screens** on every page, with plain-language messages.
5. **Accessibility pass**: keyboard use, focus, labels, contrast in both themes.
6. **Input checks**: shared rules for amounts, dates and names, same message on every form.
7. **Account catalog**: stop duplicate account names; delete an account only if it was never used (otherwise archive).

## v0.0.7 - Scale and portability

Goal: stays fast with real-world volume and moves the remaining cloud-only features toward desktop.

1. **Performance at 10,000 to 50,000 ledger lines**: test data at that size, timing targets for reports, register and import, and indexes where needed.
2. **Budgets, exports and history behind the shared storage layer**, so a future desktop edition gets them too.
3. **"Cash basis" labels** on reports so the method is stated clearly.
4. **Self-hosted installer, first version**: one script that asks hosted versus self-hosted database, writes the local settings file, applies database changes safely, builds and starts the app.

## Stays in Future (unscheduled)

Desktop edition, desktop and cloud sync, accrual basis, invoices and bills, bank feeds, receipt attachments, cloud pricing.

## Technical details

- 1 to 3 of v0.0.5 use new migrations (one RPC for close+lock, pledge payment folded into audited_write ops, server-built audit descriptions); existing migrations stay untouched.
- MFA uses the built-in auth TOTP factors; the org "require MFA" flag is checked in requireSupabaseAuth-backed server functions, not only in the UI.
- Account deletion goes through a server function using the admin client after ownership checks; history rows keep user_id, display name resolved as "deleted user".
- Performance work adds a seeded load fixture for the memory adapter plus an optional local-database run; no seed data in migrations.
- Every release keeps the rules: npm 11+, direct-writes check at zero, permissions table pinned, CHANGELOG as the only release notes.
