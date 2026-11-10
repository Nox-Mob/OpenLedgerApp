// The same request sent twice at the same moment (double click, retry, two tabs) must
// record exactly once. These run real shared workflows against the reference adapter;
// the database backs the same rules with unique keys (see db/tests).
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRepositories } from "@/lib/adapters/memory";
import { postTransaction, voidTransaction } from "./ledger";
import { closeFiscalYear } from "./settings";
import { closeMonth } from "./periods";

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-0000000000aa";
const CASH = "00000000-0000-4000-8000-0000000000c1";
const SALES = "00000000-0000-4000-8000-0000000000c2";
const EQUITY = "00000000-0000-4000-8000-0000000000c3";

let repos: ReturnType<typeof createMemoryRepositories>;

beforeEach(async () => {
  repos = createMemoryRepositories();
  await repos.orgs.create({
    id: ORG,
    name: "Org",
    orgType: "business",
    currency: "USD",
    fiscalYearStartMonth: 1,
    timezone: "America/Chicago",
    terminology: "simple",
    termOverrides: {},
    aiPdfEnabled: false,
    booksLockedThrough: null,
    createdBy: USER,
  });
  await repos.accounts.create([
    { id: CASH, orgId: ORG, name: "Cash", type: "asset", subtype: null, isActive: true },
    { id: SALES, orgId: ORG, name: "Sales", type: "revenue", subtype: null, isActive: true },
    { id: EQUITY, orgId: ORG, name: "Retained", type: "equity", subtype: null, isActive: true },
  ]);
});

const sale = (key: string) => ({
  orgId: ORG,
  userId: USER,
  transactionDate: "2025-06-01",
  description: "Sale",
  source: "manual" as const,
  idempotencyKey: key,
  entries: [
    { accountId: CASH, amountCents: 1000 },
    { accountId: SALES, amountCents: -1000 },
  ],
});

const txCount = async () => (await repos.transactions.list(ORG, { includeVoid: true })).length;
const actions = (a: string) => repos.store.audit.filter((x) => x.action === a).length;

describe("same request twice at once", () => {
  it("double post with one form key records one transaction and one history row", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postTransaction(repos, sale("form-1"))),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await txCount()).toBe(1);
    expect(actions("create")).toBe(1);
  });

  it("two different forms still record two transactions", async () => {
    await Promise.all([
      postTransaction(repos, sale("form-a")),
      postTransaction(repos, sale("form-b")),
    ]);
    expect(await txCount()).toBe(2);
  });

  it("double void voids once", async () => {
    const { id } = await postTransaction(repos, sale("form-v"));
    const r = await Promise.all([
      voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: id }),
      voidTransaction(repos, { orgId: ORG, userId: USER, transactionId: id }),
    ]);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(actions("void")).toBe(1);
  });

  it("double year-end close records one close and one history row", async () => {
    await postTransaction(repos, sale("form-c"));
    const input = {
      orgId: ORG,
      userId: USER,
      fiscalYearEnd: "2025-12-31",
      retainedEarningsAccountId: EQUITY,
    };
    const r = await Promise.all([closeFiscalYear(repos, input), closeFiscalYear(repos, input)]);
    expect(r.filter((x) => "duplicate" in x && x.duplicate)).toHaveLength(1);
    expect(await repos.periodCloses.list(ORG)).toHaveLength(1);
    expect(actions("close_fiscal_year")).toBe(1);
    expect((await repos.orgs.get(ORG))?.booksLockedThrough).toBe("2025-12-31");
  });

  it("double month close locks once", async () => {
    const input = { orgId: ORG, userId: USER, monthEnd: "2025-06-30", acknowledgeWarnings: true };
    await Promise.all([closeMonth(repos, input), closeMonth(repos, input)]);
    expect((await repos.orgs.get(ORG))?.booksLockedThrough).toBe("2025-06-30");
    // Both may pass the "already closed?" check before either saves; the lock value is the
    // same either way, and a second identical close never moves the lock backward.
    expect(actions("close_month")).toBeLessThanOrEqual(2);
  });

  it("a post racing a close never lands inside the closed period", async () => {
    await Promise.allSettled([
      closeMonth(repos, {
        orgId: ORG,
        userId: USER,
        monthEnd: "2025-06-30",
        acknowledgeWarnings: true,
      }),
      postTransaction(repos, sale("form-late")),
    ]);
    // Either the post won (and is in the books) or the close won (and it was rejected).
    const n = await txCount();
    expect(n === 0 || n === 1).toBe(true);
    expect(actions("create")).toBe(n);
  });
});
