// SQLite adapter for the repository ports (desktop edition).
// Talks to any driver with execute/select — Tauri's plugin-sql in the desktop shell,
// sql.js in tests. Uses `?` placeholders, which both support.
import type {
  Account,
  AuditEvent,
  PeriodClose,
  ReconEntry,
  BankTransaction,
  Entry,
  Organization,
  Reconciliation,
  Role,
  Transaction,
} from "@/lib/domain/models";
import { DuplicateKeyError, type Repositories } from "@/lib/ports";
import { SQLITE_MIGRATIONS } from "./schema";
import type { TransactionTemplate } from "@/lib/domain/templates";

export type SqlValue = string | number | null;

export interface SqlDriver {
  execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number }>;
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

/** Applies pending migrations in order. Safe to call on every app start. */
export async function migrateSqlite(db: SqlDriver): Promise<number> {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const rows = await db.select<{ v: number | null }>(
    "SELECT MAX(version) AS v FROM schema_version",
  );
  const current = rows[0]?.v ?? 0;
  let applied = 0;
  for (const m of SQLITE_MIGRATIONS) {
    if (m.version <= current) continue;
    for (const stmt of splitStatements(m.sql)) await db.execute(stmt);
    await db.execute("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [
      m.version,
      new Date().toISOString(),
    ]);
    applied++;
  }
  return applied;
}

/** Splits on `;` at line ends, keeping trigger bodies (BEGIN … END;) intact. */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of sql.split("\n")) {
    if (line.trim().startsWith("--")) continue;
    buf += line + "\n";
    const t = buf.trim();
    const inTrigger = /^CREATE TRIGGER/i.test(t);
    if (t.endsWith(";") && (!inTrigger || /END;$/i.test(t))) {
      out.push(t);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const isUnique = (e: unknown) =>
  /UNIQUE constraint failed|PRIMARY KEY/i.test(String((e as Error)?.message ?? e));
const now = () => new Date().toISOString();
const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

/* eslint-disable @typescript-eslint/no-explicit-any */
const toOrg = (r: any): Organization => ({
  id: r.id,
  name: r.name,
  orgType: r.org_type,
  currency: r.currency,
  fiscalYearStartMonth: Number(r.fiscal_year_start_month),
  timezone: r.timezone,
  terminology: r.terminology,
  termOverrides: JSON.parse(r.term_overrides || "{}"),
  aiPdfEnabled: !!r.ai_pdf_enabled,
  booksLockedThrough: r.books_locked_through ?? null,
  createdBy: r.created_by,
  createdAt: r.created_at,
});
const toAccount = (r: any): Account => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  type: r.type,
  subtype: r.subtype ?? null,
  isActive: !!r.is_active,
  createdAt: r.created_at,
});
const toEntry = (r: any): Entry => ({
  id: r.id,
  transactionId: r.transaction_id,
  accountId: r.account_id,
  amountCents: Number(r.amount_cents),
  categoryId: r.category_id ?? null,
  projectId: r.project_id ?? null,
  fundId: r.fund_id ?? null,
  memo: r.memo ?? null,
  reconciliationId: r.reconciliation_id ?? null,
});
const toBank = (r: any): BankTransaction => ({
  id: r.id,
  orgId: r.org_id,
  accountId: r.account_id,
  bankDate: r.bank_date,
  description: r.description,
  amountCents: Number(r.amount_cents),
  externalId: r.external_id ?? null,
  fingerprint: r.fingerprint,
  rowSeq: r.row_seq ?? null,
  batchId: r.batch_id ?? null,
  transactionId: r.transaction_id ?? null,
  needsReview: !!r.needs_review,
});
const toRecon = (r: any): Reconciliation => ({
  id: r.id,
  orgId: r.org_id,
  accountId: r.account_id,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  beginningBalanceCents: Number(r.beginning_balance_cents),
  endingBalanceCents: Number(r.ending_balance_cents),
  mode: r.mode,
  status: r.status,
  batchId: r.batch_id ?? null,
  completedBy: r.completed_by ?? null,
  completedAt: r.completed_at ?? null,
  createdAt: r.created_at ?? null,
});

const RECON_ENTRY_SELECT = `SELECT e.id, e.transaction_id, e.amount_cents, e.memo, e.reconciliation_id,
  t.transaction_date, t.description FROM entries e JOIN transactions t ON t.id = e.transaction_id`;
