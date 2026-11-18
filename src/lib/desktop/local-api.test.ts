import { describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/lib/adapters/memory";
import { callLocal, DesktopUnavailableError } from "@/lib/desktop/local-api";

type Acct = { id: string; name: string; type: string; balanceCents: number };

describe("desktop local data", () => {
  it("sets up books, posts, lists and reports without the cloud", async () => {
    const repos = createMemoryRepositories();
    const { id: orgId } = (await callLocal(
      "createOrganization",
      {
        name: "Corner Shop",
        orgType: "business",
        accountKeys: [],
        currency: "USD",
        fiscalYearStartMonth: 1,
        terminology: "simplest",
        timezone: "America/Chicago",
      },
      repos,
    )) as { id: string };
    const orgs = (await callLocal("getMyOrgs", {}, repos)) as { id: string; role: string }[];
    expect(orgs).toEqual([expect.objectContaining({ id: orgId, role: "admin" })]);

    const accounts = (await callLocal("listAccounts", { orgId }, repos)) as Acct[];
    const cash = accounts.find((a) => a.type === "asset")!;
    const income = accounts.find((a) => a.id !== cash.id)!;
    await callLocal(
      "createTransaction",
      {
        orgId,
        transactionDate: "2026-10-01",
        description: "Sale",
        source: "manual",
        entries: [
          { accountId: cash.id, amountCents: 2500 },
          { accountId: income.id, amountCents: -2500 },
        ],
        idempotencyKey: "desktop-test-1",
      },
      repos,
    );
    const txs = (await callLocal("listTransactions", { orgId }, repos)) as {
      description: string;
    }[];
    expect(txs.map((t) => t.description)).toEqual(["Sale"]);
    const after = (await callLocal("listAccounts", { orgId }, repos)) as Acct[];
    expect(after.find((a) => a.id === cash.id)?.balanceCents).toBe(2500);
  });

  it("rejects an unbalanced transaction and records nothing", async () => {
    const repos = createMemoryRepositories();
    const { id: orgId } = (await callLocal(
      "createOrganization",
      {
        name: "B",
        orgType: "business",
        accountKeys: [],
        currency: "USD",
        fiscalYearStartMonth: 1,
        terminology: "simplest",
        timezone: "UTC",
      },
      repos,
    )) as { id: string };
    const [a, b] = (await callLocal("listAccounts", { orgId }, repos)) as Acct[];
    await expect(
      callLocal(
        "createTransaction",
        {
          orgId,
          transactionDate: "2026-10-01",
          description: "Bad",
          source: "manual",
          entries: [
            { accountId: a!.id, amountCents: 100 },
            { accountId: b!.id, amountCents: -90 },
          ],
        },
        repos,
      ),
    ).rejects.toThrow();
    expect(await callLocal("listTransactions", { orgId }, repos)).toEqual([]);
  });

  it("features not stored locally say so instead of reaching the cloud", async () => {
    await expect(callLocal("createInvite", {}, createMemoryRepositories())).rejects.toBeInstanceOf(
      DesktopUnavailableError,
    );
  });
});
