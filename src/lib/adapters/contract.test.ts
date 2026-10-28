// Adapter contract: every storage adapter must pass the same workflows through the ports.
// Add a new adapter here and it is held to the same behavior as the others.
import { reopenPeriod } from "@/lib/services/periods";
import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import type { Repositories } from "@/lib/ports";
import { createMemoryRepositories } from "./memory";
import { createSqliteRepositories, migrateSqlite } from "./sqlite";
import { sqlJsDriver } from "./sqlite/sqljs-driver";
import {
  postBankRow,
  postOpeningBalance,
  postTransaction,
  voidTransaction,
} from "@/lib/services/ledger";
import * as recon from "@/lib/services/reconciliation";
import * as reports from "@/lib/services/reports";
import * as settings from "@/lib/services/settings";
import * as fundsSvc from "@/lib/services/funds";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const USER = "10000000-0000-4000-8000-0000000000aa";
const CASH = "10000000-0000-4000-8000-0000000000c1";
const SALES = "10000000-0000-4000-8000-0000000000c2";
const EQUITY = "10000000-0000-4000-8000-0000000000c3";
const OLD = "10000000-0000-4000-8000-0000000000c4";

const SQL = await initSqlJs();
let sqliteDriver: ReturnType<typeof sqlJsDriver>;

const adapters: [string, () => Promise<Repositories>][] = [
  ["memory", async () => createMemoryRepositories()],
  [
    "sqlite",
    async () => {
      sqliteDriver = sqlJsDriver(new SQL.Database());
      await migrateSqlite(sqliteDriver);
      return createSqliteRepositories(sqliteDriver);
    },
  ],
];

