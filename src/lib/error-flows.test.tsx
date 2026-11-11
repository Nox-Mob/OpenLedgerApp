// @vitest-environment jsdom
// Each common failure, run through the real bookkeeping steps the way a form does:
// the pop-up must appear exactly when the step is refused, never when it succeeds,
// and the stored books and history must be unchanged afterwards.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Toaster, toast } from "sonner";
import { createMemoryRepositories } from "@/lib/adapters/memory";
import { postTransaction } from "@/lib/services/ledger";
import { closeFiscalYear, setBooksLock } from "@/lib/services/settings";
import * as recon from "@/lib/services/reconciliation";
import { assertCan, type OrgAction } from "@/lib/permissions";
import type { Db } from "@/lib/db";
import { showError } from "./show-error";

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
  const a = (id: string, name: string, type: "asset" | "revenue" | "equity") => ({
    id,
    orgId: ORG,
    name,
    type,
    subtype: null,
    isActive: true,
  });
  await repos.accounts.create([
    a(CASH, "Cash", "asset"),
    a(SALES, "Sales", "revenue"),
    a(EQUITY, "Retained", "equity"),
  ]);
  render(<Toaster />);
});

afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
});

/** Same pattern every form uses: success pop-up, or a plain-language error pop-up. */
async function submit(step: () => Promise<unknown>) {
  try {
    await step();
    act(() => void toast.success("Saved"));
    return true;
  } catch (e) {
    act(() => showError(e, "Could not save"));
    return false;
  }
}

const sale = (date: string, credit = -1000) => ({
  orgId: ORG,
  userId: USER,
  transactionDate: date,
  description: "Sale",
  source: "manual" as const,
  entries: [
    { accountId: CASH, amountCents: 1000 },
    { accountId: SALES, amountCents: credit },
  ],
});

/** Snapshot of everything stored, to prove a refused step changed nothing. */
function snapshot() {
  const s = repos.store;
  return JSON.stringify({
    tx: [...s.transactions.values()],
    recs: [...s.reconciliations.values()],
    closes: [...s.periodCloses.values()],
    orgs: [...s.orgs.values()],
    bank: [...s.bank.values()],
    audit: s.audit,
  });
}

const noErrorPopUp = () =>
  expect(screen.queryByText(/^Not (saved|finished|allowed|restored)/)).toBeNull();

describe("unbalanced transaction", () => {
  it("shows the pop-up and records nothing", async () => {
    const before = snapshot();
    expect(await submit(() => postTransaction(repos, sale("2026-02-01", -900)))).toBe(false);
    expect(await screen.findByText("Not saved: the amounts don't balance")).toBeTruthy();
    expect(snapshot()).toBe(before);
    expect(repos.store.transactions.size).toBe(0);
    expect(repos.store.audit).toHaveLength(0);
  });

  it("a balanced one saves with no error pop-up", async () => {
    expect(await submit(() => postTransaction(repos, sale("2026-02-01")))).toBe(true);
    expect(await screen.findByText("Saved")).toBeTruthy();
    noErrorPopUp();
    expect(repos.store.transactions.size).toBe(1);
  });
});

describe("closed period", () => {
  beforeEach(async () => {
    await setBooksLock(repos, ORG, USER, "2026-09-30");
  });

  it("refuses a date on the lock date, records nothing", async () => {
    const before = snapshot();
    expect(await submit(() => postTransaction(repos, sale("2026-09-30")))).toBe(false);
    expect(await screen.findByText("Not saved: that date is in a closed period")).toBeTruthy();
    expect(await screen.findByText(/closed through 2026-09-30/)).toBeTruthy();
    expect(snapshot()).toBe(before);
    expect(repos.store.transactions.size).toBe(0);
  });

  it("the day after the lock saves with no error pop-up", async () => {
    expect(await submit(() => postTransaction(repos, sale("2026-10-01")))).toBe(true);
    noErrorPopUp();
    expect(repos.store.transactions.size).toBe(1);
  });
});

describe("statement check off", () => {
  async function start(endingCents: number) {
    await postTransaction(repos, sale("2026-02-01"));
    const { id } = await recon.startReconciliation(repos, {
      orgId: ORG,
      accountId: CASH,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      beginningBalanceCents: 0,
      endingBalanceCents: endingCents,
      mode: "simple",
      batchId: null,
      userId: USER,
    });
    return (await repos.reconciliations.locate(id))!;
  }

  it("refuses to finish, stays open, records nothing", async () => {
    const r = await start(999);
    const cash = [...repos.store.transactions.values()][0]!.entries.find(
      (e) => e.accountId === CASH,
    )!;
    await recon.setCleared(repos, r, [cash.id], true, USER);
    const before = snapshot();
    expect(await submit(() => recon.completeReconciliation(repos, r, USER))).toBe(false);
    expect(
      await screen.findByText("Not finished: the statement check doesn't match yet"),
    ).toBeTruthy();
    expect(snapshot()).toBe(before);
    expect((await repos.reconciliations.locate(r.id))?.status).toBe("in_progress");
  });

  it("finishes at zero with no error pop-up", async () => {
    const r = await start(1000);
    const cash = [...repos.store.transactions.values()][0]!.entries.find(
      (e) => e.accountId === CASH,
    )!;
    await recon.setCleared(repos, r, [cash.id], true, USER);
    expect(await submit(() => recon.completeReconciliation(repos, r, USER))).toBe(true);
    noErrorPopUp();
    expect((await repos.reconciliations.locate(r.id))?.status).toBe("completed");
  });
});

/** Minimal stand-in for the role lookup assertCan does (core role + treasurer overlay). */
function roleDb(role: string): Db {
  const core = role === "admin" ? "admin" : role === "viewer" ? "viewer" : "member";
  const rows: Record<string, unknown> = {
    memberships: { role: core },
    member_roles: role === "treasurer" ? { role: "treasurer" } : null,
    org_settings: { require_mfa: false },
  };
  const db = {
    schema: () => db,
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: rows[table] }) };
      return q;
    },
  };
  return db as unknown as Db;
}

async function closeAs(role: string, action: OrgAction = "close_books") {
  return submit(async () => {
    await assertCan(roleDb(role), USER, ORG, action);
    await closeFiscalYear(repos, {
      orgId: ORG,
      userId: USER,
      fiscalYearEnd: "2025-12-31",
      retainedEarningsAccountId: EQUITY,
    });
  });
}

describe("no permission", () => {
  for (const role of ["member", "viewer"]) {
    it(`${role} cannot close the year: pop-up, nothing recorded`, async () => {
      const before = snapshot();
      expect(await closeAs(role)).toBe(false);
      expect(await screen.findByText("Not allowed: your role can't do this")).toBeTruthy();
      expect(snapshot()).toBe(before);
      expect(repos.store.periodCloses.size).toBe(0);
    });
  }

  it("treasurer can close the year, no error pop-up", async () => {
    expect(await closeAs("treasurer")).toBe(true);
    noErrorPopUp();
    expect(repos.store.periodCloses.size).toBe(1);
    expect((await repos.orgs.get(ORG))?.booksLockedThrough).toBe("2025-12-31");
  });

  it("treasurer cannot change settings: pop-up, nothing recorded", async () => {
    const before = snapshot();
    expect(await submit(() => assertCan(roleDb("treasurer"), USER, ORG, "manage_settings"))).toBe(
      false,
    );
    expect(await screen.findByText("Not allowed: your role can't do this")).toBeTruthy();
    expect(snapshot()).toBe(before);
  });
});

it("pop-ups clear between tests", async () => {
  await waitFor(() => noErrorPopUp());
});
