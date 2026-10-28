# v0.1.1 Everyday use, with desktop parity

## Step 0: Confirm the desktop code is here
The copy I can see right now is at v0.0.7. It has no desktop files (no `src-tauri`, no `src/lib/desktop`, no `edition.ts`). You said branch v0.1.1 has the working desktop app, so before any building I'll check that the v0.1.1 code is actually in this workspace. If it isn't, I'll stop and ask you to sync it. Building on v0.0.7 would leave out the desktop work.

## Features

1. **Tutorial on/off switch**
   - A switch in Settings and in the help menu. It is on by default for new organizations.
   - Part 1, Getting started: starting balances, checking and other accounts, first transaction, importing a statement, checking it.
   - Part 2, Routine: weekly entries, monthly statement check and month close, year end.
   - Each step points at the real button on the page and can be marked done or skipped. Progress is saved per person and per organization.

2. **Templates and recurring drafts**
   - Save any transaction as a template (name, lines, memo). You can also make a new transaction from a template.
   - A template can repeat weekly, monthly, quarterly or yearly.
   - An organization setting chooses what happens when one is due:
     - Drafts list: due items wait in a "Ready to review" list, and you post each one.
     - Reminder only: a notice says the template is due, and you open it to post.
   - Nothing is ever posted automatically. A posted draft gets its own idempotency key (`recurring:<template>:<date>`), so posting it twice is impossible.

3. **Transaction search and filters**
   - Search by description or memo.
   - Filter by date range, account, amount range, project, fund, tag, status (posted or void), source, and reconciled or not.
   - Filters are kept in the page address, so you can bookmark them, and the results can be exported.

4. **Fund and project budgets**
   - Budgets can now be set for an account plus a fund or project, for a month or a year. Rows keep their stable ID (updated, never replaced).
   - Budget vs actual can be shown for the whole organization, one fund, or one project.

5. **Board package (one PDF)**
   - Contents: cover page, income statement, balance sheet, budget vs actual, fund activity. Each section starts on a new page and uses the dates you pick.
   - Opened from the Reports page.

6. **First-run checklist**
   - A dashboard card that ticks itself off as you go: organization set up, accounts chosen, starting balances, first transaction, first statement check, first month close.
   - You can hide it. It links to the matching tutorial step.

7. **Diagnostics page** (Settings, admin and treasurer)
   - Shows the version and edition (cloud, self-hosted or desktop), whether the books balance (trial balance is zero), any transactions that don't balance, any lines without an account, books locked through, open statement checks, latest backup, and on desktop the database file location and schema version.
   - Includes a "Copy report" button. The copied report contains no personal or financial details.

## Desktop parity
Everything above works on desktop. These earlier cloud-only features also move behind shared code and get a SQLite version on desktop:
- budgets
- funds, pledges and releases
- categories and tags
- history (audit log)
- exports (CSV, Excel, PDF)
- backups (export and restore)
- bank file import

These stay cloud-only, because they don't fit a single-person app:
- members and invites
- MFA
- account deletion
- AI PDF reading (needs the internet; it could later be an opt-in)

The desktop guard test is extended so that any server function without a desktop handler, or without a documented cloud-only reason, fails the test.

## Order of work (sub-agents in parallel where the work doesn't overlap)
- A. Ports and SQLite parity for earlier features (budgets, funds and pledges, categories and tags, history, exports, backups, import). This is the largest piece.
- B. Search and filters, then templates and recurring drafts.
- C. Fund and project budgets, then the board package.
- D. Tutorial, first-run checklist, diagnostics.
- E. Tests, docs (desktop.md, architecture.md), changelog under Unreleased, roadmap.

## Technical details
- New tables (Postgres plus append-only SQLite migrations): `transaction_templates` (lines as JSON, schedule, next_due, active), `recurring_occurrences` (template, due date, status pending/posted/skipped, posted transaction id), `user_onboarding` (user, org, tutorial_enabled, steps JSON, checklist_hidden). Plus an org column `recurring_mode` ('drafts' | 'reminder'). Each table gets GRANTs, RLS (members read, writers write), app-generated UUIDs, and audited_write for changes.
- Budgets: add nullable `fund_id` and `project_id` to `budgets`. The unique key becomes (org, account, period, fund, project). The trigger checks that the fund or project belongs to the same org.
- Domain logic stays pure in `src/lib/domain/` (templates.ts for schedule math, search.ts for filter matching, diagnostics.ts for checks). Services live in `src/lib/services/`, and new ports go in `src/lib/ports/` with supabase, memory and sqlite adapters that all pass `contract.test.ts`.
- Search runs on the server with indexed filters (description trigram or ILIKE in the cloud, LIKE on SQLite) and is paginated.
- Board package reuses `report-pdf.ts` and `exportAllPdf` page logic.
- Tests: schedule math, one-key-per-occurrence (no double post), the recurring mode setting, filter combinations, budget scoping, board package sections, checklist completion, diagnostics checks against a deliberately broken memory dataset, permissions table cells for the new actions, SQL safety tests for the new tables, and desktop handler coverage.
- Version label: v0.1.1, bumped only after you confirm GitHub is green (two-step release).
