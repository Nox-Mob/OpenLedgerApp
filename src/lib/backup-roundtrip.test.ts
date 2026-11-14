import type { UntypedDb } from "./db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRestorable,
  keysFromSeed,
  REFS,
  signBackup,
  TABLES,
  verifyBackup,
} from "./domain/backup";
import { computeBalance, computeIncome, computeTrialBalance, type LedgerRow } from "./report-math";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return state.db;
  },
}));
import { readBackupData } from "./backup-export.server";
import { restoreIntoOrg } from "./restore.server";

// In-process persistence double exercises the actual export pagination and restore writes.
// It is not a substitute for live RLS/trigger tests in the database CI suite.
class BackupStore {
  tables: Record<string, Row[]> = {};
  writes: { table: string; size: number }[] = [];
  pages: { table: string; from: number }[] = [];
  failTable: string | null = null;

  // Core (schema public) and Ledger tables share one store; core's
  // create_organization makes the org and the caller its owner.
  schema() {
    return this;
  }
  // ledger.restore_into (0017) writes everything in the database in one step; here we keep
  // what it was sent, to check the server's part: new ids, intact links, unchanged reports.
  restoreCalls: Row[] = [];
  async rpc(name: string, args: Row) {
    if (name !== "restore_into") return { data: null, error: { message: `no rpc ${name}` } };
    this.restoreCalls.push(structuredClone(args));
    return { data: {}, error: null };
  }

  from(table: string) {
    let operation = "select";
    let payload: Row[] = [];
    let columns = "*";
    let order = "id";
    let start = 0;
    let end = Infinity;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const execute = async () => {
      const stored = this.tables[table] ?? [];
      const selected = stored.filter((r) => filters.every((f) => f(r)));
      if (operation === "insert") {
        if (this.failTable === table)
          return { data: null, error: { message: "Injected write failure" } };
        if (table === "entries") {
          const txIds = new Set(payload.map((r) => r["transaction_id"]));
          for (const id of txIds) {
            const lines = payload.filter((r) => r["transaction_id"] === id);
            if (lines.length < 2 || lines.reduce((n, r) => n + Number(r["amount_cents"]), 0) !== 0)
              return { data: null, error: { message: "Unbalanced request" } };
          }
        }
        if (
          table === "reconciliations" &&
          payload.some((r) =>
            stored.some(
              (s) =>
                s["org_id"] === r["org_id"] &&
                s["account_id"] === r["account_id"] &&
                s["status"] === "in_progress",
            ),
          )
        )
          return { data: null, error: { message: "Only one open statement check" } };
        this.tables[table] = [...stored, ...structuredClone(payload)];
        this.writes.push({ table, size: payload.length });
      } else if (operation === "update") {
        for (const row of selected) Object.assign(row, payload[0]);
      } else if (operation === "delete") {
        this.tables[table] = stored.filter((r) => !selected.includes(r));
        if (table === "organizations") {
          for (const org of selected) {
            const txIds = new Set(
              (this.tables["transactions"] ?? [])
                .filter((t) => t["org_id"] === org["id"])
                .map((t) => t["id"]),
            );
            for (const name of [...TABLES, "org_settings", "memberships"])
              this.tables[name] = (this.tables[name] ?? []).filter(
                (r) => r["org_id"] !== org["id"] && !txIds.has(r["transaction_id"]),
              );
          }
        }
      } else {
        this.pages.push({ table, from: start });
        const rows = [...selected]
          .sort((a, b) => String(a[order]).localeCompare(String(b[order])))
          .slice(start, end === Infinity ? undefined : end + 1)
          .map((r) => {
            if (!columns.includes("transactions!inner")) return structuredClone(r);
            const tx = (this.tables["transactions"] ?? []).find(
              (t) => t["id"] === r["transaction_id"],
            );
            return { ...structuredClone(r), transactions: { org_id: tx?.["org_id"] } };
          });
        return { data: single ? rows[0] : rows, error: null };
      }
      return { data: null, error: null };
    };
    const query = {
      select: (value = "*") => {
        columns = value;
        return query;
      },
      eq: (key: string, value: unknown) => {
        filters.push(
          key === "transactions.org_id"
            ? (r) =>
                (this.tables["transactions"] ?? []).some(
                  (t) => t["id"] === r["transaction_id"] && t["org_id"] === value,
                )
            : (r) => r[key] === value,
        );
        return query;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[key]));
        return query;
      },
      order: (key: string) => {
        order = key;
        return query;
      },
      range: (from: number, to: number) => {
        start = from;
        end = to;
        return query;
      },
      single: () => {
        single = true;
        return query;
      },
      maybeSingle: () => {
        single = true;
        return query;
      },
      insert: (rows: Row | Row[]) => {
        operation = "insert";
        payload = Array.isArray(rows) ? rows : [rows];
        return query;
      },
      update: (row: Row) => {
        operation = "update";
        payload = [row];
        return query;
      },
      delete: () => {
        operation = "delete";
        return query;
      },
      then: (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        execute().then(resolve, reject),
    };
    return query;
  }
}