const toReconEntry = (r: any): ReconEntry => ({
  id: r.id,
  transactionId: r.transaction_id,
  date: r.transaction_date,
  description: r.memo || r.description,
  amountCents: Number(r.amount_cents),
  reconciliationId: r.reconciliation_id ?? null,
});
const toClose = (r: any): PeriodClose => ({
  id: r.id,
  orgId: r.org_id,
  fiscalYearEnd: r.fiscal_year_end,
  netIncomeCents: Number(r.net_income_cents),
  closedBy: r.closed_by,
  createdAt: r.created_at,
});

const qs = (n: number) => Array.from({ length: n }, () => "?").join(",");

const toTemplate = (r: any): TransactionTemplate => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  description: r.description,
  lines: JSON.parse(r.lines || "[]"),
  frequency: r.frequency ?? null,
  nextDue: r.next_due ?? null,
  active: !!r.active,
});

const CATALOG_TABLE = {
  category: "categories",
  tag: "tags",
  fund: "funds",
  project: "projects",
} as const;

const toPledge = (r: any): Pledge => ({
  id: r.id,
  orgId: r.org_id,
  donorName: r.donor_name,
  fundId: r.fund_id ?? null,
  amountCents: Number(r.amount_cents),
  pledgeDate: r.pledge_date,
  expectedDate: r.expected_date ?? null,
  note: r.note ?? null,
  transactionId: r.transaction_id,
  status: r.status,
  createdBy: r.created_by ?? null,
});

