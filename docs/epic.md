# Epic Map

The to-do list for OpenLedgerApp, in the same shape as OpenCharterApp's `docs/epic.md`. Section 1 is what's left for the OpenAppHub suite migration to be "done"; the same items (S-xx) are tracked in every app. Section 2 is Ledger's own remaining migration step. Section 3 is the product roadmap (`roadmap.md` keeps the version history and points here). Section 4 lists known issues.

Status: ✅ done, 🟡 done with follow-ups, 🟠 partly done, ⬜ not started.

## 1. Suite migration: what's left

| ID   | Item                          | What "done" means                                                                                                                                                                                                                                    | Status (2026-11-11)                                                                           |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| S-01 | Production check              | After each production deploy, open the app on openapphub.org as a real organization and confirm its data loads (the Charter Members tab was empty until 2026-11-11 because of a renamed key). The staging end-to-end tests catch most of this first. | 🟡 staging checked by e2e; production not yet checked by a person                             |
| S-02 | Exposed schemas               | `charter`, `board` and `ledger` in Supabase → Data API → Exposed schemas, on staging and production (owner).                                                                                                                                         | ✅ 2026-11-11                                                                                 |
| S-03 | Integration views for the hub | Read-only `api_*` views (`security_invoker`) and `docs/INTEGRATION.md`, so OpenAppHub's dashboard can show a summary per app (SHARED-SPEC §6).                                                                                                       | ⬜ not started (`api_budgets`, `api_period_summaries`)                                        |
| S-04 | Help links                    | A per-page help map (`src/config/help.ts`) pointing at the docs site; today the shell has one Help link for the whole app.                                                                                                                           | ✅ 2026-11-11: `src/config/help.ts`; the Help link opens the docs page for the current screen |
| S-05 | Read-only when billing lapses | The database already refuses writes when an organization's trial or plan has lapsed; the screens should show it (billing banner) and switch write controls off.                                                                                      | 🟠 banner shown; write controls partly respect the role, not billing                          |
| S-06 | Export everything             | Owners and admins can export all of the app's data (CSV and JSON or the app's own format), also while read-only.                                                                                                                                     | ✅ Export all (Excel and PDF) and signed backups                                              |
| S-07 | Old build tooling             | Remove what only the old editor needed: its Vite config wrapper, preview sign-in storage, error reporting, its project folder and the old `supabase/` folder.                                                                                        | ✅ 2026-11-11 (its plans deleted too)                                                         |
| S-08 | Worker secrets                | Secrets the hosted app needs, on the production Worker and in the Preview base config for staging (owner; never in the repository).                                                                                                                  | ⬜ `BACKUP_SIGNING_SEED` (production set; staging previews not)                               |
| S-09 | End-to-end tests              | Playwright on a local dev server against staging and the suite demo, in CI on every pull request and daily.                                                                                                                                          | ✅ 2026-11-11 (`e2e.yml`, 11 tests)                                                           |
| S-10 | Retire the old projects       | The old editor and Supabase projects, once the app has run on the shared projects for a while (owner).                                                                                                                                               | ⬜ owner (project `pzzmmltmghmgfwhgzlvl`)                                                     |
| S-11 | One look across the suite     | Same shell, menus and settings pattern as the other apps; differences found are listed under Known issues.                                                                                                                                           | ✅ shared AppShell; settings in the left sidebar (2026-11-11); one logo family (shared 1.5.0) |

## 2. Ledger-only migration step

| ID   | Item                                  | What "done" means                                                                                                                               | Status (2026-11-11)                                                                                                   |
| ---- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| L-01 | AI PDF import off (migration step 3b) | Hide the option, the server refuses, remove the AI gateway call (`src/lib/import.functions.ts`); docs: importing, troubleshooting, known limits | ✅ 2026-11-11: PDF option, server path, AI gateway call and Settings toggle removed; docs site already says it is off |

## 3. Product roadmap

| ID   | Epic                                                                                                                                                                    | Status       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| L-10 | People checks: a screen-reader pass by a person; the password reset email checked by hand                                                                               | ⬜ v0.0.8    |
| L-11 | Desktop parity: history, exports, backups and bank import on desktop                                                                                                    | ⬜ v0.1.2    |
| L-12 | Hardening: self-hosted installer, upgrade tests, cross-version restore, user testing with non-accountants, disclosure policy and contact                                | ⬜ v0.1–v0.9 |
| L-13 | v1.0 gates: accounting correctness, security tests, real-statement import, backup recovery, install and upgrade, non-accountant usability, support and disclosure pages | ⬜           |
| L-14 | Budgets, exports and history behind the ports for desktop                                                                                                               | ⬜ backlog   |
| L-15 | README terminology note, currency rules, undo wording                                                                                                                   | ⬜ backlog   |
| L-16 | Later, not scheduled: desktop sync, accrual basis, A/R and A/P, invoices and bills, bank feeds, receipt attachments                                                     | ⬜ deferred  |

## 4. Known issues (2026-11-11)

- The **Getting started** tutorial (0 of 8) opens for the demo account on every visit. The demo seed should mark it done so demonstrations and screenshots start clean.
- The test account sees Ledger's own **Before you continue** terms step; with hosted sign-in the hub already asks for the terms, so hosted Ledger could skip its own step.
