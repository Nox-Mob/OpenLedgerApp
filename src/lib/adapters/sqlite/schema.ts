// SQLite schema for the desktop edition. Mirrors the logical Postgres model; enforced
// guards are the SQLite equivalents of the Postgres triggers (immutability, uniqueness).
// Migrations are append-only: add a new entry, never edit a shipped one.

export const SQLITE_MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, org_type TEXT NOT NULL CHECK (org_type IN ('nonprofit','business')),
  currency TEXT NOT NULL, fiscal_year_start_month INTEGER NOT NULL, timezone TEXT NOT NULL,
  terminology TEXT NOT NULL, term_overrides TEXT NOT NULL DEFAULT '{}', ai_pdf_enabled INTEGER NOT NULL DEFAULT 0,
  books_locked_through TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL, org_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN ('admin','treasurer','member','viewer')), PRIMARY KEY (user_id, org_id)
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  subtype TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), transaction_date TEXT NOT NULL,
  posted_date TEXT, description TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  created_by TEXT, idempotency_key TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX transactions_idem ON transactions(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE reconciliations (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
  period_start TEXT NOT NULL, period_end TEXT NOT NULL, beginning_balance_cents INTEGER NOT NULL,
  ending_balance_cents INTEGER NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_progress',
  batch_id TEXT, created_by TEXT, completed_by TEXT, completed_at TEXT
);
CREATE TABLE entries (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id), amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  category_id TEXT, project_id TEXT, fund_id TEXT, memo TEXT,
  reconciliation_id TEXT REFERENCES reconciliations(id)
);
CREATE TABLE transaction_tags (transaction_id TEXT NOT NULL REFERENCES transactions(id), tag_id TEXT NOT NULL, PRIMARY KEY (transaction_id, tag_id));
CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
  bank_date TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL, external_id TEXT,
  fingerprint TEXT NOT NULL, row_seq INTEGER, batch_id TEXT, transaction_id TEXT REFERENCES transactions(id),
  needs_review INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX bank_fitid ON bank_transactions(account_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX bank_hash ON bank_transactions(account_id, fingerprint, row_seq) WHERE external_id IS NULL;
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, before TEXT, after TEXT, created_at TEXT NOT NULL
);

-- Immutability guards (same rules as Postgres).
CREATE TRIGGER entries_immutable BEFORE UPDATE ON entries
WHEN NEW.amount_cents IS NOT OLD.amount_cents OR NEW.account_id IS NOT OLD.account_id
  OR NEW.transaction_id IS NOT OLD.transaction_id OR NEW.category_id IS NOT OLD.category_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.fund_id IS NOT OLD.fund_id OR NEW.memo IS NOT OLD.memo
BEGIN SELECT RAISE(ABORT, 'entries are immutable'); END;
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'entries cannot be deleted'); END;
CREATE TRIGGER transactions_immutable BEFORE UPDATE ON transactions
WHEN NEW.transaction_date IS NOT OLD.transaction_date OR NEW.description IS NOT OLD.description
  OR NEW.org_id IS NOT OLD.org_id OR NEW.source IS NOT OLD.source
BEGIN SELECT RAISE(ABORT, 'transactions are immutable'); END;
CREATE TRIGGER transactions_no_unvoid BEFORE UPDATE OF status ON transactions
WHEN OLD.status = 'void' AND NEW.status <> 'void'
BEGIN SELECT RAISE(ABORT, 'void transactions cannot be restored'); END;
CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions
WHEN EXISTS (SELECT 1 FROM entries WHERE transaction_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'posted transactions cannot be deleted'); END;
CREATE TRIGGER books_lock BEFORE INSERT ON transactions
WHEN NEW.transaction_date <= (SELECT books_locked_through FROM organizations WHERE id = NEW.org_id)
BEGIN SELECT RAISE(ABORT, 'books are locked for this date'); END;
CREATE TRIGGER audit_append_only BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER reconciled_entry_locked BEFORE UPDATE OF reconciliation_id ON entries
WHEN (SELECT status FROM reconciliations WHERE id = OLD.reconciliation_id) = 'completed'
BEGIN SELECT RAISE(ABORT, 'entry belongs to a finished statement check'); END;
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE reconciliations ADD COLUMN created_at TEXT;
CREATE TABLE period_closes (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), fiscal_year_end TEXT NOT NULL,
  net_income_cents INTEGER NOT NULL, closed_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (org_id, fiscal_year_end)
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
  budget_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
  statement_start TEXT, statement_end TEXT, beginning_balance_cents INTEGER, ending_balance_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE TRIGGER period_closes_immutable BEFORE UPDATE ON period_closes BEGIN SELECT RAISE(ABORT, 'year-end closes are immutable'); END;
CREATE TRIGGER reconciliations_no_delete_completed BEFORE DELETE ON reconciliations
WHEN OLD.status = 'completed'
BEGIN SELECT RAISE(ABORT, 'finished statement checks cannot be deleted'); END;
`,
  },
  {
    version: 3,
    sql: `
ALTER TABLE organizations ADD COLUMN recurring_mode TEXT NOT NULL DEFAULT 'drafts';
CREATE TABLE transaction_templates (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
  description TEXT NOT NULL, lines TEXT NOT NULL, frequency TEXT CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  next_due TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE recurring_occurrences (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
  template_id TEXT NOT NULL REFERENCES transaction_templates(id), due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted','skipped')), transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL, UNIQUE (template_id, due_date)
);
CREATE TABLE budgets (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), account_id TEXT NOT NULL REFERENCES accounts(id),
  fund_id TEXT, project_id TEXT, period_type TEXT NOT NULL CHECK (period_type IN ('year','month')),
  period_start TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX budgets_scope ON budgets(org_id, account_id, period_type, period_start, IFNULL(fund_id,''), IFNULL(project_id,''));
CREATE TRIGGER occurrences_immutable BEFORE UPDATE ON recurring_occurrences BEGIN SELECT RAISE(ABORT, 'recurring history is immutable'); END;
`,
  },
];