const ORG_ID = "00000000-0000-4000-8000-000000000001";
function fixture(db: BackupStore) {
  db.tables = Object.fromEntries(TABLES.map((t) => [t, []]));
  db.tables["organizations"] = [{ id: ORG_ID, name: "Community Books" }];
  db.tables["org_settings"] = [
    {
      org_id: ORG_ID,
      currency: "USD",
      timezone: "America/Chicago",
      org_type: "nonprofit",
      books_locked_through: "2026-01-31",
    },
  ];
  db.tables["memberships"] = [{ org_id: ORG_ID, user_id: "old-user", role: "admin" }];
  db.tables["member_roles"] = [];
  const add = (table: string, row: Row) => {
    const rows = db.tables[table];
    if (!rows) throw new Error(`Missing fixture table ${table}`);
    rows.push({ org_id: ORG_ID, ...row });
  };
  for (const [id, type] of [
    ["cash", "asset"],
    ["income", "revenue"],
    ["expense", "expense"],
    ["archived", "asset"],
  ])
    add("accounts", { id, name: id, type, is_active: id !== "archived" });
  add("categories", { id: "category", name: "Gifts", type: "income" });
  add("tags", { id: "tag", name: "Annual" });
  add("projects", { id: "project", name: "Kitchen", status: "active", budget_cents: 500000 });
  add("funds", { id: "fund", name: "Kitchen fund", is_restricted: true });
  add("import_batches", {
    id: "batch",
    account_id: "cash",
    file_name: "statement.csv",
    status: "completed",
  });
  add("import_profiles", {
    id: "profile",
    account_id: "cash",
    name: "Bank",
    mapping: { date: 0, amount: 1 },
  });
  for (let i = 0; i < 1500; i++) {
    const tx = `tx-${String(i).padStart(4, "0")}`;
    const amount = 10000 + i;
    const status = i % 25 === 0 ? "void" : "posted";
    add("transactions", {
      id: tx,
      transaction_date: "2026-01-15",
      description: `Gift ${i}`,
      status,
      source: "manual",
      idempotency_key: tx,
    });
    const reconciliation = status === "void" ? null : i < 750 ? "rec-1" : "rec-2";
    for (const [suffix, account, cents] of [
      ["cash", "cash", amount],
      ["income", "income", -amount - 500],
      ["expense", "expense", 500],
    ] as const)
      add("entries", {
        id: `${tx}-${suffix}`,
        transaction_id: tx,
        account_id: account,
        amount_cents: cents,
        fund_id: "fund",
        project_id: "project",
        category_id: "category",
        memo: `Line ${i}`,
        reconciliation_id: suffix === "cash" ? reconciliation : null,
      });
    add("transaction_tags", { transaction_id: tx, tag_id: "tag" });
    add("bank_transactions", {
      id: `bank-${i}`,
      account_id: "cash",
      transaction_id: status === "void" ? null : tx,
      amount_cents: amount,
      bank_date: "2026-01-15",
      batch_id: "batch",
      row_seq: i,
      external_id: `fit-${i}`,
      raw: { description: `Gift ${i}` },
    });
    add("audit_log", {
      id: `history-${i}`,
      action: "created",
      entity: "transaction",
      entity_id: tx,
      user_id: "old-user",
      after: { amount },
      created_at: "2026-01-15T12:00:00Z",
    });
  }
  for (const [id, created] of [
    ["rec-1", "2026-01-20T12:00:00Z"],
    ["rec-2", "2026-01-21T12:00:00Z"],
  ])
    add("reconciliations", {
      id,
      account_id: "cash",
      batch_id: "batch",
      status: "completed",
      created_at: created,
      completed_at: created,
      beginning_balance_cents: 0,
      ending_balance_cents: 0,
    });
  add("reconciliations", {
    id: "rec-open",
    account_id: "cash",
    status: "in_progress",
    created_at: "2026-02-01T12:00:00Z",
  });
  add("period_closes", {
    id: "close",
    fiscal_year_end: "2025-12-31",
    transaction_id: null,
    net_income_cents: 0,
  });
  add("pledges", {
    id: "pledge",
    fund_id: "fund",
    transaction_id: "tx-0001",
    donor_name: "Donor",
    amount_cents: 10000,
    status: "open",
    pledge_date: "2026-01-15",
  });
  add("pledge_payments", {
    id: "payment",
    pledge_id: "pledge",
    transaction_id: "tx-0002",
    kind: "payment",
    amount_cents: 2000,
    paid_date: "2026-01-15",
  });
  add("budgets", {
    id: "budget",
    account_id: "expense",
    period_type: "yearly",
    period_start: "2026-01-01",
    amount_cents: 500000,
  });
  // Unrelated books must never leak into the export or be touched by restore/rollback.
  add("accounts", { id: "foreign-account", org_id: "foreign-org", name: "Private", type: "asset" });
}

