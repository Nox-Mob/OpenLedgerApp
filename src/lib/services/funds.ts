// Fund accounting workflows, written once against the repository ports.
import {
  assertPledgeSettlement,
  assertReleaseAllowed,
  computeFundBalances,
  netAssetsByRestriction,
  type FundInfo,
  pledgeOutstanding,
  type PledgeStatus,
} from "@/lib/domain/funds";
import { LedgerRuleError, newId } from "@/lib/domain/ledger";
import type { Id, IsoDate } from "@/lib/domain/models";
import type { Repositories } from "@/lib/ports";
import { postTransaction } from "./ledger";
import { computeFundActivity } from "@/lib/report-detail";

export async function fundSummary(repos: Repositories, orgId: Id, funds: FundInfo[]) {
  const rows = await repos.transactions.ledgerRows(orgId);
  return {
    funds: computeFundBalances(rows, funds),
    netAssets: netAssetsByRestriction(rows, funds),
  };
}

/** Fund activity for a period (opening, received, spent, released, closing). */
export async function fundActivity(
  repos: Repositories,
  orgId: Id,
  funds: FundInfo[],
  from: IsoDate,
  to: IsoDate,
) {
  const rows = await repos.transactions.ledgerRows(orgId, { to });
  return { from, to, funds: computeFundActivity(rows, funds, from, to) };
}

/** Net assets account used for releases: prefer one named "Net Assets", else first equity. */
async function netAssetsAccount(repos: Repositories, orgId: Id) {
  const equity = (await repos.accounts.list(orgId)).filter((a) => a.type === "equity");
  const acct = equity.find((a) => /net assets/i.test(a.name)) ?? equity[0];
  if (!acct) {
    throw new LedgerRuleError("equity_missing", "Turn on a Net Assets account in Account setup.");
  }
  return acct;
}

export async function releaseFund(
  repos: Repositories,
  input: {
    orgId: Id;
    userId: Id;
    fundId: Id;
    funds: FundInfo[];
    amountCents: number;
    date: IsoDate;
    note?: string | undefined;
    idempotencyKey: string;
  },
) {
  const { funds } = await fundSummary(repos, input.orgId, input.funds);
  const fund = funds.find((f) => f.id === input.fundId);
  assertReleaseAllowed(fund, input.amountCents);
  const acct = await netAssetsAccount(repos, input.orgId);
  // Both legs hit Net Assets, so total equity is unchanged; the fund tag records the release.
  return postTransaction(repos, {
    orgId: input.orgId,
    userId: input.userId,
    transactionDate: input.date,
    description: `Release from restriction: ${fund!.name}${input.note ? `. ${input.note}` : ""}`,
    source: "release",
    idempotencyKey: input.idempotencyKey,
    entries: [
      { accountId: acct.id, amountCents: input.amountCents, fundId: input.fundId },
      { accountId: acct.id, amountCents: -input.amountCents, fundId: null },
    ],
  });
}

export async function postPledge(
  repos: Repositories,
  input: {
    orgId: Id;
    userId: Id;
    receivableAccountId: Id;
    revenueAccountId: Id;
    fundId: Id | null;
    donorName: string;
    amountCents: number;
    date: IsoDate;
    idempotencyKey: string;
  },
) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new LedgerRuleError("amount_invalid", "Pledge amount must be greater than zero.");
  }
  return postTransaction(repos, {
    orgId: input.orgId,
    userId: input.userId,
    transactionDate: input.date,
    description: `Pledge from ${input.donorName}`,
    source: "pledge",
    idempotencyKey: input.idempotencyKey,
    entries: [
      { accountId: input.receivableAccountId, amountCents: input.amountCents },
      { accountId: input.revenueAccountId, amountCents: -input.amountCents, fundId: input.fundId },
    ],
  });
}