describe.each(adapters)("%s adapter", (name, make) => {
  let repos: Repositories;
  const sale = (over: Partial<Parameters<typeof postTransaction>[1]> = {}) => ({
    orgId: ORG,
    userId: USER,
    transactionDate: "2026-02-01",
    description: "Sale",
    source: "manual" as const,
    entries: [
      { accountId: CASH, amountCents: 1000 },
      { accountId: SALES, amountCents: -1000 },
    ],
    ...over,
  });

  beforeEach(async () => {
    repos = await make();
    const base = {
      orgType: "business" as const,
      currency: "USD",
      fiscalYearStartMonth: 1,
      timezone: "America/Chicago",
      terminology: "simple",
      termOverrides: {},
      aiPdfEnabled: false,
      booksLockedThrough: null,
      createdBy: USER,
    };
    await repos.orgs.create({ ...base, id: ORG, name: "Org" });
    await repos.orgs.create({ ...base, id: OTHER, name: "Other" });
    const a = (id: string, n: string, type: "asset" | "revenue" | "equity", isActive = true) => ({
      id,
      orgId: ORG,
      name: n,
      type,
      subtype: null,
      isActive,
    });
    await repos.accounts.create([
      a(CASH, "Cash", "asset"),
      a(SALES, "Sales", "revenue"),
      a(EQUITY, "Equity", "equity"),
      a(OLD, "Old", "asset", false),
    ]);
  });

  it("templates save in place, record each due date once, and keep the org's recurring mode", async () => {
    const T = "50000000-0000-4000-8000-000000000001";
    const tpl = {
      id: T,
      orgId: ORG,
      name: "Rent",
      description: "Rent",
      lines: [
        { accountId: CASH, amountCents: -500 },
        { accountId: SALES, amountCents: 500 },
      ],
      frequency: "monthly" as const,
      nextDue: "2026-01-01",
      active: true,
    };
    await repos.templates.save(tpl);
    await repos.templates.save({ ...tpl, name: "Office rent" });
    expect((await repos.templates.list(ORG)).map((t) => t.name)).toEqual(["Office rent"]);
    expect((await repos.templates.get(ORG, T))?.lines).toEqual(tpl.lines);
    const occ = { id: "50000000-0000-4000-8000-000000000002", orgId: ORG, templateId: T, dueDate: "2026-01-01", status: "skipped" as const, transactionId: null };
    expect(await repos.templates.recordOccurrence(occ, "2026-02-01")).toBe(true);
    expect(
      await repos.templates.recordOccurrence({ ...occ, id: "50000000-0000-4000-8000-000000000003" }, "2026-03-01"),
    ).toBe(false);
    expect((await repos.templates.get(ORG, T))?.nextDue).toBe("2026-02-01");
    expect(await repos.templates.occurrences(ORG)).toHaveLength(1);
    expect(await repos.templates.getMode(ORG)).toBe("drafts");
    await repos.templates.setMode(ORG, "reminder");
    expect(await repos.templates.getMode(ORG)).toBe("reminder");
    expect(await repos.templates.getMode(OTHER)).toBe("drafts");
  });

  it("budgets keep one row per account, period and scope, updated in place", async () => {
    const b = { orgId: ORG, accountId: SALES, fundId: null, projectId: null, periodType: "year" as const, periodStart: "2026-01-01" };
    await repos.budgets.set({ ...b, id: "60000000-0000-4000-8000-000000000001", amountCents: 100 });
    await repos.budgets.set({ ...b, id: "60000000-0000-4000-8000-000000000002", amountCents: 250 });
    let rows = await repos.budgets.list(ORG, "year", "2026-01-01");
    expect(rows).toEqual([expect.objectContaining({ id: "60000000-0000-4000-8000-000000000001", amountCents: 250 })]);
    await repos.budgets.set({ ...b, id: "60000000-0000-4000-8000-000000000003", amountCents: null });
    rows = await repos.budgets.list(ORG, "year", "2026-01-01");
    expect(rows).toEqual([]);
  });

  it("creator becomes admin; orgs are listed per user", async () => {
    expect(await repos.orgs.roleOf(USER, ORG)).toBe("admin");
    expect((await repos.orgs.listForUser(USER)).map((o) => o.id).sort()).toEqual(
      [ORG, OTHER].sort(),
    );
  });

  it("archived accounts hide from list unless asked", async () => {
    expect((await repos.accounts.list(ORG)).map((x) => x.name)).not.toContain("Old");
    expect(
      (await repos.accounts.list(ORG, { includeArchived: true })).map((x) => x.name),
    ).toContain("Old");
  });

  it("posts, reads back and sums to zero", async () => {
    const { id } = await postTransaction(repos, sale());
    const tx = await repos.transactions.get(ORG, id);
    expect(tx?.status).toBe("posted");
    expect(tx?.entries.reduce((s, e) => s + e.amountCents, 0)).toBe(0);
    expect(await repos.transactions.get(OTHER, id)).toBeNull();
    expect((await repos.transactions.list(ORG, { accountId: CASH })).map((t) => t.id)).toEqual([
      id,
    ]);
  });

  const breakHistory = async () => {
    if (name === "memory") (repos as any).store.failAudit = true;
    else await sqliteDriver.execute("ALTER TABLE audit_log RENAME TO audit_log_gone");
  };

  it("a posting and its history entry are saved together", async () => {
    const { id } = await postTransaction(repos, sale());
    expect((await repos.audit.listFor(ORG, "transaction", id)).map((h) => h.action)).toEqual([
      "create",
    ]);
    await breakHistory();
    await expect(postTransaction(repos, sale({ description: "Lost" }))).rejects.toThrow();
    expect(await repos.transactions.list(ORG)).toHaveLength(1);
    await expect(
      voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: id }),
    ).rejects.toThrow();
    expect((await repos.transactions.get(ORG, id))?.status).toBe("posted");
  });

  it("year-end close, book lock and history are saved together", async () => {
    await postTransaction(repos, sale());
    const close = {
      orgId: ORG,
      userId: USER,
      fiscalYearEnd: "2026-12-31",
      retainedEarningsAccountId: EQUITY,
    };
    await breakHistory();
    await expect(settings.closeFiscalYear(repos, close)).rejects.toThrow();
    const status = await settings.getBooksStatus(repos, ORG);
    expect(status.closes).toHaveLength(0);
    expect(status.booksLockedThrough).toBeNull();
  });

  it("settings changes and their history entry are saved together", async () => {
    const ev = (action: string) => ({
      orgId: ORG,
      userId: USER,
      action,
      entity: "organization",
      entityId: ORG,
    });
    await repos.orgs.updateSettings(ORG, { name: "Renamed" }, ev("update"));
    await repos.orgs.setBooksLockedThrough(ORG, "2026-01-31", ev("lock_books"));
    expect(
      (await repos.audit.listFor(ORG, "organization", ORG)).map((h) => h.action).sort(),
    ).toEqual(["lock_books", "update"]);
    await breakHistory();
    await expect(repos.orgs.updateSettings(ORG, { name: "Lost" }, ev("update"))).rejects.toThrow();
    await expect(repos.orgs.setBooksLockedThrough(ORG, null, ev("unlock_books"))).rejects.toThrow();
    const org = await repos.orgs.get(ORG);
    expect(org?.name).toBe("Renamed");
    expect(org?.booksLockedThrough).toBe("2026-01-31");
  });

  it("idempotency key returns the original", async () => {
    const a = await postTransaction(repos, sale({ idempotencyKey: "form-abcdef" }));
    const b = await postTransaction(repos, sale({ idempotencyKey: "form-abcdef" }));
    expect(b).toEqual({ id: a.id, duplicate: true });
    expect(await repos.transactions.list(ORG)).toHaveLength(1);
  });

  it("books lock and archived accounts are refused", async () => {
    await expect(
      postTransaction(
        repos,
        sale({
          entries: [
            { accountId: OLD, amountCents: 1 },
            { accountId: SALES, amountCents: -1 },
          ],
        }),
      ),
    ).rejects.toThrow(/active/);
    await repos.orgs.setBooksLockedThrough(ORG, "2026-12-31");
    await expect(postTransaction(repos, sale())).rejects.toThrow(/closed through/);
  });

  it("void is idempotent, unticks in-progress check, blocked by a completed one", async () => {
    const { id } = await postTransaction(repos, sale());
    const entryId = (await repos.transactions.get(ORG, id))!.entries.find(
      (e) => e.accountId === CASH,
    )!.id;
    await repos.reconciliations.start({
      id: "20000000-0000-4000-8000-000000000001",
      orgId: ORG,
      accountId: CASH,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      beginningBalanceCents: 0,
      endingBalanceCents: 1000,
      mode: "simple",
      batchId: null,
      createdBy: USER,
    });
    await repos.reconciliations.setTicked("20000000-0000-4000-8000-000000000001", [entryId], true);
    expect(
      await repos.reconciliations.clearedTotalCents("20000000-0000-4000-8000-000000000001"),
    ).toBe(1000);
    await voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: id });
    const after = await repos.transactions.get(ORG, id);
    expect(after?.status).toBe("void");
    expect(after?.entries.every((e) => e.reconciliationId === null)).toBe(true);
    expect(await voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: id })).toEqual({
      ok: true,
      alreadyVoid: true,
    });

    const second = await postTransaction(repos, sale());
    const e2 = (await repos.transactions.get(ORG, second.id))!.entries[0]!.id;
    await repos.reconciliations.setTicked("20000000-0000-4000-8000-000000000001", [e2], true);
    await repos.reconciliations.finish(ORG, "20000000-0000-4000-8000-000000000001", USER);
    await expect(
      voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: second.id }),
    ).rejects.toThrow(/statement check/);
  });

  it("one opening balance per account", async () => {
    const ob = {
      orgId: ORG,
      userId: USER,
      accountId: CASH,
      equityAccountId: EQUITY,
      amountCents: 5000,
      date: "2026-01-01",
    };
    expect(await postOpeningBalance(repos, ob)).toEqual({ ok: true });
    await expect(postOpeningBalance(repos, { ...ob, amountCents: 1 })).rejects.toThrow(/already/);
    const rows = await repos.transactions.ledgerRows(ORG);
    expect(rows.find((r) => r.accountId === CASH)?.amountCents).toBe(5000);
  });

  it("bank rows: dedupe, post once, void returns to unmatched", async () => {
    const row = {
      id: "30000000-0000-4000-8000-000000000001",
      orgId: ORG,
      accountId: CASH,
      bankDate: "2026-02-03",
      description: "Deposit",
      amountCents: 2500,
      externalId: "FIT1",
      fingerprint: "f1",
      rowSeq: 1,
      batchId: null,
    };
    expect(await repos.bank.insertMany([row])).toEqual({ inserted: 1, duplicates: 0 });
    expect(
      await repos.bank.insertMany([{ ...row, id: "30000000-0000-4000-8000-000000000002" }]),
    ).toEqual({ inserted: 0, duplicates: 1 });
    const { id } = await postBankRow(repos, {
      orgId: ORG,
      userId: USER,
      bankTransactionId: row.id,
      offsetAccountId: SALES,
    });
    expect((await repos.bank.get(ORG, row.id))?.transactionId).toBe(id);
    await expect(
      postBankRow(repos, {
        orgId: ORG,
        userId: USER,
        bankTransactionId: row.id,
        offsetAccountId: SALES,
      }),
    ).rejects.toThrow(/Already posted/);
    await voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: id });
    expect((await repos.bank.listUnmatched(ORG)).map((b) => b.id)).toEqual([row.id]);
  });

  it("statement check: start, match, finish at zero, reopen, discard, history", async () => {
    const t1 = await postTransaction(repos, sale({ transactionDate: "2026-02-02" }));
    await postTransaction(
      repos,
      sale({
        transactionDate: "2026-02-20",
        entries: [
          { accountId: CASH, amountCents: 300 },
          { accountId: SALES, amountCents: -300 },
        ],
      }),
    );
    await repos.bank.insertMany([
      {
        id: "50000000-0000-4000-8000-000000000001",
        orgId: ORG,
        accountId: CASH,
        bankDate: "2026-02-04",
        description: "Deposit",
        amountCents: 1000,
        externalId: "S1",
        fingerprint: "s1",
        rowSeq: 1,
        batchId: null,
      },
    ]);
    const input = {
      orgId: ORG,
      accountId: CASH,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      beginningBalanceCents: 0,
      endingBalanceCents: 1000,
      mode: "simple" as const,
      batchId: null,
      userId: USER,
    };
    const { id } = await recon.startReconciliation(repos, input);
    await expect(recon.startReconciliation(repos, input)).rejects.toThrow(/in progress/);
    let r = (await repos.reconciliations.locate(id))!;
    let view = await recon.getReconciliation(repos, r);
    expect(view.entries).toHaveLength(2);
    expect(view.matches).toHaveLength(1);
    expect(view.reconciliation.accountName).toBe("Cash");
    expect(await recon.acceptMatches(repos, r, USER)).toEqual({ cleared: 1 });
    view = await recon.getReconciliation(repos, r);
    expect(view.summary.difference).toBe(0);
    // Ticking a line from another account is ignored by every adapter.
    const other = (await repos.transactions.get(ORG, t1.id))!.entries.find(
      (e) => e.accountId === SALES,
    )!;
    await recon.setCleared(repos, r, [other.id], true, USER);
    expect((await recon.getReconciliation(repos, r)).summary.difference).toBe(0);
    await recon.completeReconciliation(repos, r, USER);
    r = (await repos.reconciliations.locate(id))!;
    expect(r.status).toBe("completed");
    await expect(recon.setCleared(repos, r, [other.id], false, USER)).rejects.toThrow(/completed/);
    expect((await recon.listReconciliations(repos, ORG))[0]).toMatchObject({ id, itemCount: 1 });
    const next = await recon.suggestReconciliation(repos, ORG, CASH);
    expect(next).toMatchObject({ periodStart: "2026-03-01", beginningBalanceCents: 1000 });
    await recon.reopenReconciliation(repos, r, USER);
    r = (await repos.reconciliations.locate(id))!;
    await recon.discardReconciliation(repos, r, USER);
    expect(await repos.reconciliations.locate(id)).toBeNull();
    expect(await repos.reconciliations.itemCounts(ORG)).toEqual({});
    const history = await repos.audit.listFor(ORG, "reconciliation", id);
    expect(history[0]?.action).toBe("reconcile_discard");
    expect(history.map((h) => h.action)).toContain("reconcile_complete");
  });

  it("statement check refuses to finish with a difference", async () => {
    await postTransaction(repos, sale());
    const { id } = await recon.startReconciliation(repos, {
      orgId: ORG,
      accountId: CASH,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      beginningBalanceCents: 0,
      endingBalanceCents: 999,
      mode: "full",
      batchId: null,
      userId: USER,
    });
    const r = (await repos.reconciliations.locate(id))!;
    await expect(recon.completeReconciliation(repos, r, USER)).rejects.toThrow();
  });

  it("reports: income, balance sheet and trial balance use posted rows only", async () => {
    await postTransaction(repos, sale());
    const { id } = await postTransaction(repos, sale({ transactionDate: "2026-02-05" }));
    await voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: id });
    const inc = await reports.incomeStatement(repos, ORG, { from: "2026-01-01", to: "2026-12-31" });
    expect(inc).toMatchObject({ totalRevenueCents: 1000 });
    const bs = await reports.balanceSheet(repos, ORG, "2026-12-31");
    expect(bs.asOf).toBe("2026-12-31");
    const tb = await reports.trialBalance(repos, ORG, "2026-12-31");
    expect(tb.asOf).toBe("2026-12-31");
    expect(await reports.projectSummary(repos, ORG)).toEqual([]);
  });

  it("settings: update, lock, virtual year-end close is once only", async () => {
    await settings.updateOrganization(repos, ORG, USER, {
      name: "Renamed",
      orgType: "nonprofit",
      currency: "USD",
      fiscalYearStartMonth: 1,
      timezone: "America/Chicago",
      terminology: "accounting",
      termOverrides: {},
    });
    expect(await repos.orgs.get(ORG)).toMatchObject({ name: "Renamed", orgType: "nonprofit" });
    await postTransaction(repos, sale());
    const preview = await settings.previewYearEndClose(repos, ORG, "2026-12-31");
    expect(preview.netIncomeCents).not.toBe(0);
    await expect(
      settings.closeFiscalYear(repos, {
        orgId: ORG,
        userId: USER,
        fiscalYearEnd: "2026-12-31",
        retainedEarningsAccountId: SALES,
      }),
    ).rejects.toThrow(/equity/);
    const close = {
      orgId: ORG,
      userId: USER,
      fiscalYearEnd: "2026-12-31",
      retainedEarningsAccountId: EQUITY,
    };
    expect(await settings.closeFiscalYear(repos, close)).toMatchObject({ ok: true });
    expect(await settings.closeFiscalYear(repos, close)).toEqual({ ok: true, duplicate: true });
    const status = await settings.getBooksStatus(repos, ORG);
    expect(status.booksLockedThrough).toBe("2026-12-31");
    expect(status.closes).toHaveLength(1);
    await expect(settings.previewYearEndClose(repos, ORG, "2026-12-31")).rejects.toThrow(/closed/);
    await expect(postTransaction(repos, sale({ transactionDate: "2026-06-01" }))).rejects.toThrow();
    await reopenPeriod(repos, {
      orgId: ORG,
      userId: USER,
      reopenThrough: null,
      reason: "Contract test reopen",
    });
    expect((await repos.orgs.get(ORG))?.booksLockedThrough).toBeNull();
  });

  it("tracks restricted funds and limits releases to what is left", async () => {
    const FUND = "10000000-0000-4000-8000-0000000000f1";
    const funds = [{ id: FUND, name: "Roof", isRestricted: true }];
    await postTransaction(
      repos,
      sale({
        entries: [
          { accountId: CASH, amountCents: 5000 },
          { accountId: SALES, amountCents: -5000, fundId: FUND },
        ],
      }),
    );
    const input = {
      orgId: ORG,
      userId: USER,
      fundId: FUND,
      funds,
      date: "2026-03-01",
      idempotencyKey: "release:1",
    };
    await fundsSvc.releaseFund(repos, { ...input, amountCents: 2000 });
    const s = await fundsSvc.fundSummary(repos, ORG, funds);
    expect(s.funds[0]).toMatchObject({
      receivedCents: 5000,
      releasedCents: 2000,
      remainingCents: 3000,
    });
    expect(s.netAssets).toMatchObject({ totalCents: 5000, withRestrictionsCents: 3000 });
    await expect(
      fundsSvc.releaseFund(repos, { ...input, amountCents: 3001, idempotencyKey: "release:2" }),
    ).rejects.toThrow(/only has/);
  });

  it("rolls back a reconciliation finish when history fails", async () => {
    const input = {
      orgId: ORG,
      accountId: CASH,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      beginningBalanceCents: 0,
      endingBalanceCents: 0,
      mode: "simple" as const,
      batchId: null,
      userId: USER,
    };
    const { id } = await recon.startReconciliation(repos, input);
    const r = (await repos.reconciliations.locate(id))!;
    await breakHistory();
    await expect(recon.completeReconciliation(repos, r, USER)).rejects.toThrow();
    expect((await repos.reconciliations.locate(id))?.status).toBe("in_progress");
  });

  it("start, tick and discard leave no change when history fails", async () => {
    await postTransaction(repos, sale({ transactionDate: "2026-02-02" }));
    const input = {
      orgId: ORG,
      accountId: CASH,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      beginningBalanceCents: 0,
      endingBalanceCents: 1000,
      mode: "simple" as const,
      batchId: null,
      userId: USER,
    };
    const { id } = await recon.startReconciliation(repos, input);
    const r = (await repos.reconciliations.locate(id))!;
    const entry = (await recon.getReconciliation(repos, r)).entries[0]!;
    await breakHistory();
    await expect(recon.setCleared(repos, r, [entry.id], true, USER)).rejects.toThrow();
    expect(await repos.reconciliations.clearedTotalCents(id)).toBe(0);
    await expect(recon.discardReconciliation(repos, r, USER)).rejects.toThrow();
    expect(await repos.reconciliations.locate(id)).not.toBeNull();
    await expect(
      recon.startReconciliation(repos, { ...input, accountId: EQUITY }),
    ).rejects.toThrow();
    expect(await repos.reconciliations.list(ORG, EQUITY)).toEqual([]);
  });

  it("posting a bank row keeps it unmatched when history fails", async () => {
    const row = {
      id: "30000000-0000-4000-8000-0000000000b1",
      orgId: ORG,
      accountId: CASH,
      bankDate: "2026-02-03",
      description: "Deposit",
      amountCents: 2500,
      externalId: "FITB",
      fingerprint: "fb",
      rowSeq: 1,
      batchId: null,
    };
    await repos.bank.insertMany([row]);
    await breakHistory();
    await expect(
      postBankRow(repos, {
        orgId: ORG,
        userId: USER,
        bankTransactionId: row.id,
        offsetAccountId: SALES,
      }),
    ).rejects.toThrow();
    expect((await repos.bank.get(ORG, row.id))?.transactionId ?? null).toBeNull();
    expect(await repos.transactions.list(ORG)).toEqual([]);
  });

  if (name === "sqlite") {
    it("database guards block edits, deletes, un-void and unbalanced writes", async () => {
      const { id } = await postTransaction(repos, sale());
      const bad = (sql: string, p: (string | number)[] = []) =>
        expect(sqliteDriver.execute(sql, p)).rejects.toThrow();
      await bad("UPDATE entries SET amount_cents = 5 WHERE transaction_id = ?", [id]);
      await bad("DELETE FROM entries WHERE transaction_id = ?", [id]);
      await bad("UPDATE transactions SET description = 'x' WHERE id = ?", [id]);
      await bad("DELETE FROM transactions WHERE id = ?", [id]);
      await repos.transactions.markVoid(ORG, id);
      await bad("UPDATE transactions SET status = 'posted' WHERE id = ?", [id]);
      await bad("DELETE FROM audit_log");
      await expect(
        repos.transactions.post({
          id: "40000000-0000-4000-8000-000000000001",
          orgId: ORG,
          transactionDate: "2026-02-01",
          postedDate: null,
          description: "bad",
          source: "manual",
          createdBy: USER,
          idempotencyKey: null,
          entries: [
            { id: "40000000-0000-4000-8000-000000000002", accountId: CASH, amountCents: 100 },
            { id: "40000000-0000-4000-8000-000000000003", accountId: SALES, amountCents: -90 },
          ],
        }),
      ).rejects.toThrow(/not balanced/);
      expect(await repos.transactions.get(ORG, "40000000-0000-4000-8000-000000000001")).toBeNull();
    });

    it("migrations are idempotent", async () => {
      expect(await migrateSqlite(sqliteDriver)).toBe(0);
    });
  }
});
