# Changelog

Notable changes to OpenLedgerApp are recorded here. This project follows the structure of Keep a Changelog. Pre-1.0 software remains under active development.

## [Unreleased]

### Added

- Templates: save a transaction you repeat (name, accounts, amount). Templates can repeat weekly, monthly, every 3 months or yearly. Nothing posts by itself: each due date waits in a Ready to review list (post or skip), or, if the organization picks reminders, shows a notice. Posting the same due date twice still makes one transaction.
- Transaction search and filters: description or note, dates, account, project, fund, amount range, status, source and checked against statement. Filters stay in the page address and results export to CSV.
- Fund and project budgets: set budgets for the whole organization, one fund or one project, and compare to actuals for that scope only.
- Board package: one PDF with a cover page, income statement, balance sheet, budget vs actual and (nonprofits) fund activity.
- First-run checklist on the dashboard that ticks itself off and can be hidden.
- Tutorial: an on/off guided tour (getting started and the weekly, monthly and yearly routine), switched in Settings, Your preferences.
- Diagnostics page for admins and treasurers: version, edition, book health checks, and a copyable report with no names or amounts.
- Desktop: templates, recurring drafts, search, budgets, board package, checklist, tutorial and diagnostics all work from the local file (desktop database version 3).

## [0.1.0] - 2026-10-10

### Added

- Desktop start: the desktop app skips the public website, sign-in and legal acceptance. First launch opens organization setup, which saves to the local file; later launches open the ledger for the last-used organization. Run with `npm run tauri dev` (uses the new `dev:desktop` and `build:desktop` scripts).
- Desktop data: pages read and save through the shared workflows against the local file instead of the cloud: accounts, transactions, bank rows, reports, books close and reopen, and statement checks. Features not yet stored locally say so and record nothing.
- Desktop release workflow: on main, after every CI check and the desktop install check pass, builds Linux, Windows and macOS (Apple Silicon and Intel) installers into a draft GitHub release for manual testing. macOS builds are unsigned.
- Desktop install check: builds and installs the Linux package and confirms the program and start page are in it. Runs on pull requests to main and before every desktop release.

### Changed

- Releases are now two steps: prepare and wait for GitHub checks, then bump the version, date the changelog and update the architecture doc.
- The desktop app reads its version from package.json.
- CI run groups include the workflow name so the release workflow and normal CI no longer cancel each other.
- `.gitignore` now skips test results, caches, the desktop build folder and local database files; the public `.env.desktop` setting is tracked so GitHub builds the desktop edition.

### Fixed

- Dropdown menus (currency, fiscal year and others) showed white text on white in dark mode.
- Desktop build failed because of a malformed permissions file.
- Desktop window could open blank: the build only wrote `_shell.html`; it now copies the build into `desktop-dist/` with `index.html`.

## [0.0.7] - 2026-10-10

### Added

- Month-end close (Settings, Close the books): pick a month, see warnings for bank, cash and credit card accounts not checked against a statement through month end and for unfinished statement checks, then close. Closing with warnings needs a confirmation, and the warnings are saved in history.
- Audited reopen: admins and treasurers can reopen closed books only with a written reason (at least 10 characters), saved in history with who did it and which closed years were reopened.
- Concurrency tests: the same post, void, year-end close or month close sent at the same moment records once; a post racing a close never lands inside the closed period; restoring one backup twice at once makes two complete, separate organizations with no shared records.

### Changed

- The plain Unlock button is gone. Moving the books lock backward now always goes through Reopen books with a reason.

### Fixed

- Two restores running at the same moment could load different database clients; the restore now loads one shared client.

## [0.0.6] - 2026-10-08

### Added

- Reports: "Export all (PDF)" saves every report in one PDF, each on its own page.
- Treasurer role, between admin and member: records transactions, closes the year, locks the books and reopens finished statement checks, but cannot change settings or people. The database enforces the same limits.
- Plain-language error pop-ups for unbalanced transactions, closed periods, statement checks that are off, rejected backups and missing permissions. Each one says clearly that nothing was recorded.
- Tests: each common failure runs through the real bookkeeping steps; the pop-up appears only when the step is refused, never when it succeeds, and the stored books and history are checked to be unchanged. A changed backup is refused before any write; a database check (treasurer_role.sql) for what treasurers and members can and cannot do.
- Reports: general ledger and account activity with opening, running and closing balances.
- Reports: click any account on the income statement, balance sheet or trial balance to see the transactions behind it.
- Reports: fund activity (opening, received, spent, released, closing) for nonprofits.
- Reports: statement check report listing matched and outstanding items with the difference.
- Report names follow the wording setting (for example, Simplest shows "Every Transaction", "Totals Check", "Money by Purpose" and "Bank Statement Check"), and each can be changed in Settings.
- Excel exports show amounts in Accounting format (currency symbol on the left, thousands separators, negatives in parentheses) in a monospaced font.
- Reports: "Export all" saves every report in one Excel file, one sheet per report.
- Accounts page explains what accounts are and how to use them; the invite screen lists what Member, Admin and View only can do.
- Every report shows its period and "Cash basis", and the new reports export to CSV, Excel and PDF.
- Tests for the new report math, including a 50,000-line speed check.