/** A payment moves money from Pledges Receivable into cash; a write-off reverses revenue. */
export async function settlePledge(
  repos: Repositories,
  input: {
    orgId: Id;
    userId: Id;
    kind: "payment" | "write_off";
    status: PledgeStatus;
    pledgeAmountCents: number;
    settledCents: number;
    amountCents: number;
    receivableAccountId: Id;
    /** Cash account for payments, the original revenue account for write-offs. */
    debitAccountId: Id;
    fundId: Id | null;
    donorName: string;
    date: IsoDate;
    idempotencyKey: string;
  },
) {
  assertPledgeSettlement(
    input.status,
    input.pledgeAmountCents,
    input.settledCents,
    input.amountCents,
  );
  return postTransaction(repos, {
    orgId: input.orgId,
    userId: input.userId,
    transactionDate: input.date,
    description:
      input.kind === "payment"
        ? `Pledge payment from ${input.donorName}`
        : `Pledge write-off: ${input.donorName}`,
    source: "pledge",
    idempotencyKey: input.idempotencyKey,
    entries: [
      {
        accountId: input.debitAccountId,
        amountCents: input.amountCents,
        fundId: input.kind === "write_off" ? input.fundId : null,
      },
      { accountId: input.receivableAccountId, amountCents: -input.amountCents },
    ],
  });
}

// ---------- Pledge records (ledger posting plus the pledge row) ----------

/** Finds Pledges Receivable, creating it the first time a pledge is recorded. */
export async function receivableAccount(repos: Repositories, orgId: Id) {
  const all = await repos.accounts.list(orgId, { includeArchived: true });
  const existing = all.find((a) => a.subtype === "pledges_receivable");
  if (existing) {
    if (!existing.isActive) {
      throw new Error("Pledges Receivable is archived. Turn it back on in Account setup.");
    }
    return existing.id;
  }
  const id = newId();
  await repos.accounts.create([
    { id, orgId, name: "Pledges Receivable", type: "asset", subtype: "pledges_receivable", isActive: true },
  ]);
  return id;
}

export async function listPledgeSummaries(repos: Repositories, orgId: Id) {
  const [pledges, payments, funds] = await Promise.all([
    repos.pledges.list(orgId),
    repos.pledges.payments(orgId),
    repos.catalog.list(orgId, "fund"),
  ]);
  const fundName = new Map(funds.map((f) => [f.id, f.name]));
  return pledges.map((p) => {
    const mine = payments.filter((x) => x.pledgeId === p.id);
    const paid = mine.filter((x) => x.kind === "payment").reduce((s, x) => s + x.amountCents, 0);
    const writtenOff = mine
      .filter((x) => x.kind === "write_off")
      .reduce((s, x) => s + x.amountCents, 0);
    return {
      id: p.id,
      donorName: p.donorName,
      fundName: p.fundId ? (fundName.get(p.fundId) ?? null) : null,
      amountCents: p.amountCents,
      paidCents: paid,
      writtenOffCents: writtenOff,
      outstandingCents: pledgeOutstanding(p.amountCents, paid + writtenOff),
      pledgeDate: p.pledgeDate,
      expectedDate: p.expectedDate,
      note: p.note,
      status: p.status,
    };
  });
}

