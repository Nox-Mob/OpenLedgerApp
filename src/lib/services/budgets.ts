// Budgets for the whole organization, one fund, or one project. Shared by cloud and desktop.
import type { Id, IsoDate } from "@/lib/domain/models";
import type { Repositories } from "@/lib/ports";
import { newId } from "@/lib/domain/ledger";
import { actualFromLedger, assertBudgetAmount, periodRange, type BudgetPeriod } from "@/lib/domain/budgets";

export interface BudgetScope {
  fundId?: Id | null | undefined;
  projectId?: Id | null | undefined;
}

export async function budgetVsActual(
  repos: Repositories,
  orgId: Id,
  periodType: BudgetPeriod,
  periodStart: IsoDate,
  scope: BudgetScope = {},
) {
  const fundId = scope.fundId ?? null;
  const projectId = scope.projectId ?? null;
  const { from, to } = periodRange(periodType, periodStart);
  const [accounts, budgets, rows] = await Promise.all([
    repos.accounts.list(orgId, { includeArchived: true }),
    repos.budgets.list(orgId, periodType, periodStart),
    repos.transactions.ledgerRows(orgId, { to }),
  ]);
  const sums = new Map<Id, number>();
  for (const r of rows) {
    if (r.transactionDate < from || r.transactionDate > to) continue;
    if (fundId && r.fundId !== fundId) continue;
    if (projectId && r.projectId !== projectId) continue;
    sums.set(r.accountId, (sums.get(r.accountId) ?? 0) + r.amountCents);
  }
  const budgetBy = new Map(
    budgets
      .filter((b) => b.fundId === fundId && b.projectId === projectId)
      .map((b) => [b.accountId, b.amountCents]),
  );
  const lines = accounts
    .filter((a) => a.type === "revenue" || a.type === "expense")
    .sort((a, b) => b.type.localeCompare(a.type) || a.name.localeCompare(b.name))
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      type: a.type as "revenue" | "expense",
      budgetCents: budgetBy.get(a.id) ?? null,
      actualCents: actualFromLedger(a.type, sums.get(a.id) ?? 0),
      isActive: a.isActive,
    }))
    .filter((l) => l.isActive || l.budgetCents !== null || l.actualCents !== 0);
  return { from, to, lines };
}

export async function saveBudget(
  repos: Repositories,
  input: {
    orgId: Id;
    userId: Id;
    accountId: Id;
    periodType: BudgetPeriod;
    periodStart: IsoDate;
    amountCents: number | null;
  } & BudgetScope,
) {
  if (input.amountCents !== null) assertBudgetAmount(input.amountCents);
  const [acct] = await repos.accounts.getMany(input.orgId, [input.accountId]);
  if (!acct || (acct.type !== "revenue" && acct.type !== "expense"))
    throw new Error("Budgets are only for money in and money out accounts. Nothing was saved.");
  const fundId = input.fundId ?? null;
  const projectId = input.projectId ?? null;
  await repos.budgets.set(
    {
      id: newId(),
      orgId: input.orgId,
      accountId: input.accountId,
      fundId,
      projectId,
      periodType: input.periodType,
      periodStart: input.periodStart,
      amountCents: input.amountCents,
    },
    {
      orgId: input.orgId,
      userId: input.userId,
      action: input.amountCents === null ? "budget.cleared" : "budget.set",
      entity: "budget",
      entityId: input.accountId,
      after: {
        account_id: input.accountId,
        fund_id: fundId,
        project_id: projectId,
        period_type: input.periodType,
        period_start: input.periodStart,
        amount_cents: input.amountCents,
      },
    },
  );
  return { ok: true };
}