### Added

- Two-step sign-in with an authenticator app, in Settings, Security. Admins can require it for the whole organization; the database then hides the books from any session that didn't use it.
- Delete my account, in Settings, Security. Blocked while you own an organization or are its only admin. History keeps your past changes and shows them as "Deleted user".
- Release checklist (docs/release-checklist.md): the changelog and the architecture document must be updated before every release, checked by an automated test.
- Structural code check: server functions, screens and components can't write tables directly, and only approved server files may load the privileged database client.
- Database checks for invite reuse, last-admin removal, wrong-owner transfer, settings that match nothing, organization delete, removed-member access and two-step sign-in.
- GitHub fails the build if a private key ever lands in the committed .env file, and reports developer-tool vulnerabilities without blocking.

### Changed

- Deleting an organization now saves its deleted-organization record and the delete in one step.
- Keyboard focus is now outlined clearly on every page.

### Fixed

- Database: the treasurer settings guard now applies only to signed-in app users, so server and maintenance steps are not blocked.

## [0.0.5] - 2026-10-08

### Added

- Organization switcher in the sidebar for people in more than one organization, showing each organization's type and your role.
- Accounts that were never used can now be deleted from Settings, Accounts. Accounts with any activity can still only be archived.
- Account, category, tag, project and fund names must be unique within an organization, ignoring capital letters and extra spaces.
- Shared input checks for amounts, dates and names, so every form gives the same clear message (for example, more than two decimal places is refused instead of rounded).
- Loading, empty and error screens with a "Try again" button on the main pages, instead of blank pages.
- Accessibility: every form field has a label for screen readers, a "Skip to content" link, labelled wording sliders, and higher-contrast sidebar text. An automated scan of every page reports no issues in light or dark mode.

### Changed

- Year-end close now saves the close, the book lock and the history entry in one step. If any part fails, nothing is kept.
- Every history entry now also stores the exact change the database applied, shown on the History page as "Saved change".
- Charts library upgraded to version 3 and the code checker to version 10.
- Loose types removed from app code; the code checker now blocks new ones, along with React rules that catch layout pieces rebuilt on every change.
- Long dashes removed from account descriptions and messages.

### Fixed

- Retrying a pledge or pledge payment after an interrupted save now finishes recording it instead of skipping it.
- Creating a project with a budget or a restricted fund failed; both save correctly again.
- The pledge form and year-end close could offer archived accounts.
- Import column pickers and statement-check tables no longer rebuild themselves on every change, which could drop keyboard focus.
- The GitHub database checks were missing the name and delete protections, so their test failed.

## [0.0.4] - 2026-10-07

### Added

- History page can be filtered by type: money, setup and settings, or system.
- Backups now record the app version and include a reserved slot for future attachments (format v3). Older v2 backups still restore.
- Permissions live in one fixed table, with a test that pins every role and action.
- Full-year business and nonprofit test scenarios check reports against fixed expected totals.
- Core libraries are pinned to exact versions; see docs/dependencies.md.
- More automated tests: the audited-write helper, database checks for audited writes and their history, the migration safety script, app version against the changelog, and roll-back checks for every statement-check step, bank-row post and reconciliation finish.

### Changed

- If a change can't be recorded in history, the request now fails with an error instead of reporting success.
- Posting or voiding a transaction now saves the transaction and its history entry together. If either fails, nothing is kept.
- Adding accounts, categories, tags, projects and funds, changing a fund's restriction, recording pledges and pledge payments, and saving import layouts now save their history entry in the same step.
- A new automatic check stops any feature from saving to the database without going through the shared code. It runs on every change.
- Settings, account setup, members and invites, budgets, statement checks, imports and pledge status changes are now saved together with their history entry. If either fails, nothing is kept.
- History entries are now sorted into changes, money and system events.
- npm (version 11 or newer) is now the only supported package manager; `package-lock.json` is the only lock file and automated checks install with `npm ci` on Node 24.
- Added an architecture overview in docs/architecture.md.