export function createSqliteRepositories(db: SqlDriver): Repositories {
  async function hydrate(rows: any[]): Promise<Transaction[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id as string);
    const entries = await db.select(
      `SELECT * FROM entries WHERE transaction_id IN (${qs(ids.length)})`,
      ids,
    );
    const tags = await db.select<{ transaction_id: string; tag_id: string }>(
      `SELECT * FROM transaction_tags WHERE transaction_id IN (${qs(ids.length)})`,
      ids,
    );
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      transactionDate: r.transaction_date,
      postedDate: r.posted_date ?? null,
      description: r.description,
      source: r.source,
      status: r.status,
      createdBy: r.created_by ?? null,
      idempotencyKey: r.idempotency_key ?? null,
      createdAt: r.created_at,
      entries: entries.filter((e: any) => e.transaction_id === r.id).map(toEntry),
      tagIds: tags.filter((t) => t.transaction_id === r.id).map((t) => t.tag_id),
    }));
  }

  /** Run a change and its history entry in one SQLite transaction. */
  async function audited<T>(audit: AuditEvent | undefined, fn: () => Promise<T>): Promise<T> {
    if (!audit) return fn();
    await db.execute("BEGIN");
    try {
      const out = await fn();
      // `false` means nothing changed (e.g. already claimed), so no history entry.
      if (out !== false) await insertAudit(audit);
      await db.execute("COMMIT");
      return out;
    } catch (e) {
      await db.execute("ROLLBACK");
      throw e;
    }
  }

  async function insertAudit(e: AuditEvent) {
    await db.execute(
      "INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, before, after, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        e.orgId,
        e.userId,
        e.action,
        e.entity,
        e.entityId ?? null,
        json(e.before),
        json(e.after),
        now(),
      ],
    );
  }

  return {
    orgs: {
      async get(id) {
        const [r] = await db.select("SELECT * FROM organizations WHERE id = ?", [id]);
        return r ? toOrg(r) : null;
      },
      async listForUser(userId) {
        const rows = await db.select<any>(
          "SELECT o.*, r.role FROM user_roles r JOIN organizations o ON o.id = r.org_id WHERE r.user_id = ?",
          [userId],
        );
        return rows.map((r) => ({ ...toOrg(r), role: r.role as Role }));
      },
      async create(o) {
        try {
          await db.execute(
            `INSERT INTO organizations (id, name, org_type, currency, fiscal_year_start_month, timezone, terminology,
             term_overrides, ai_pdf_enabled, books_locked_through, created_by, created_at) VALUES (${qs(12)})`,
            [
              o.id,
              o.name,
              o.orgType,
              o.currency,
              o.fiscalYearStartMonth,
              o.timezone,
              o.terminology,
              JSON.stringify(o.termOverrides),
              o.aiPdfEnabled ? 1 : 0,
              o.booksLockedThrough,
              o.createdBy,
              now(),
            ],
          );
        } catch (e) {
          if (isUnique(e)) throw new DuplicateKeyError();
          throw e;
        }
        // Desktop: the creator is the single local admin (mirrors add_creator_as_admin).
        await db.execute("INSERT INTO user_roles (user_id, org_id, role) VALUES (?, ?, 'admin')", [
          o.createdBy,
          o.id,
        ]);
      },
      async updateSettings(id, p, audit) {
        await audited(audit, async () => {
          const map: [keyof typeof p, string, (v: any) => SqlValue][] = [
            ["name", "name", (v) => v],
            ["orgType", "org_type", (v) => v],
            ["currency", "currency", (v) => v],
            ["fiscalYearStartMonth", "fiscal_year_start_month", (v) => v],
            ["timezone", "timezone", (v) => v],
            ["terminology", "terminology", (v) => v],
            ["termOverrides", "term_overrides", (v) => JSON.stringify(v)],
            ["aiPdfEnabled", "ai_pdf_enabled", (v) => (v ? 1 : 0)],
          ];
          const sets: string[] = [];
          const vals: SqlValue[] = [];
          for (const [k, col, f] of map)
            if (p[k] !== undefined) {
              sets.push(`${col} = ?`);
              vals.push(f(p[k]));
            }
          if (!sets.length) return false;
          await db.execute(`UPDATE organizations SET ${sets.join(", ")} WHERE id = ?`, [
            ...vals,
            id,
          ]);
          return true;
        });
      },
      async setBooksLockedThrough(id, date, audit) {
        return audited(audit, async () => {
          await db.execute("UPDATE organizations SET books_locked_through = ? WHERE id = ?", [
            date,
            id,
          ]);
        });
      },
      async roleOf(userId, orgId) {
        const [r] = await db.select<{ role: Role }>(
          "SELECT role FROM user_roles WHERE user_id = ? AND org_id = ?",
          [userId, orgId],
        );
        return r?.role ?? null;
      },
      async listMembers(orgId) {
        const rows = await db.select<any>("SELECT user_id, role FROM user_roles WHERE org_id = ?", [
          orgId,
        ]);
        return rows.map((r) => ({ userId: r.user_id, orgId, role: r.role, displayName: null }));
      },
    },

    accounts: {
      async list(orgId, opts) {
        const rows = await db.select(
          `SELECT * FROM accounts WHERE org_id = ? ${opts?.includeArchived ? "" : "AND is_active = 1"} ORDER BY name`,
          [orgId],
        );
        return rows.map(toAccount);
      },
      async getMany(orgId, ids) {
        if (!ids.length) return [];
        const rows = await db.select(
          `SELECT * FROM accounts WHERE org_id = ? AND id IN (${qs(ids.length)})`,
          [orgId, ...ids],
        );
        return rows.map(toAccount);
      },
      async create(list) {
        for (const a of list) {
          try {
            await db.execute(
              "INSERT INTO accounts (id, org_id, name, type, subtype, is_active, created_at) VALUES (?,?,?,?,?,?,?)",
              [a.id, a.orgId, a.name, a.type, a.subtype, a.isActive ? 1 : 0, now()],
            );
          } catch (e) {
            if (isUnique(e)) throw new DuplicateKeyError();
            throw e;
          }
        }
      },
      async rename(orgId, id, name) {
        await db.execute("UPDATE accounts SET name = ? WHERE org_id = ? AND id = ?", [
          name,
          orgId,
          id,
        ]);
      },
      async setActive(orgId, id, isActive) {
        await db.execute("UPDATE accounts SET is_active = ? WHERE org_id = ? AND id = ?", [
          isActive ? 1 : 0,
          orgId,
          id,
        ]);
      },
      async hasOpeningBalance(orgId, accountId) {
        const rows = await db.select(
          `SELECT 1 FROM entries e JOIN transactions t ON t.id = e.transaction_id
           WHERE e.account_id = ? AND t.org_id = ? AND t.source = 'opening_balance' AND t.status = 'posted' LIMIT 1`,
          [accountId, orgId],
        );
        return rows.length > 0;
      },
    },

    transactions: {
      async post(tx, audit) {
        await db.execute("BEGIN");
        try {
          await db.execute(
            `INSERT INTO transactions (id, org_id, transaction_date, posted_date, description, source, status,
             created_by, idempotency_key, created_at) VALUES (?,?,?,?,?,?,'posted',?,?,?)`,
            [
              tx.id,
              tx.orgId,
              tx.transactionDate,
              tx.postedDate,
              tx.description,
              tx.source,
              tx.createdBy,
              tx.idempotencyKey,
              now(),
            ],
          );
          for (const e of tx.entries) {
            // Same-org account check (Postgres: guard_entry_refs).
            const ok = await db.select("SELECT 1 FROM accounts WHERE id = ? AND org_id = ?", [
              e.accountId,
              tx.orgId,
            ]);
            if (!ok.length) throw new Error("Entry account belongs to another organization");
            await db.execute(
              `INSERT INTO entries (id, transaction_id, account_id, amount_cents, category_id, project_id, fund_id, memo)
               VALUES (?,?,?,?,?,?,?,?)`,
              [
                e.id,
                tx.id,
                e.accountId,
                e.amountCents,
                e.categoryId ?? null,
                e.projectId ?? null,
                e.fundId ?? null,
                e.memo ?? null,
              ],
            );
          }
          // Balance check at commit (Postgres: deferred validate_transaction_balanced).
          const [b] = await db.select<{ n: number; s: number; pos: number; neg: number }>(
            `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS s,
             SUM(amount_cents > 0) AS pos, SUM(amount_cents < 0) AS neg FROM entries WHERE transaction_id = ?`,
            [tx.id],
          );
          if (!b || b.n < 2 || Number(b.s) !== 0 || !b.pos || !b.neg)
            throw new Error("Transaction is not balanced");
          for (const tagId of tx.tagIds ?? [])
            await db.execute(
              "INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
              [tx.id, tagId],
            );
          if (audit) await insertAudit(audit);
          await db.execute("COMMIT");
        } catch (e) {
          await db.execute("ROLLBACK");
          if (isUnique(e)) throw new DuplicateKeyError(String((e as Error).message));
          throw e;
        }
      },
      async findByIdempotencyKey(orgId, key) {
        const [r] = await db.select<{ id: string }>(
          "SELECT id FROM transactions WHERE org_id = ? AND idempotency_key = ?",
          [orgId, key],
        );
        return r?.id ?? null;
      },
      async get(orgId, id) {
        const rows = await db.select("SELECT * FROM transactions WHERE org_id = ? AND id = ?", [
          orgId,
          id,
        ]);
        return (await hydrate(rows))[0] ?? null;
      },
      async list(orgId, opts) {
        const where = ["org_id = ?"];
        const vals: SqlValue[] = [orgId];
        if (!opts?.includeVoid) where.push("status = 'posted'");
        if (opts?.from) {
          where.push("transaction_date >= ?");
          vals.push(opts.from);
        }
        if (opts?.to) {
          where.push("transaction_date <= ?");
          vals.push(opts.to);
        }
        if (opts?.accountId) {
          where.push("id IN (SELECT transaction_id FROM entries WHERE account_id = ?)");
          vals.push(opts.accountId);
        }
        const rows = await db.select(
          `SELECT * FROM transactions WHERE ${where.join(" AND ")}
           ORDER BY transaction_date DESC, created_at DESC LIMIT ?`,
          [...vals, opts?.limit ?? 100],
        );
        return hydrate(rows);
      },
      async markVoid(orgId, id, audit) {
        await db.execute("BEGIN");
        try {
          const r = await db.execute(
            "UPDATE transactions SET status = 'void' WHERE org_id = ? AND id = ? AND status = 'posted'",
            [orgId, id],
          );
          if (r.rowsAffected > 0 && audit) await insertAudit(audit);
          await db.execute("COMMIT");
          return r.rowsAffected > 0;
        } catch (e) {
          await db.execute("ROLLBACK");
          throw e;
        }
      },
      async clearReconciliation(ids) {
        if (!ids.length) return;
        await db.execute(
          `UPDATE entries SET reconciliation_id = NULL WHERE id IN (${qs(ids.length)})`,
          ids,
        );
      },
      async ledgerRows(orgId, opts) {
        const rows = await db.select<any>(
          `SELECT e.amount_cents, e.account_id, e.transaction_id, t.description, e.project_id, e.fund_id, a.name AS account_name, a.type AS account_type,
                  t.transaction_date, t.source
           FROM entries e JOIN transactions t ON t.id = e.transaction_id JOIN accounts a ON a.id = e.account_id
           WHERE t.org_id = ? AND t.status = 'posted' AND t.source <> 'closing' ${opts?.to ? "AND t.transaction_date <= ?" : ""}`,
          opts?.to ? [orgId, opts.to] : [orgId],
        );
        return rows.map((r) => ({
          amountCents: Number(r.amount_cents),
          accountId: r.account_id,
          transactionId: r.transaction_id,
          description: r.description ?? "",
          accountName: r.account_name,
          accountType: r.account_type,
          projectId: r.project_id ?? null,
          fundId: r.fund_id ?? null,
          source: r.source,
          transactionDate: r.transaction_date,
        }));
      },
    },

    bank: {
      async insertMany(rows) {
        let inserted = 0;
        let duplicates = 0;
        for (const r of rows) {
          try {
            await db.execute(
              `INSERT INTO bank_transactions (id, org_id, account_id, bank_date, description, amount_cents,
               external_id, fingerprint, row_seq, batch_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [
                r.id,
                r.orgId,
                r.accountId,
                r.bankDate,
                r.description,
                r.amountCents,
                r.externalId,
                r.fingerprint,
                r.rowSeq,
                r.batchId,
              ],
            );
            inserted++;
          } catch (e) {
            if (!isUnique(e)) throw e;
            duplicates++;
          }
        }
        return { inserted, duplicates };
      },
      async get(orgId, id) {
        const [r] = await db.select("SELECT * FROM bank_transactions WHERE org_id = ? AND id = ?", [
          orgId,
          id,
        ]);
        return r ? toBank(r) : null;
      },
      async listUnmatched(orgId, accountId) {
        const rows = await db.select(
          `SELECT * FROM bank_transactions WHERE org_id = ? AND transaction_id IS NULL
           ${accountId ? "AND account_id = ?" : ""} ORDER BY bank_date`,
          accountId ? [orgId, accountId] : [orgId],
        );
        return rows.map(toBank);
      },
      async claim(orgId, id, transactionId, audit) {
        return audited(audit, async () => {
          // Link must match amount/account (Postgres: guard_bank_refs).
          const r = await db.execute(
            `UPDATE bank_transactions SET transaction_id = ?, needs_review = 0
           WHERE org_id = ? AND id = ? AND transaction_id IS NULL
             AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = ?
                         AND e.account_id = bank_transactions.account_id
                         AND e.amount_cents = bank_transactions.amount_cents)`,
            [transactionId, orgId, id, transactionId],
          );
          return r.rowsAffected > 0;
        });
      },
      async unlinkTransaction(orgId, transactionId) {
        const r = await db.execute(
          "UPDATE bank_transactions SET transaction_id = NULL WHERE org_id = ? AND transaction_id = ?",
          [orgId, transactionId],
        );
        return r.rowsAffected;
      },
      async listInPeriod(orgId, accountId, from, to) {
        const rows = await db.select(
          `SELECT * FROM bank_transactions WHERE org_id = ? AND account_id = ? AND bank_date >= ? AND bank_date <= ?
           ORDER BY bank_date`,
          [orgId, accountId, from, to],
        );
        return rows.map(toBank);
      },
      async latestStatement(orgId, accountId) {
        const [r] = await db.select<any>(
          `SELECT * FROM import_batches WHERE org_id = ? AND account_id = ? AND status = 'active'
             AND statement_end IS NOT NULL ORDER BY statement_end DESC LIMIT 1`,
          [orgId, accountId],
        );
        return r
          ? {
              batchId: r.id,
              statementStart: r.statement_start ?? null,
              statementEnd: r.statement_end,
              beginningBalanceCents: r.beginning_balance_cents ?? null,
              endingBalanceCents: r.ending_balance_cents ?? null,
            }
          : null;
      },
    },

    reconciliations: {
      async start(r, audit) {
        return audited(audit, async () => {
          await db.execute(
            `INSERT INTO reconciliations (id, org_id, account_id, period_start, period_end, beginning_balance_cents,
           ending_balance_cents, mode, status, batch_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,'in_progress',?,?,?)`,
            [
              r.id,
              r.orgId,
              r.accountId,
              r.periodStart,
              r.periodEnd,
              r.beginningBalanceCents,
              r.endingBalanceCents,
              r.mode,
              r.batchId,
              r.createdBy,
              now(),
            ],
          );
        });
      },
      async locate(id) {
        const [r] = await db.select("SELECT * FROM reconciliations WHERE id = ?", [id]);
        return r ? toRecon(r) : null;
      },
      async itemCounts(orgId) {
        const rows = await db.select<{ id: string; n: number }>(
          `SELECT r.id, COUNT(e.id) AS n FROM reconciliations r
           LEFT JOIN entries e ON e.reconciliation_id = r.id WHERE r.org_id = ? GROUP BY r.id`,
          [orgId],
        );
        return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]));
      },
      async workspaceEntries(accountId, through, rid) {
        const rows = await db.select(
          `${RECON_ENTRY_SELECT} WHERE e.account_id = ? AND t.status = 'posted' AND t.transaction_date <= ?
             AND (e.reconciliation_id IS NULL OR e.reconciliation_id = ?)`,
          [accountId, through, rid],
        );
        return rows.map(toReconEntry);
      },
      async entriesOf(rid) {
        const rows = await db.select(`${RECON_ENTRY_SELECT} WHERE e.reconciliation_id = ?`, [rid]);
        return rows.map(toReconEntry);
      },
      async get(orgId, id) {
        const [r] = await db.select("SELECT * FROM reconciliations WHERE org_id = ? AND id = ?", [
          orgId,
          id,
        ]);
        return r ? toRecon(r) : null;
      },
      async list(orgId, accountId) {
        const rows = await db.select(
          `SELECT * FROM reconciliations WHERE org_id = ? ${accountId ? "AND account_id = ?" : ""} ORDER BY period_end DESC`,
          accountId ? [orgId, accountId] : [orgId],
        );
        return rows.map(toRecon);
      },
      async setTicked(rid, ids, ticked, audit) {
        await audited(audit, async () => {
          if (!ids.length) return false;
          const guard = ticked ? "reconciliation_id IS NULL" : "reconciliation_id = ?";
          await db.execute(
            `UPDATE entries SET reconciliation_id = ? WHERE id IN (${qs(ids.length)}) AND ${guard}
             AND account_id = (SELECT account_id FROM reconciliations WHERE id = ?)`,
            ticked ? [rid, ...ids, rid] : [null, ...ids, rid, rid],
          );
          return true;
        });
      },
      async clearedTotalCents(rid) {
        const [r] = await db.select<{ s: number }>(
          "SELECT COALESCE(SUM(amount_cents), 0) AS s FROM entries WHERE reconciliation_id = ?",
          [rid],
        );
        return Number(r?.s ?? 0);
      },
      async finish(orgId, id, userId, audit) {
        return audited(audit, async () => {
          await db.execute(
            "UPDATE reconciliations SET status = 'completed', completed_by = ?, completed_at = ? WHERE org_id = ? AND id = ?",
            [userId, now(), orgId, id],
          );
        });
      },
      async reopen(orgId, id, audit) {
        return audited(audit, async () => {
          await db.execute(
            "UPDATE reconciliations SET status = 'in_progress', completed_by = NULL, completed_at = NULL WHERE org_id = ? AND id = ?",
            [orgId, id],
          );
        });
      },
      async discard(orgId, id, audit) {
        await audited(audit, async () => {
          const [r] = await db.select<{ status: string }>(
            "SELECT status FROM reconciliations WHERE org_id = ? AND id = ?",
            [orgId, id],
          );
          if (r?.status !== "in_progress") return false;
          await db.execute(
            "UPDATE entries SET reconciliation_id = NULL WHERE reconciliation_id = ?",
            [id],
          );
          await db.execute("DELETE FROM reconciliations WHERE id = ?", [id]);
          return true;
        });
      },
    },

    periodCloses: {
      async list(orgId) {
        const rows = await db.select(
          "SELECT * FROM period_closes WHERE org_id = ? ORDER BY fiscal_year_end DESC",
          [orgId],
        );
        return rows.map(toClose);
      },
      async find(orgId, fye) {
        const [r] = await db.select(
          "SELECT * FROM period_closes WHERE org_id = ? AND fiscal_year_end = ?",
          [orgId, fye],
        );
        return r ? toClose(r) : null;
      },
      async create(c) {
        try {
          await db.execute(
            "INSERT INTO period_closes (id, org_id, fiscal_year_end, net_income_cents, closed_by, created_at) VALUES (?,?,?,?,?,?)",
            [c.id, c.orgId, c.fiscalYearEnd, c.netIncomeCents, c.closedBy, now()],
          );
        } catch (e) {
          if (isUnique(e)) throw new DuplicateKeyError();
          throw e;
        }
      },
      async closeAndLock(c, lockThrough, audit) {
        try {
          await audited(audit, async () => {
            await db.execute(
              "INSERT INTO period_closes (id, org_id, fiscal_year_end, net_income_cents, closed_by, created_at) VALUES (?,?,?,?,?,?)",
              [c.id, c.orgId, c.fiscalYearEnd, c.netIncomeCents, c.closedBy, now()],
            );
            await db.execute("UPDATE organizations SET books_locked_through = ? WHERE id = ?", [
              lockThrough,
              c.orgId,
            ]);
          });
        } catch (e) {
          if (isUnique(e)) throw new DuplicateKeyError();
          throw e;
        }
      },
    },

    projects: {
      async list(orgId) {
        const rows = await db.select<any>("SELECT * FROM projects WHERE org_id = ? ORDER BY name", [
          orgId,
        ]);
        return rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          name: r.name,
          budgetCents: Number(r.budget_cents),
          status: r.status,
        }));
      },
    },

    catalog: {
      async list(orgId, kind) {
        const table = CATALOG_TABLE[kind];
        const rows = await db.select<any>(`SELECT * FROM ${table} WHERE org_id = ? ORDER BY name`, [
          orgId,
        ]);
        return rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          kind,
          name: r.name,
          categoryType: kind === "category" ? r.type : null,
          isRestricted: kind === "fund" ? !!r.is_restricted : false,
          budgetCents: kind === "project" ? Number(r.budget_cents) : 0,
          status: r.status ?? "active",
        }));
      },
      async create(item, audit) {
        await audited(audit, async () => {
          try {
            if (item.kind === "category")
              await db.execute(
                "INSERT INTO categories (id, org_id, name, type, created_at) VALUES (?,?,?,?,?)",
                [item.id, item.orgId, item.name, item.categoryType ?? "expense", now()],
              );
            else if (item.kind === "tag")
              await db.execute("INSERT INTO tags (id, org_id, name, created_at) VALUES (?,?,?,?)", [
                item.id,
                item.orgId,
                item.name,
                now(),
              ]);
            else if (item.kind === "fund")
              await db.execute(
                "INSERT INTO funds (id, org_id, name, is_restricted, created_at) VALUES (?,?,?,?,?)",
                [item.id, item.orgId, item.name, item.isRestricted ? 1 : 0, now()],
              );
            else
              await db.execute(
                "INSERT INTO projects (id, org_id, name, budget_cents, status, created_at) VALUES (?,?,?,?,?,?)",
                [item.id, item.orgId, item.name, item.budgetCents, item.status, now()],
              );
          } catch (e) {
            if (isUnique(e)) throw new Error(`"${item.name}" already exists.`);
            throw e;
          }
        });
      },
      async setRestricted(orgId, fundId, isRestricted, audit) {
        await audited(audit, async () => {
          const r = await db.execute(
            "UPDATE funds SET is_restricted = ? WHERE id = ? AND org_id = ?",
            [isRestricted ? 1 : 0, fundId, orgId],
          );
          if (r.rowsAffected === 0) throw new Error("Fund not found.");
        });
      },
    },

    pledges: {
      async list(orgId) {
        const rows = await db.select<any>(
          "SELECT * FROM pledges WHERE org_id = ? ORDER BY pledge_date DESC, created_at DESC",
          [orgId],
        );
        return rows.map(toPledge);
      },
      async get(orgId, id) {
        const [r] = await db.select<any>("SELECT * FROM pledges WHERE org_id = ? AND id = ?", [
          orgId,
          id,
        ]);
        return r ? toPledge(r) : null;
      },
      async payments(orgId) {
        const rows = await db.select<any>("SELECT * FROM pledge_payments WHERE org_id = ?", [orgId]);
        return rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          pledgeId: r.pledge_id,
          transactionId: r.transaction_id,
          kind: r.kind,
          amountCents: Number(r.amount_cents),
          paidDate: r.paid_date,
        }));
      },
      async create(p, audit) {
        await audited(audit, async () => {
          await db.execute(
            `INSERT INTO pledges (id, org_id, donor_name, fund_id, amount_cents, pledge_date, expected_date, note, transaction_id, status, created_by, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              p.id,
              p.orgId,
              p.donorName,
              p.fundId,
              p.amountCents,
              p.pledgeDate,
              p.expectedDate,
              p.note,
              p.transactionId,
              p.status,
              p.createdBy,
              now(),
            ],
          );
        });
      },
      async addPayment(p, newStatus, audit) {
        await audited(audit, async () => {
          await db.execute(
            `INSERT INTO pledge_payments (id, org_id, pledge_id, transaction_id, kind, amount_cents, paid_date, created_at)
             VALUES (?,?,?,?,?,?,?,?)`,
            [p.id, p.orgId, p.pledgeId, p.transactionId, p.kind, p.amountCents, p.paidDate, now()],
          );
          if (newStatus)
            await db.execute("UPDATE pledges SET status = ? WHERE id = ? AND org_id = ?", [
              newStatus,
              p.pledgeId,
              p.orgId,
            ]);
        });
      },
    },

    templates: {
      async list(orgId) {
        const rows = await db.select<any>(
          "SELECT * FROM transaction_templates WHERE org_id = ? ORDER BY name",
          [orgId],
        );
        return rows.map(toTemplate);
      },
      async get(orgId, id) {
        const rows = await db.select<any>(
          "SELECT * FROM transaction_templates WHERE org_id = ? AND id = ?",
          [orgId, id],
        );
        return rows[0] ? toTemplate(rows[0]) : null;
      },
      async save(t, audit) {
        await audited(audit, async () => {
          const ts = now();
          await db.execute(
            `INSERT INTO transaction_templates (id, org_id, name, description, lines, frequency, next_due, active, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
               lines = excluded.lines, frequency = excluded.frequency, next_due = excluded.next_due,
               active = excluded.active, updated_at = excluded.updated_at`,
            [
              t.id,
              t.orgId,
              t.name,
              t.description,
              JSON.stringify(t.lines),
              t.frequency,
              t.nextDue,
              t.active ? 1 : 0,
              ts,
              ts,
            ],
          );
        });
      },
      async occurrences(orgId) {
        const rows = await db.select<any>(
          "SELECT * FROM recurring_occurrences WHERE org_id = ? ORDER BY due_date",
          [orgId],
        );
        return rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          templateId: r.template_id,
          dueDate: r.due_date,
          status: r.status,
          transactionId: r.transaction_id ?? null,
        }));
      },
      async recordOccurrence(o, nextDue, audit) {
        const run = async () => {
          const r = await db.execute(
            `INSERT INTO recurring_occurrences (id, org_id, template_id, due_date, status, transaction_id, created_at)
             VALUES (?,?,?,?,?,?,?) ON CONFLICT(template_id, due_date) DO NOTHING`,
            [o.id, o.orgId, o.templateId, o.dueDate, o.status, o.transactionId, now()],
          );
          if (r.rowsAffected === 0) return false;
          await db.execute(
            "UPDATE transaction_templates SET next_due = ?, updated_at = ? WHERE org_id = ? AND id = ?",
            [nextDue, now(), o.orgId, o.templateId],
          );
          return true;
        };
        if (!audit) return run();
        return audited(audit, run);
      },
      async getMode(orgId) {
        const rows = await db.select<{ m: string }>(
          "SELECT recurring_mode AS m FROM organizations WHERE id = ?",
          [orgId],
        );
        return rows[0]?.m === "reminder" ? "reminder" : "drafts";
      },
      async setMode(orgId, mode, audit) {
        await audited(audit, async () => {
          await db.execute("UPDATE organizations SET recurring_mode = ? WHERE id = ?", [
            mode,
            orgId,
          ]);
        });
      },
    },

    budgets: {
      async list(orgId, periodType, periodStart) {
        const rows = await db.select<any>(
          "SELECT * FROM budgets WHERE org_id = ? AND period_type = ? AND period_start = ?",
          [orgId, periodType, periodStart],
        );
        return rows.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          accountId: r.account_id,
          fundId: r.fund_id ?? null,
          projectId: r.project_id ?? null,
          periodType: r.period_type,
          periodStart: r.period_start,
          amountCents: Number(r.amount_cents),
        }));
      },
      async set(b, audit) {
        await audited(audit, async () => {
          const where =
            "org_id = ? AND account_id = ? AND period_type = ? AND period_start = ? AND IFNULL(fund_id,'') = ? AND IFNULL(project_id,'') = ?";
          const key = [
            b.orgId,
            b.accountId,
            b.periodType,
            b.periodStart,
            b.fundId ?? "",
            b.projectId ?? "",
          ];
          if (b.amountCents === null) {
            await db.execute(`DELETE FROM budgets WHERE ${where}`, key);
            return;
          }
          const upd = await db.execute(
            `UPDATE budgets SET amount_cents = ?, updated_at = ? WHERE ${where}`,
            [b.amountCents, now(), ...key],
          );
          if (upd.rowsAffected === 0)
            await db.execute(
              `INSERT INTO budgets (id, org_id, account_id, fund_id, project_id, period_type, period_start, amount_cents, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [
                b.id,
                b.orgId,
                b.accountId,
                b.fundId,
                b.projectId,
                b.periodType,
                b.periodStart,
                b.amountCents,
                now(),
                now(),
              ],
            );
        });
      },
    },

    audit: {
      async append(e) {
        await insertAudit(e);
      },
      async listFor(orgId, entity, entityId, limit = 50) {
        const rows = await db.select<any>(
          `SELECT action, after, created_at FROM audit_log WHERE org_id = ? AND entity = ? AND entity_id = ?
           ORDER BY id DESC LIMIT ?`,
          [orgId, entity, entityId, limit],
        );
        return rows.map((r) => ({
          action: r.action,
          at: r.created_at,
          after: r.after ? JSON.parse(r.after) : null,
        }));
      },
    },
  };
}
