import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/lib/adapters/memory";
import { callLocal } from "@/lib/desktop/local-api";
import { dueDates, nextDate, templateProblem } from "@/lib/domain/templates";
import { matchesFilter } from "@/lib/domain/search";
import { runChecks } from "@/lib/domain/diagnostics";
import * as tpl from "./templates";
import { budgetVsActual, saveBudget } from "./budgets";
import { getSetupProgress } from "./diagnostics";

const U = "00000000-0000-4000-8000-000000000001";

async function setup() {
  const repos = createMemoryRepositories();
  const { id: orgId } = (await callLocal(
    "createOrganization",
    {
      name: "Shop",
      orgType: "business",
      accountKeys: [],
      currency: "USD",
      fiscalYearStartMonth: 1,
      terminology: "simplest",
      timezone: "UTC",
    },
    repos,
  )) as { id: string };
  await repos.accounts.create([
    { id: "33333333-3333-4333-8333-333333333333", orgId, name: "Supplies", type: "expense", subtype: null, isActive: true },
  ]);
  const accts = await repos.accounts.list(orgId);
  const cash = accts.find((a) => a.type === "asset")!;
  const expense = accts.find((a) => a.type === "expense")!;
  return { repos, orgId, cash, expense };
}

describe("recurring schedule", () => {
  it("monthly keeps the day and clamps to month end", () => {
    expect(nextDate("monthly", "2026-01-31", 31)).toBe("2026-02-28");
    expect(nextDate("monthly", "2026-02-28", 31)).toBe("2026-03-31");
    expect(nextDate("weekly", "2026-12-28")).toBe("2027-01-04");
    expect(nextDate("quarterly", "2026-11-15")).toBe("2027-02-15");
    expect(nextDate("yearly", "2028-02-29", 29)).toBe("2029-02-28");
  });
  it("lists every missed due date up to today", () => {
    const t = {
      id: "t",
      orgId: "o",
      name: "Rent",
      description: "Rent",
      lines: [],
      frequency: "monthly" as const,
      nextDue: "2026-08-01",
      active: true,
    };
    expect(dueDates(t, "2026-10-15")).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(dueDates({ ...t, active: false }, "2026-10-15")).toEqual([]);
  });
  it("rejects a template that doesn't balance", () => {
    expect(
      templateProblem({
        name: "X",
        description: "X",
        lines: [
          { accountId: "a", amountCents: 100 },
          { accountId: "b", amountCents: -90 },
        ],
        frequency: null,
        nextDue: null,
      }),
    ).toMatch(/doesn't balance/);
  });
});

describe("templates and recurring drafts", () => {
  it("posting a due date twice makes one transaction, then it is no longer due", async () => {
    const { repos, orgId, cash, expense } = await setup();
    const { id } = await tpl.saveTemplate(repos, {
      orgId,
      userId: U,
      name: "Rent",
      description: "Monthly rent",
      lines: [
        { accountId: expense.id, amountCents: 50000 },
        { accountId: cash.id, amountCents: -50000 },
      ],
      frequency: "monthly",
      nextDue: "2026-09-01",
    });
    const due = await tpl.listDue(repos, orgId, "2026-10-05");
    expect(due.mode).toBe("drafts");
    expect(due.items.map((d) => d.dueDate)).toEqual(["2026-09-01", "2026-10-01"]);

    const [a, b] = await Promise.all([
      tpl.postDue(repos, { orgId, userId: U, templateId: id, dueDate: "2026-09-01" }),
      tpl.postDue(repos, { orgId, userId: U, templateId: id, dueDate: "2026-09-01" }),
    ]);
    expect(a.id).toBe(b.id);
    const txs = await repos.transactions.list(orgId, { includeVoid: true });
    expect(txs).toHaveLength(1);
    await tpl.skipDue(repos, { orgId, userId: U, templateId: id, dueDate: "2026-10-01" });
    expect((await tpl.listDue(repos, orgId, "2026-10-05")).items).toEqual([]);
    expect((await repos.templates.get(orgId, id))?.nextDue).toBe("2026-11-01");
    expect(await repos.transactions.list(orgId, { includeVoid: true })).toHaveLength(1);
  });

  it("nothing posts on its own and an unbalanced template saves nothing", async () => {
    const { repos, orgId, cash, expense } = await setup();
    await expect(
      tpl.saveTemplate(repos, {
        orgId,
        userId: U,
        name: "Bad",
        description: "Bad",
        lines: [
          { accountId: expense.id, amountCents: 100 },
          { accountId: cash.id, amountCents: -1 },
        ],
        frequency: "monthly",
        nextDue: "2026-01-01",
      }),
    ).rejects.toThrow(/Nothing was saved/);
    expect(await repos.templates.list(orgId)).toEqual([]);
  });

  it("the organization can switch to reminders", async () => {
    const { repos, orgId } = await setup();
    await tpl.setRecurringMode(repos, orgId, U, "reminder");
    expect((await tpl.listDue(repos, orgId, "2026-10-01")).mode).toBe("reminder");
  });
});

describe("search and filters", () => {
  const t = {
    transactionDate: "2026-10-02",
    description: "Office rent",
    status: "posted",
    source: "manual",
    entries: [
      { accountId: "exp", amountCents: 120000, memo: "October", projectId: "p1", reconciled: false },
      { accountId: "cash", amountCents: -120000, memo: null, reconciled: true },
    ],
  };
  it("matches text in description or note", () => {
    expect(matchesFilter(t, { q: "rent" })).toBe(true);
    expect(matchesFilter(t, { q: "october" })).toBe(true);
    expect(matchesFilter(t, { q: "payroll" })).toBe(false);
  });
  it("combines date, amount, project and statement filters", () => {
    expect(matchesFilter(t, { from: "2026-10-01", to: "2026-10-31", minCents: 100000 })).toBe(true);
    expect(matchesFilter(t, { maxCents: 100000 })).toBe(false);
    expect(matchesFilter(t, { projectId: "p2" })).toBe(false);
    expect(matchesFilter(t, { accountId: "cash", reconciled: "yes" })).toBe(true);
    expect(matchesFilter(t, { accountId: "exp", reconciled: "yes" })).toBe(false);
    expect(matchesFilter(t, { status: "void" })).toBe(false);
  });
});

describe("fund and project budgets", () => {
  it("keeps whole-org and project budgets apart and counts only that project's spending", async () => {
    const { repos, orgId, cash, expense } = await setup();
    const P = "11111111-1111-4111-8111-111111111111";
    repos.store.projects.set(P, { id: P, orgId, name: "Roof", budgetCents: 0, status: "active" });
    await repos.transactions.post({
      id: "22222222-2222-4222-8222-222222222222",
      orgId,
      transactionDate: "2026-03-01",
      postedDate: null,
      description: "Shingles",
      source: "manual",
      createdBy: U,
      idempotencyKey: null,
      entries: [
        { id: "e1", accountId: expense.id, amountCents: 7000, projectId: P },
        { id: "e2", accountId: cash.id, amountCents: -7000 },
      ],
    });
    const base = { orgId, userId: U, accountId: expense.id, periodType: "year" as const, periodStart: "2026-01-01" };
    await saveBudget(repos, { ...base, amountCents: 100000 });
    await saveBudget(repos, { ...base, projectId: P, amountCents: 10000 });
    await saveBudget(repos, { ...base, projectId: P, amountCents: 12000 });
    expect(repos.store.budgets.size).toBe(2);
    const whole = await budgetVsActual(repos, orgId, "year", "2026-01-01");
    const proj = await budgetVsActual(repos, orgId, "year", "2026-01-01", { projectId: P });
    const line = (r: typeof whole) => r.lines.find((l) => l.accountId === expense.id)!;
    expect(line(whole).budgetCents).toBe(100000);
    expect(line(proj)).toMatchObject({ budgetCents: 12000, actualCents: 7000 });
  });
});

describe("diagnostics and first-run checklist", () => {
  it("flags an unbalanced transaction and a line without an account", () => {
    const checks = runChecks({
      accounts: [{ id: "a" }],
      transactions: [
        { id: "t", status: "posted", source: "manual", entries: [{ accountId: "a", amountCents: 5 }, { accountId: "gone", amountCents: -4 }] },
      ],
      reconciliations: [{ status: "in_progress" }],
      booksLockedThrough: null,
    });
    const ok = Object.fromEntries(checks.map((c) => [c.key, c.ok]));
    expect(ok).toEqual({
      balanced_books: false,
      unbalanced_transactions: false,
      lines_without_account: false,
      open_statement_checks: false,
      books_locked: false,
    });
  });
  it("ticks off steps as the books fill in", async () => {
    const { repos, orgId, cash, expense } = await setup();
    let steps = await getSetupProgress(repos, orgId);
    expect(steps.find((s) => s.key === "first_tx")?.done).toBe(false);
    await callLocal(
      "createTransaction",
      {
        orgId,
        transactionDate: "2026-10-01",
        description: "Paper",
        source: "manual",
        entries: [
          { accountId: expense.id, amountCents: 100 },
          { accountId: cash.id, amountCents: -100 },
        ],
      },
      repos,
    );
    steps = await getSetupProgress(repos, orgId);
    expect(steps.find((s) => s.key === "first_tx")?.done).toBe(true);
    expect(steps.find((s) => s.key === "close")?.done).toBe(false);
  });
});
