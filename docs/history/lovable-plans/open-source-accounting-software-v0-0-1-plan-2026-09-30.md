# Open-Source Accounting Software — V0.0.1 Plan

## Vision (from your ChatGPT conversation)
A simple, secure, free accounting app for very small businesses and nonprofits. One accounting system, one source of truth, one double-entry engine — everything else is presentation. The ledger is the center; the bank is just an input. Open source, self-hostable or company-hosted.

## Architecture principles (locked in from the chat)
- **Double-entry engine at the core** — every transaction produces balanced debit/credit entries
- **The ledger is the source of truth** — bank imports are evidence, never the books themselves
- **Transactions exist independently of bank transactions** — optional linking, many-to-one capable
- **3-layer terminology**: immutable engine vocabulary → organization presentation (nonprofit vs business) → user preference (simplified vs accounting terms)
- **Accrual-ready data model** — transaction date vs posted date stored from day one
- **Manual transactions are first-class** — prominent "+ New Transaction" (Money In / Money Out / Transfer / Advanced)

## V0.0.1 scope

### Data model (Lovable Cloud database)
- **Organizations** — name, type (nonprofit/business), terminology settings
- **Accounts** — chart of accounts: asset, liability, equity/net assets, revenue, expense (checking, savings, petty cash, credit card…)
- **Transactions** — date, posted date, description, source (manual/import/opening balance/adjustment/transfer), status
- **Entries** — the double-entry lines: transaction → account, debit/credit amount; always balanced
- **Splits** — one transaction, multiple category/project allocations
- **Categories, Tags, Projects, Funds** — per the chat: tags are labels, projects track budget vs actual, funds are restricted money pools
- **Audit history** — every change recorded
- **User roles** — separate roles table (admin, member, viewer) with server-side checks

### Features
1. **Auth + organization setup** — sign up, create org, pick nonprofit or business vocabulary
2. **Chart of accounts** — sensible defaults auto-created per org type; add/edit accounts; opening balances
3. **"+ New Transaction"** — Money In / Money Out / Transfer / Advanced (split) flows; user never sees "debit/credit" unless they choose accounting vocabulary
4. **Transaction register** — per-account list with running balance, edit/void with audit trail
5. **Bank import (CSV)** — import statement rows as bank transactions, review/categorize, link to accounting transactions, dedup on re-import
6. **Categories, tags, projects, funds** — manage and assign; project view shows budget vs actual vs net
7. **Reports** — Income Statement (Profit & Loss / Statement of Activities per org type), Balance Sheet (Statement of Financial Position), project summary
8. **Terminology toggle** — user-level simplified vs accounting terms; org-level nonprofit vs business report labels

### Explicitly deferred (per the chat's roadmap)
- True accrual basis switching, invoices/bills, bank feeds (API), receipt attachments, budgets module, reconciliation UI, exports

## Technical details
- **Stack**: existing TanStack Start app + Lovable Cloud (database, auth, audit-safe server functions). Code stays in this repo — exportable/self-hostable, keeping the open-source goal intact
- **Double-entry enforced server-side**: every transaction write validates debits = credits in one atomic operation
- **Roles in a separate table** with a security-definer `has_role` function; RLS on every table, scoped by organization
- **Routes**: `/auth`, `/onboarding`, `/` (dashboard), `/accounts`, `/transactions`, `/transactions/new`, `/import`, `/projects`, `/funds`, `/reports`, `/settings`
- **Design**: clean ledger-inspired UI — warm neutrals, tabular numerals for money, simplified terminology by default
- Per-route `head()` metadata; no hardcoded colors

## Build order
1. Enable Lovable Cloud; schema + RLS + roles + grants migration
2. Auth + organization onboarding with default chart of accounts
3. Double-entry transaction engine (server functions) + New Transaction flows
4. Registers, accounts, categories/tags/projects/funds management
5. CSV bank import with review + linking + dedup
6. Reports (income statement, balance sheet, project budget-vs-actual)
7. Terminology layers + settings
8. Verify: build, role access, balanced-entry enforcement, visual check
