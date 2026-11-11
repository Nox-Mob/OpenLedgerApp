# Plan: Reviewer findings C, D, E — reports at scale, strict amounts, dedup fingerprint

The next three open roadmap items, in the reviewer's suggested order.

## C — Reports past 1,000 rows

**Problem:** `fetchLedger` (src/lib/reports.functions.ts) loads every entry for an org in one query. The database caps a single response at 1,000 rows, so once an org passes ~1,000 entry lines, every report silently under-counts.

**Fix:**
- Page `fetchLedger` in chunks of 1,000 (`.range(from, to)` loop until a short page), keeping the existing posted-only filter and `to` date bound.
- Add a vitest that feeds `computeBalance`/`computeIncome` a synthetic 5,000-row ledger and asserts totals — proving the math layer is row-count agnostic; the paging loop is covered by a mocked supabase client test (pages of 1,000, 1,000, 300).
- No SQL aggregation this round: report math (retained earnings roll-forward, fiscal-year split) stays in the tested pure module; paging removes the correctness bug without moving logic into the database.

## D — Strict amount parsing + import locale

**Problem:** `parseAmount` (src/lib/parsers/csv.ts) strips all commas as thousand-separators, so a European file with `1.234,56` parses wrong; values like `0x10` or `1.234` (3+ decimals) are accepted loosely.

**Fix:**
- Rewrite `parseAmount` to be strict: reject hex/scientific notation, reject more than 2 decimal places, reject multiple separators in ambiguous positions.
- Add an explicit `decimalSeparator: "dot" | "comma"` option to `CsvMapping`; when `comma`, dots are thousands and the comma is the decimal mark (and vice versa). Auto-guess from the file sample (if most amounts match `#,##0,00`, pick comma), shown as a choice in the CSV mapping step of the import wizard.
- Keep existing conveniences: `(1,234.56)` parentheses negatives, trailing `-`, `CR`/`DR` suffixes, currency symbols.
- Tests in src/lib/parsers/parsers.test.ts: dot-locale, comma-locale, parentheses, CR/DR, rejection of `0x10`, `1e3`, `1.234`, empty, and mixed-separator ambiguity.

## E — Dedup row-sequence fingerprint

**Problem:** the content fingerprint is `org|account|date|description|amount`. Two genuinely different rows on the same day with the same description and amount (e.g. two $5.00 coffees) collide — the second is silently dropped as a "duplicate".

**Fix:**
- Add `row_seq` (integer, position within its import batch) to `bank_transactions`; include it in the fingerprint for content-hashed rows: `org|account|date|desc|amount|seq`. FITID rows keep the bank's own id (no seq needed — banks guarantee uniqueness).
- Dedup scope becomes "same content at the same position in the same file" — re-importing the same file still dedups, but two real identical rows in one file both import.
- Migration: `ALTER TABLE bank_transactions ADD COLUMN row_seq integer` (nullable for existing rows; existing fingerprints unchanged so no re-dedup of history). Unique index stays on `(org_id, account_id, fingerprint)`.
- Update `checkDuplicates`/`importBankRows` to pass the row index through; within-file duplicate detection compares fingerprint including seq.

## Verification
- `bunx vitest run` on parsers + report-math tests (new cases included).
- `tsgo --noEmit` clean; build OK.
- Browser: import the Riverside sample CSV twice (dedup still works), import a comma-decimal CSV, and open /reports on the org with the most entries.

## Out of scope (later roadmap items)
F (double-post guards), G (seed.sql), H (PDF AI opt-in), role matrix, idempotency keys.