export async function recordPledge(
  repos: Repositories,
  input: {
    orgId: Id;
    userId: Id;
    donorName: string;
    fundId: Id | null;
    revenueAccountId: Id;
    amountCents: number;
    pledgeDate: IsoDate;
    expectedDate: IsoDate | null;
    note: string | null;
    idempotencyKey: string;
  },
) {
  const donorName = input.donorName.trim();
  if (!donorName) throw new Error("Enter who made the pledge. Nothing was recorded.");
  const [rev] = await repos.accounts.getMany(input.orgId, [input.revenueAccountId]);
  if (!rev || rev.type !== "revenue") throw new Error("Choose an income account.");
  if (input.fundId && !(await repos.catalog.list(input.orgId, "fund")).some((f) => f.id === input.fundId))
    throw new Error("Fund not found.");
  const receivableAccountId = await receivableAccount(repos, input.orgId);
  const tx = await postPledge(repos, {
    orgId: input.orgId,
    userId: input.userId,
    receivableAccountId,
    revenueAccountId: input.revenueAccountId,
    fundId: input.fundId,
    donorName,
    amountCents: input.amountCents,
    date: input.pledgeDate,
    idempotencyKey: `pledge:${input.idempotencyKey}`,
  });
  if (tx.duplicate) {
    // A retry after the ledger posting saved but the pledge record didn't: finish it now.
    const done = (await repos.pledges.list(input.orgId)).find((p) => p.transactionId === tx.id);
    if (done) return { ok: true, id: done.id };
  }
  const id = newId();
  await repos.pledges.create(
    {
      id,
      orgId: input.orgId,
      donorName,
      fundId: input.fundId,
      amountCents: input.amountCents,
      pledgeDate: input.pledgeDate,
      expectedDate: input.expectedDate,
      note: input.note,
      transactionId: tx.id,
      status: "open",
      createdBy: input.userId,
    },
    {
      orgId: input.orgId,
      userId: input.userId,
      action: "create",
      entity: "pledge",
      entityId: id,
      after: { donorName, amountCents: input.amountCents },
    },
  );
  return { ok: true, id };
}

export async function recordPledgeSettlement(
  repos: Repositories,
  input: {
    orgId: Id;
    userId: Id;
    pledgeId: Id;
    kind: "payment" | "write_off";
    amountCents: number;
    cashAccountId: Id | null;
    date: IsoDate;
    idempotencyKey: string;
  },
) {
  const p = await repos.pledges.get(input.orgId, input.pledgeId);
  if (!p) throw new Error("Pledge not found.");
  const pays = (await repos.pledges.payments(input.orgId)).filter((x) => x.pledgeId === p.id);
  const settled = pays.reduce((s, x) => s + x.amountCents, 0);
  const receivableAccountId = await receivableAccount(repos, input.orgId);
  let debitAccountId: Id;
  if (input.kind === "payment") {
    if (!input.cashAccountId) throw new Error("Choose where the money went.");
    const [cash] = await repos.accounts.getMany(input.orgId, [input.cashAccountId]);
    if (!cash || cash.type !== "asset") throw new Error("Choose a bank or cash account.");
    debitAccountId = cash.id;
  } else {
    const orig = (await repos.transactions.get(input.orgId, p.transactionId))?.entries.find(
      (e) => e.amountCents < 0,
    );
    if (!orig) throw new Error("Original pledge entry not found.");
    debitAccountId = orig.accountId;
  }
  const tx = await settlePledge(repos, {
    orgId: input.orgId,
    userId: input.userId,
    kind: input.kind,
    status: p.status,
    pledgeAmountCents: p.amountCents,
    settledCents: settled,
    amountCents: input.amountCents,
    receivableAccountId,
    debitAccountId,
    fundId: p.fundId,
    donorName: p.donorName,
    date: input.date,
    idempotencyKey: `pledge-${input.kind}:${input.idempotencyKey}`,
  });
  if (tx.duplicate && pays.some((x) => x.transactionId === tx.id)) return { ok: true };
  const remaining = pledgeOutstanding(p.amountCents, settled + input.amountCents);
  const status = remaining === 0 ? (input.kind === "write_off" ? "written_off" : "paid") : null;
  await repos.pledges.addPayment(
    {
      id: newId(),
      orgId: input.orgId,
      pledgeId: p.id,
      transactionId: tx.id,
      kind: input.kind,
      amountCents: input.amountCents,
      paidDate: input.date,
    },
    status,
    {
      orgId: input.orgId,
      userId: input.userId,
      action: input.kind === "write_off" ? "write_off" : "payment",
      entity: "pledge",
      entityId: p.id,
      before: { status: p.status },
      after: { amountCents: input.amountCents, status: status ?? p.status },
    },
  );
  return { ok: true };
}
