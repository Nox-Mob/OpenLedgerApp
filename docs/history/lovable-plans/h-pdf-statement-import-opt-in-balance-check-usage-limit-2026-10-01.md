# H — PDF statement import: opt-in, balance check, usage limit

## What the user gets
1. **Opt-in before AI reads a PDF.** An admin turns on "Allow AI to read PDF statements" in Settings → Organization profile (off by default). Before each upload, a short notice explains that the file's text goes to an AI service, isn't used for training, and that results must be reviewed. The person ticks "I understand" to continue. Without the org setting, the PDF option is shown but disabled with an explanation.
2. **Balance check.** After the PDF is read, the preview shows: opening balance + rows = closing balance? If it doesn't add up, a red banner shows the gap and the import button stays off until the rows are fixed (inline edit) or the person ticks "Import anyway, I'll review" (rows stay flagged needs review, and the batch is marked unbalanced).
3. **Usage limit.** Each person can read up to 10 PDFs per day and 50 per month per organization. When the limit is hit, they see how many are left and when it resets. Files over 10 MB or 40 pages are refused before sending.

## Technical details
- Migration:
  - `organizations.ai_pdf_enabled boolean NOT NULL DEFAULT false` (admin-only change via `updateOrganization`, audit-logged).
  - `ai_usage` table (org_id, user_id, kind 'pdf_extract', created_at, page_count, ok boolean) with GRANT, RLS: members read own org rows; inserts only through server fn (`user_id = auth.uid()` and `can_write_org`).
  - `import_batches.balance_mismatch_cents bigint NULL`.
- `extractPdfStatement` (import.functions.ts): reject if org opt-in off or `acknowledged !== true`; count `ai_usage` rows for user in last 24h / 30d before calling the AI; insert usage row (counts failures too); enforce size/page caps server-side; never log the statement text.
- New pure helper `checkStatementBalance(beginning, rows, ending)` in `src/lib/parsers/pdf-text.ts` + tests (match, gap, missing balances = "can't check").
- `importBankRows`: for format pdf, recompute the check server-side; require `acceptMismatch` when gap ≠ 0, store gap on batch.
- UI: import.tsx notice + checkbox, balance banner, remaining-uses line; settings index toggle.
- Update AGENTS.md (AI opt-in + limits rule), roadmap H checked.

## Not included
Choosing a different AI provider, per-org custom limits, OCR for scanned image-only PDFs.
