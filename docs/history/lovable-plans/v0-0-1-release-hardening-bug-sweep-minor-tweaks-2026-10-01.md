# v0.0.1 Release Hardening — Bug Sweep + Minor Tweaks

Goal: no new features. Find and fix what would embarrass a first release: security gaps, crashes, dead ends, confusing states.

## 0. Real data is never deleted on startup or restart (top priority)
- A first scan found nothing in the app's startup, setup steps, or database setup that clears data. The only delete commands are in the database rule tests, and those run on a throwaway test database.
- Add guards anyway: the database test scripts refuse to run unless they're pointed at a local throwaway database. The sample-data script refuses to run if it finds any organization other than the two demo ones. Database setup steps are only ever added to, never re-run from scratch.
- Add a CI check that blocks the build if any database setup step contains a delete, truncate, or drop-table command.
- Restart test: create a real-looking organization, restart the app and backend, and confirm everything is still there.
- Document in AGENTS.md and the README: "Startup never resets data."

## 1. Security sweep
- Run the full backend security scan and database linter; fix every real finding (missing access rules, overly broad grants, functions without a fixed search path).
- Review every server action for a missing role check or missing organization check (one-pass audit against the permissions list).
- Demo account on a published site: keep the sample data (per your rule), but make demo sign-in refuse on published hosts unless the self-hoster explicitly turns it on. The sample orgs stay intact for dev/preview.
- Confirm no secrets or admin-only database access can reach the browser bundle.

## 2. End-to-end smoke test (automated, repeatable)
A browser script that signs in as the demo user and walks every page: dashboard, accounts, transactions (create, void), import (CSV test file), reconciliation, reports (each tab + PDF), settings (each section), close the books, legal pages. It records any page crash, console error, or failed request. Every failure found is fixed in this round. The script is added to the repo so it can be re-run before each release.

## 3. Stability and rough edges
- Every page gets a friendly error screen and a "not found" screen instead of a blank page.
- Empty states for new organizations (no transactions, no accounts used, no imports, no reports data).
- Form validation pass: required fields, negative/zero amounts, future dates, very long text, duplicate account names — clear messages, no raw database errors shown to users.
- Loading states on buttons that save, so double-clicks can't double-submit anywhere (beyond the guards already in place).
- Basic accessibility pass: labels on inputs, keyboard focus on dialogs, readable contrast.
- Page titles and share descriptions on every page.

## 4. Housekeeping
- Clean up the roadmap: mark stale duplicate items (old "Org settings depth" block, old demo email notes) as done or removed, so the list reflects reality.
- Apply the one-time formatting pass (clears the 1,711 style findings) and make formatting blocking in CI. Reduce loose types in the riskiest files (money, reports, transactions) only.
- README: add a "before you release" checklist (run tests, smoke test, DB checks, replace legal placeholders, disable demo).

## Out of scope
Fund accounting (14), exports/backups (15), invites/ownership (16), MFA, budgets — stay on the roadmap for after v0.0.1.

## Technical details
- Security: `security--run_security_scan`, `supabase--linter`; grep `*.functions.ts` for handlers lacking `requireSupabaseAuth` + `assertCan`.
- Demo gate: server-side check in the sign-in path via env flag `ALLOW_DEMO_LOGIN` (default off on non-preview hosts); hint visibility logic unchanged.
- Smoke test: `scripts/smoke/smoke.py` (Playwright), run locally against localhost:8080; not part of CI since it needs a seeded backend.
- Error UI: route `errorComponent` / `notFoundComponent` on root and authenticated layout.
- Formatting: `bun run format` once, then flip the CI format step to blocking.