### Fixed

- Every `npm audit` warning is resolved without downgrades (brace-expansion, uuid inside the Excel export library, esbuild inside the database config tool).
- A database safety check no longer reports a false failure when a fund and its history save correctly.

## [0.0.3] - 2026-10-07

### Added

- Fund accounting for nonprofits: restricted and unrestricted funds, fund balances, net assets with and without donor restrictions, and releases from restriction.
- Pledges: record promised gifts, take payments, and write off what will not arrive.
- Invite links: admins create single use links with a role that expire after 7 days, and can revoke them.
- Members can be removed, anyone except the owner can leave, owners can transfer ownership to another admin, and owners can delete an organization after typing its name.
- Budgets: set a yearly or monthly budget for each income and expense account and compare it to actual results.
- Exports: reports and all transactions download as CSV or Excel, with protection against spreadsheet formula tricks.
- Full backup: admins can download one signed file with everything in an organization. Any change to the file is detected.
- Restore: a backup is restored into a new organization after its signature and every record are checked, and every transaction is re-checked against the bookkeeping rules. Backups from another install can be restored and are labeled with that install's fingerprint.
- Backup regression tests cover exporting and restoring 1,500 transactions with 4,500 ledger lines, related records, unchanged reports, and cleanup after a simulated restore failure.

### Changed

- Restore now has a clearly labeled backup file button, shows the selected filename, and highlights the organization name required for confirmation.

### Fixed

- Deleting an organization that has transactions no longer fails.
- History: admins can browse who changed what and when, under Settings.

## [0.0.2] - 2026-10-06

### Added

- High-contrast dark mode with a toggle in the website header and the app sidebar. It remembers your choice and follows the system preference on first visit.
- Public website explaining OpenLedgerApp's purpose, limitations, and development status.
- Clear distinction between available self-hosted web source and planned desktop and managed-cloud editions.
- Getting-started page linking to the source archive on GitHub (the app source, without the public website).
- Product blueprint for v0.0.3 desktop-ready foundations and later optional synchronization.

### Changed

- Groundwork for the future desktop edition: a local SQLite storage option with the same bookkeeping protections, tested against the same rules as the cloud app (not yet packaged as an app).
- Statement checks, reports, organization settings, books lock and year-end close now run in the same shared, storage-independent code, ready for the future desktop edition.
- Every new record (organizations, accounts, statement checks, year-end closes, import batches, history entries, categories) now gets its ID from the app instead of the database.
- Discarding a statement check now requires permission to edit the books.
- Bookkeeping rules and save/void workflows now run in shared, storage-independent code, so future desktop and self-hosted editions behave the same as the cloud app.
- App name standardized to OpenLedgerApp across screens, legal notices, reports, and documentation.
- Page titles use OpenLedgerApp for home and Page Name - OpenLedgerApp elsewhere.
- Public home is now `/`; the existing authenticated dashboard is at `/ledger`.
- Public website does not advertise or link the development preview or shared demo.
- Consistent section spacing across the website and app.

### Removed

- Marketing strips and eyebrow badges above headlines on the public website.
- Legal mailing address from legal notices; contact is by email only.
- Em dashes and en dashes from all user-facing copy.

## [0.0.1] - 2026-10-01

Initial usable web foundation.

### Added

- Organization-scoped double-entry accounting, chart of accounts, opening balances, and transaction register.
- Money in, money out, transfers, and advanced entry flows with duplicate-submit protection.
- CSV, OFX/QFX, and reviewed PDF bank imports; reconciliation and completion locks.
- Income statement, balance sheet, trial balance, project reporting, and PDF exports.
- Business/nonprofit terminology, basic fund tags, projects, and organization settings.
- Member roles, email and Google sign-in, password recovery, and versioned legal acceptance.
- Books-lock dates and virtual year-end close.
- Automated unit tests, database-rule checks, CI, and deployment documentation.

### Security and data integrity

- Balanced-entry enforcement, organization isolation, and permission checks.
- Posted transactions corrected by voiding and re-entry rather than destructive editing.
- Bank evidence protection, account archiving, and reconciliation locks.
- Startup data-safety safeguards and manual development-only sample seeding.

### Known limitations

- Pre-1.0 development software; review results and keep independent backups.
- Fund tags are not full nonprofit fund accounting.
- No standalone desktop installer, automated bank feeds, payroll, or tax filing.
