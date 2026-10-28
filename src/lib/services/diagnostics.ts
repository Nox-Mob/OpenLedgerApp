// Diagnostics and first-run progress, read through the ports so cloud and desktop match.
import type { Id } from "@/lib/domain/models";
import type { Repositories } from "@/lib/ports";
import { runChecks, setupProgress, type DiagInput } from "@/lib/domain/diagnostics";

async function gather(repos: Repositories, orgId: Id): Promise<DiagInput> {
  const [org, accounts, transactions, reconciliations] = await Promise.all([
    repos.orgs.get(orgId),
    repos.accounts.list(orgId, { includeArchived: true }),
    repos.transactions.list(orgId, { includeVoid: true, limit: 100000 }),
    repos.reconciliations.list(orgId),
  ]);
  if (!org) throw new Error("Organization not found.");
  return {
    accounts,
    transactions: transactions.map((t) => ({
      id: t.id,
      status: t.status,
      source: t.source,
      entries: t.entries,
    })),
    reconciliations,
    booksLockedThrough: org.booksLockedThrough,
  };
}

export async function diagnostics(repos: Repositories, orgId: Id) {
  const d = await gather(repos, orgId);
  return {
    checks: runChecks(d),
    counts: {
      accounts: d.accounts.length,
      transactions: d.transactions.length,
      statementChecks: d.reconciliations.length,
    },
  };
}

export async function getSetupProgress(repos: Repositories, orgId: Id) {
  return setupProgress(await gather(repos, orgId));
}
