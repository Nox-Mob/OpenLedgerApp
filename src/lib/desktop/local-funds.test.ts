// Desktop parity: categories, tags, funds, projects and pledges are saved in the local
// file and follow the same rules as the cloud (unique names, locked restriction, pledges).
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import type { Repositories } from "@/lib/ports";
import { createMemoryRepositories } from "@/lib/adapters/memory";
import { createSqliteRepositories, migrateSqlite } from "@/lib/adapters/sqlite";
import { sqlJsDriver } from "@/lib/adapters/sqlite/sqljs-driver";
import { callLocal } from "@/lib/desktop/local-api";
import { newId } from "@/lib/domain/ledger";

const SQL = await initSqlJs();
const adapters: [string, () => Promise<Repositories>][] = [
  ["memory", async () => createMemoryRepositories()],
  [
    "sqlite",
    async () => {
      const d = sqlJsDriver(new SQL.Database());
      await migrateSqlite(d);
      return createSqliteRepositories(d);
    },
  ],
];

async function setup(repos: Repositories) {
  const { id: orgId } = (await callLocal(
    "createOrganization",
    {
      name: "Food Pantry",
      orgType: "nonprofit",
      accountKeys: [],
      currency: "USD",
      fiscalYearStartMonth: 1,
      terminology: "simplest",
      timezone: "America/Chicago",
    },
    repos,
  )) as { id: string };
  const cash = newId();
  const gifts = newId();
  const net = newId();
  await repos.accounts.create([
    { id: cash, orgId, name: "Checking", type: "asset", subtype: null, isActive: true },
    { id: gifts, orgId, name: "Donations", type: "revenue", subtype: null, isActive: true },
    { id: net, orgId, name: "Net Assets", type: "equity", subtype: null, isActive: true },
  ]);
  return { orgId, cash, gifts };
}

const call = <T>(repos: Repositories, name: string, data: unknown) =>
  callLocal(name, data, repos) as Promise<T>;

describe.each(adapters)("desktop funds and labels (%s)", (_name, make) => {
  it("saves categories, tags, funds and projects and rejects duplicate names", async () => {
    const repos = await make();
    const { orgId } = await setup(repos);
    await call(repos, "createCategory", { orgId, name: "Groceries", type: "expense" });
    await call(repos, "createTag", { orgId, name: "Grant 2026" });
    await call(repos, "createFund", { orgId, name: "Building Fund", isRestricted: true });
    await call(repos, "createProject", { orgId, name: "Summer Meals", budgetCents: 50000 });

    expect(await call(repos, "listCategories", { orgId })).toEqual([
      expect.objectContaining({ name: "Groceries", type: "expense" }),
    ]);
    expect(await call(repos, "listTags", { orgId })).toEqual([
      expect.objectContaining({ name: "Grant 2026" }),
    ]);
    expect(await call(repos, "listFunds", { orgId })).toEqual([
      expect.objectContaining({ name: "Building Fund", is_restricted: true }),
    ]);
    expect(await call(repos, "listProjects", { orgId })).toEqual([
      expect.objectContaining({ name: "Summer Meals", budget_cents: 50000 }),
    ]);
    await expect(
      call(repos, "createFund", { orgId, name: "  building   fund " }),
    ).rejects.toThrow();
    expect(await call<unknown[]>(repos, "listFunds", { orgId })).toHaveLength(1);
  });

  it("tags transactions with funds, filters by fund and locks restriction once used", async () => {
    const repos = await make();
    const { orgId, cash, gifts } = await setup(repos);
    await call(repos, "createFund", { orgId, name: "Building Fund", isRestricted: true });
    const [fund] = await call<{ id: string }[]>(repos, "listFunds", { orgId });
    await call(repos, "createTransaction", {
      orgId,
      transactionDate: "2026-10-01",
      description: "Gift for roof",
      source: "manual",
      idempotencyKey: "fund-gift-1",
      entries: [
        { accountId: cash, amountCents: 10000 },
        { accountId: gifts, amountCents: -10000, fundId: fund!.id },
      ],
    });
    const filtered = await call<{ description: string; entries: { fundName: string | null }[] }[]>(
      repos,
      "listTransactions",
      { orgId, filter: { fundId: fund!.id } },
    );
    expect(filtered.map((t) => t.description)).toEqual(["Gift for roof"]);
    expect(filtered[0]!.entries.some((e) => e.fundName === "Building Fund")).toBe(true);

    const summary = await call<{ funds: { remainingCents: number }[] }>(repos, "getFundSummary", {
      orgId,
    });
    expect(summary.funds[0]!.remainingCents).toBe(10000);
    await expect(
      call(repos, "setFundRestricted", { orgId, fundId: fund!.id, isRestricted: false }),
    ).rejects.toThrow(/cannot change restriction/);

    await call(repos, "releaseFromRestriction", {
      orgId,
      fundId: fund!.id,
      amountCents: 4000,
      date: "2026-10-05",
      idempotencyKey: "release-test-1",
    });
    const after = await call<{ funds: { remainingCents: number }[] }>(repos, "getFundSummary", {
      orgId,
    });
    expect(after.funds[0]!.remainingCents).toBe(6000);
  });

  it("records pledges and payments, and a retried payment counts once", async () => {
    const repos = await make();
    const { orgId, cash, gifts } = await setup(repos);
    await call(repos, "createPledge", {
      orgId,
      donorName: "Jordan Lee",
      fundId: null,
      revenueAccountId: gifts,
      amountCents: 30000,
      pledgeDate: "2026-10-01",
      expectedDate: null,
      note: null,
      idempotencyKey: "pledge-test-1",
    });
    const [pledge] = await call<{ id: string; outstandingCents: number }[]>(repos, "listPledges", {
      orgId,
    });
    expect(pledge!.outstandingCents).toBe(30000);
    const pay = {
      orgId,
      pledgeId: pledge!.id,
      kind: "payment",
      amountCents: 30000,
      cashAccountId: cash,
      date: "2026-10-10",
      idempotencyKey: "pay-test-1",
    };
    await call(repos, "settlePledgeFn", pay);
    await call(repos, "settlePledgeFn", pay);
    const [done] = await call<{ status: string; paidCents: number }[]>(repos, "listPledges", {
      orgId,
    });
    expect(done).toMatchObject({ status: "paid", paidCents: 30000 });
    const accts = await call<{ id: string; balanceCents: number }[]>(repos, "listAccounts", {
      orgId,
    });
    expect(accts.find((a) => a.id === cash)?.balanceCents).toBe(30000);
    await expect(
      call(repos, "settlePledgeFn", { ...pay, idempotencyKey: "pay-test-2" }),
    ).rejects.toThrow();
  });

  it("runs desktop actions one at a time, so two saves of the same name make one fund", async () => {
    const repos = await make();
    const { orgId } = await setup(repos);
    const results = await Promise.allSettled([
      call(repos, "createFund", { orgId, name: "Roof" }),
      call(repos, "createFund", { orgId, name: "roof" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(await call<unknown[]>(repos, "listFunds", { orgId })).toHaveLength(1);
  });
});
