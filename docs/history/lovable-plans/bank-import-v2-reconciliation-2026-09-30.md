# Bank Import v2 + Reconciliation

Bank rows stay evidence only. Reconciliation compares evidence to the ledger. It never edits entries.

## Part A — Import upgrades

1. **Import mapping configuration**
   - A column-mapping step after you pick a CSV: date, description, and amount. Amount can be one signed column or separate debit and credit columns.
   - Options for date format (auto, MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD), a header row, and flipping signs (for credit cards).
   - Mappings are saved per bank account as named "import profiles", so the next import is one click.
   - A real CSV parser handles quoted commas and escaped quotes.
2. **OFX/QFX import**
   - Parsed in the browser (SGML and XML flavors): STMTTRN rows, FITID as the external id, and LEDGERBAL as the statement ending balance.
   - Dedup prefers FITID when one exists, and falls back to the fingerprint.
3. **PDF statement import**
   - Text is extracted in the browser (pdfjs). AI then turns it into structured rows plus the statement period and the beginning and ending balances.
   - Everything is shown for review and editing before anything is saved. PDF rows are always marked "needs review".
4. **Error handling and recovery**
   - A preview table flags each row: valid, duplicate (already imported), or error (with a reason, such as a bad date or amount).
   - Only valid rows are imported. You can download the errors, or fix a row inline.
   - Each upload is recorded as an **import batch** (file name, format, row counts, status). A batch can be undone if none of its rows are posted yet. Batch actions go to the audit log.
5. **Statement-period awareness**
   - An import can carry its statement period (start and end dates) and its beginning and ending balances. OFX and PDF fill these in automatically; CSV lets you type them.
   - These values pre-fill a reconciliation.
6. **Plaid / automatic bank feeds**: still deferred, not in this plan.

## Part B — Reconciliation (first-class)

- **Statement periods / reconciliations**: one per bank account and period. Each has a start date, an end date, a beginning balance, an ending balance, a mode (simple or full), and a status (in progress or completed).
- **Beginning balance** defaults to the ending balance of the last completed reconciliation for that account.
- **Reconciled state** is tracked per ledger entry on that account. An entry can be cleared in an in-progress reconciliation, and becomes locked once it is completed.
- **Full mode** (checkbook style):
  - The ledger entries for the account up to the end date that aren't reconciled yet appear in a list. You tick each one that shows on the statement.
  - A live summary shows: beginning balance + cleared = cleared balance, compared with the statement ending balance, and the difference.
  - You can only finish when the difference is 0.
- **Simple mode**:
  - It auto-matches imported bank rows in the period to ledger entries. A match means the same amount, a date within ±5 days, and prefers bank rows already linked.
  - It shows three lists: matched, bank rows with no ledger match (with quick "Post" from import), and ledger entries with no bank match.
  - One click accepts the matches. The same zero-difference rule applies before finishing.
- **Unmatched bank transactions** are listed in both modes, with links to post them.
- **History**: a list for each account of past reconciliations (period, balances, who finished it and when, how many items), plus a read-only detail view.
- **Undo last reconciliation** (admin only) reopens the most recent completed one, so mistakes can be fixed without editing entries.
- **Audit trail**: starting, clearing or unclearing items, finishing, and reopening are all written to audit_log with before and after values.
- **Guardrail**: you can't void a transaction that has a reconciled entry until its reconciliation is reopened.

## Technical details

- Migration:
  - `import_batches` (org, account, file_name, format csv|ofx|qfx|pdf, statement_start, statement_end, beginning_balance_cents, ending_balance_cents, row counts, status active|undone, created_by).
  - `import_profiles` (org, account, name, mapping jsonb).
  - `bank_transactions.batch_id`.
  - `reconciliations` (org, account, period_start, period_end, beginning_balance_cents, ending_balance_cents, mode simple|full, status in_progress|completed, completed_by, completed_at).
  - `entries.reconciliation_id` (nullable).
  - A trigger blocks voiding or changing a transaction whose entries belong to a completed reconciliation.
  - Every table gets grants, RLS (is_org_member / can_write_org), and updated_at triggers.
- Server functions:
  - `src/lib/import.functions.ts`: batches, profiles, undo batch, and `extractPdfStatement` via Lovable AI (gemini flash, structured output).
  - A new file, `src/lib/reconcile.functions.ts`: start, list, get, toggle-clear, auto-match, complete (checks the difference is 0 on the server), and reopen (admin only).
- Client parsers in `src/lib/parsers/` (csv, ofx, pdf-text). Vitest covers the CSV and OFX parsers.
- Routes:
  - `/import` becomes a wizard: upload, then map, then preview and errors, then import, plus a batch history list.
  - New pages at `/reconcile` (accounts and history), `/reconcile/$id` (workspace), and a sidebar entry.
- Terminology: labels go through existing terms. "Reconcile" gets a plain-language alias ("Check against statement") under the simplest level.
- Demo data: one completed reconciliation and one in-progress reconciliation for each demo org.
- AGENTS.md and roadmap.md get updated.