function reports(tables: Record<string, Row[]>) {
  const accounts = new Map((tables["accounts"] ?? []).map((r) => [r["id"], r]));
  const txs = new Map((tables["transactions"] ?? []).map((r) => [r["id"], r]));
  const rows: LedgerRow[] = (tables["entries"] ?? []).flatMap((e) => {
    const account = accounts.get(e["account_id"]);
    const tx = txs.get(e["transaction_id"]);
    if (!account || !tx || tx["status"] === "void") return [];
    return [
      {
        amountCents: Number(e["amount_cents"]),
        accountName: String(account["name"]),
        accountType: account["type"] as LedgerRow["accountType"],
        transactionDate: String(tx["transaction_date"]),
      },
    ];
  });
  return {
    trial: computeTrialBalance(rows),
    income: computeIncome(rows),
    balance: computeBalance(rows, "2026-12-31", "2026-01-01"),
  };
}

const TARGET_ORG = "target-org";

describe("moderately sized organization backup roundtrip", () => {
  let db: BackupStore;
  beforeEach(async () => {
    db = new BackupStore();
    fixture(db);
    (db.tables["organizations"] ??= []).push({ id: TARGET_ORG, name: "Empty books" });
    state.db = db;
  });

  async function signedBackup() {
    const keys = await keysFromSeed("test-only-backup-seed".repeat(4));
    const source = await readBackupData(db as unknown as UntypedDb, ORG_ID);
    const exported = await signBackup(
      keys,
      source.organization,
      source.tables,
      "2026-10-07T00:00:00Z",
    );
    return { keys, exported };
  }

  it("exports 1,500 transactions and sends them, with new ids and intact links, in one call", async () => {
    const { keys, exported } = await signedBackup();
    const verified = await verifyBackup(JSON.parse(JSON.stringify(exported)), keys.publicRaw);
    expect(verified.counts["transactions"]).toBe(1500);
    expect(verified.counts["entries"]).toBe(4500);
    for (const table of [
      "transactions",
      "entries",
      "transaction_tags",
      "bank_transactions",
      "audit_log",
    ])
      expect(db.pages.some((p) => p.table === table && p.from === 1000)).toBe(true);
    const original = structuredClone(db.tables);
    const restored = await restoreIntoOrg(db as unknown as UntypedDb, TARGET_ORG, verified);
    expect(restored).toEqual({ orgId: TARGET_ORG, name: "Empty books" });
    expect(db.restoreCalls).toHaveLength(1);
    const call = db.restoreCalls[0]!;
    expect(call["p_org"]).toBe(TARGET_ORG);
    const tables = call["p_tables"] as Record<string, Row[]>;
    for (const table of TABLES) {
      if (table === "user_roles") continue;
      expect(tables[table] ?? [], table).toHaveLength(verified.counts[table] ?? 0);
      const sourceIds = new Set((exported.tables[table] ?? []).map((r) => r["id"]).filter(Boolean));
      for (const row of tables[table] ?? [])
        if (row["id"]) expect(sourceIds.has(row["id"])).toBe(false);
    }
    for (const [table, refs] of Object["entries"](REFS))
      for (const row of tables[table] ?? [])
        for (const [column, target] of Object["entries"](refs))
          if (row[column] != null)
            expect((tables[target] ?? []).some((r) => r["id"] === row[column])).toBe(true);
    checkRestorable(tables);
    expect(reports(tables)).toEqual(reports(exported.tables));
    expect((call["p_meta"] as Row)["original_org_id"]).toBe(ORG_ID);
    // Reading the backup changed nothing.
    expect(db.tables).toEqual(original);
  }, 30000);

  it("a changed backup is refused before anything is sent, with the bad-backup pop-up wording", async () => {
    const { explainError } = await import("./friendly-errors");
    const { keys, exported } = await signedBackup();
    const tampered = JSON.parse(JSON.stringify(exported));
    tampered.tables.entries[0].amount_cents += 100;
    let caught: unknown;
    try {
      const v = await verifyBackup(tampered, keys.publicRaw);
      await restoreIntoOrg(db as unknown as UntypedDb, TARGET_ORG, v);
    } catch (e) {
      caught = e;
    }
    expect(explainError(caught).kind).toBe("bad_backup");
    expect(explainError(caught).detail).toContain("Nothing was restored");
    expect(db.restoreCalls).toHaveLength(0);
  }, 30000);
});
