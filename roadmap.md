# OpenLedgerApp — Roadmap

## Road to v1.0 (plan approved 2026-10-08, updated 2026-10-10)

- v0.0.6 Safety, controls and reports (released 2026-10-08): MFA, delete my account, session safety, rollback tests, structural direct-write rule, .env check, full dependency audit, keyboard walk-through, release checklist, plus early items: general ledger, account activity, fund and statement check reports, drill-down, cash basis labels, 50k speed test, Export all (Excel and PDF), accounting-format Excel, plain report names, treasurer role, plain-language error pop-ups with on-screen and nothing-recorded tests.
- v0.0.7 Concurrency and periods (released 2026-10-10): same request sent twice at once (double post, void, close, restore), month close with warnings, audited reopen with a reason (pulled in from v0.0.8).
- v0.0.8 People checks (moved from v0.0.7): [ ] screen reader pass by a person, [ ] password reset email checked by hand
- v0.1.1 Everyday use (in progress, plan 2026-10-28): [ ] templates and recurring drafts (never auto-posted; org picks drafts list or reminder), [ ] search and filters, [ ] fund and project budgets, [ ] board package (one PDF: income, balance, budget vs actual, fund activity), [ ] first-run checklist, [ ] tutorial on/off switch (getting started + routine), [ ] diagnostics page, [ ] all of the above on desktop, [ ] desktop parity for earlier cloud-only features (funds/pledges, categories/tags, history, exports, backups, bank import)
- v0.1 to v0.9 Hardening: [ ] self-hosted installer, [ ] upgrade tests, [ ] cross-version restore, [ ] user testing with non-accountants, [ ] disclosure policy and contact
- v1.0 gates: accounting correctness, security tests, real-statement import, backup recovery, install and upgrade, non-accountant usability, support and disclosure pages. Desktop is a separate track.

## Released

- v0.1.0 (2026-10-10), v0.0.7 (2026-10-10), v0.0.6 (2026-10-08), v0.0.5 (2026-10-08), v0.0.4 (2026-10-07), v0.0.3 (2026-10-07), v0.0.2, v0.0.1 (2026-10-01). Details in CHANGELOG.md.

## Future (unscheduled, not assigned to a version)

- Local desktop edition: Tauri + embedded SQLite, offline use. v0.1 ships a first preview as draft installers (core books only); members, imports, budgets, funds, backups, exports and history still need local storage.
- Optional sync between desktop and cloud (chained history log, signed uploads, server re-check).
- Distribution goal: free local desktop, self-hosted community edition, managed cloud. Cloud pricing and donations undecided.

## Open backlog

- [ ] Budgets, exports and history behind the ports for desktop
- [ ] README terminology note, currency rules, undo wording
- Deferred: accrual basis, A/R and A/P, invoices/bills, bank feeds, receipt attachments

## Notes

- Demo login (demo@demo.org) is signed out automatically on published sites unless VITE_ALLOW_DEMO_LOGIN=true.
