// Desktop edition: the same calls the pages make to the cloud, answered from the local file
// through the shared services in src/lib/services/. One local person is the admin, so there
// is no sign-in and no permission check (assertCan is cloud-only).
import type { Id, IsoDate } from "@/lib/domain/models";
import type { Repositories } from "@/lib/ports";
import { LOCAL_USER_ID } from "@/lib/edition";
import { localRepos } from "@/lib/desktop/local-repos";
import { newId } from "@/lib/domain/ledger";
import { duplicateName, deleteBlocker, NO_USAGE } from "@/lib/domain/accounts";
import { catalogFor, matchesCatalog, type OrgType } from "@/lib/account-catalog";
import { normalizeTerminology } from "@/lib/terminology";
import * as ledger from "@/lib/services/ledger";
import * as reports from "@/lib/services/reports";
import * as settings from "@/lib/services/settings";
import * as periods from "@/lib/services/periods";
import * as recon from "@/lib/services/reconciliation";
import * as tpl from "@/lib/services/templates";
import * as budgets from "@/lib/services/budgets";
import * as catalog from "@/lib/services/catalog";
import * as funds from "@/lib/services/funds";
import { diagnostics, getSetupProgress } from "@/lib/services/diagnostics";
import { hasFilter, matchesFilter, type TxFilter } from "@/lib/domain/search";
import { createOrganizationWithAccounts } from "@/lib/services/organizations";

export class DesktopUnavailableError extends Error {
  constructor() {
    super("This feature isn't available in the desktop app yet. Nothing was recorded.");
    this.name = "DesktopUnavailableError";
  }
}

type Handler = (repos: Repositories, data: never) => Promise<unknown>;
const me = LOCAL_USER_ID;

type OrgIn = { orgId: Id };

async function catalogRows(
  repos: Repositories,
  d: OrgIn & { includeArchived?: boolean },
  kind: "category" | "tag" | "fund" | "project",
) {
  const rows = await repos.catalog.list(d.orgId, kind);
  return d.includeArchived ? rows : rows.filter((c) => !catalog.isArchived(c));
}

async function orgOf(repos: Repositories, orgId: Id) {
  const org = await repos.orgs.get(orgId);
  if (!org) throw new Error("Organization not found.");
  return org;
}

/** Entry counts plus statement checks per account (bank rows/imports/budgets are not tracked locally yet). */
async function usageByAccount(repos: Repositories, orgId: Id) {
  const [rows, recs] = await Promise.all([
    repos.transactions.ledgerRows(orgId),
    repos.reconciliations.list(orgId),
  ]);
  const entries = new Map<Id, number>();
  for (const r of rows) entries.set(r.accountId, (entries.get(r.accountId) ?? 0) + 1);
  const recCount = new Map<Id, number>();
  for (const r of recs) recCount.set(r.accountId, (recCount.get(r.accountId) ?? 0) + 1);
  return (id: Id) => ({
    ...NO_USAGE,
    entries: entries.get(id) ?? 0,
    reconciliations: recCount.get(id) ?? 0,
  });
}

const HANDLERS: Record<string, Handler> = {
  // ---------- Organizations ----------
  getMyOrgs: async (repos) =>
    (await repos.orgs.listForUser(me)).map((o) => ({
      ...o,
      terminology: normalizeTerminology(o.terminology),
      requireMfa: false,
      role: o.role as string,
    })),
  getMyProfile: async () => ({
    displayName: null,
    terminology: normalizeTerminology(undefined),
    termOverrides: {},
  }),
  getLegalStatus: async () => ({ missing: [] }),
  createOrganization: async (repos, d: Parameters<typeof createOrganizationWithAccounts>[2]) => ({
    id: await createOrganizationWithAccounts(repos, me, d),
  }),
  updateOrganization: async (
    repos,
    d: OrgIn & Parameters<typeof settings.updateOrganization>[3],
  ) => {
    const { orgId, ...patch } = d;
    return settings.updateOrganization(repos, orgId, me, patch);
  },
  getAccountSetup: async (repos, d: OrgIn) => {
    const usage = await usageByAccount(repos, d.orgId);
    return (await repos.accounts.list(d.orgId, { includeArchived: true })).map((a) => {
      const u = usage(a.id);
      return {
        id: a.id,
        name: a.name,
        type: a.type as string,
        subtype: a.subtype,
        isActive: a.isActive,
        entryCount: u.entries,
        deleteBlocker: deleteBlocker(u),
      };
    });
  },
  setAccountEnabled: async (
    repos,
    d: OrgIn & { catalogKey?: string; accountId?: Id; enabled: boolean },
  ) => {
    const org = await orgOf(repos, d.orgId);
    const item = d.catalogKey
      ? catalogFor(org.orgType as OrgType).find((c) => c.key === d.catalogKey)
      : undefined;
    const existing = await repos.accounts.list(d.orgId, { includeArchived: true });
    const target = d.accountId
      ? existing.find((a) => a.id === d.accountId)
      : item
        ? existing.find((a) => matchesCatalog(a, item))
        : undefined;
    if (d.enabled) {
      if (target) {
        if (!target.isActive) await repos.accounts.setActive(d.orgId, target.id, true);
        return { ok: true };
      }
      if (!item) throw new Error("Unknown account.");
      await repos.accounts.create([
        {
          id: newId(),
          orgId: d.orgId,
          name: item.name,
          type: item.type,
          subtype: item.subtype ?? null,
          isActive: true,
        },
      ]);
      return { ok: true };
    }
    if (!target) return { ok: true };
    if (item?.required) throw new Error(`${item.name} is required and can't be removed.`);
    if (target.isActive) await repos.accounts.setActive(d.orgId, target.id, false);
    return { ok: true };
  },
  // Local storage has no delete for accounts yet; archive is the safe alternative.
  deleteUnusedAccount: async () => {
    throw new DesktopUnavailableError();
  },

  // ---------- Accounts and setup lists ----------
  listAccounts: async (repos, d: OrgIn & { includeArchived?: boolean }) => {
    const [accounts, rows] = await Promise.all([
      repos.accounts.list(d.orgId, { includeArchived: !!d.includeArchived }),
      repos.transactions.ledgerRows(d.orgId),
    ]);
    const balances = new Map<Id, number>();
    for (const r of rows)
      balances.set(r.accountId, (balances.get(r.accountId) ?? 0) + r.amountCents);
    return accounts
      .slice()
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type as string,
        subtype: a.subtype,
        isActive: a.isActive,
        balanceCents: balances.get(a.id) ?? 0,
      }));
  },
  createAccount: async (
    repos,
    d: OrgIn & {
      name: string;
      type: "asset" | "liability" | "equity" | "revenue" | "expense";
      subtype?: string | null;
    },
  ) => {
    const dup = duplicateName(
      d.name,
      await repos.accounts.list(d.orgId, { includeArchived: true }),
    );
    if (dup) throw new Error(dup);
    await repos.accounts.create([
      {
        id: newId(),
        orgId: d.orgId,
        name: d.name.trim(),
        type: d.type,
        subtype: d.subtype ?? null,
        isActive: true,
      },
    ]);
    return { ok: true };
  },
  setOpeningBalance: async (
    repos,
    d: OrgIn & { accountId: Id; equityAccountId: Id; amountCents: number; date: IsoDate },
  ) => ledger.postOpeningBalance(repos, { ...d, userId: me }),
  // ---------- Categories, tags, funds and projects ----------
  // Rows use the same field names the cloud lists return, so pages need no desktop branch.
  listCategories: async (repos, d: OrgIn & { includeArchived?: boolean }) =>
    (await catalogRows(repos, d, "category")).map((c) => ({
      id: c.id,
      org_id: c.orgId,
      name: c.name,
      type: c.categoryType,
      is_active: c.status !== "archived",
    })),
  listTags: async (repos, d: OrgIn & { includeArchived?: boolean }) =>
    (await catalogRows(repos, d, "tag")).map((c) => ({
      id: c.id,
      org_id: c.orgId,
      name: c.name,
      is_active: c.status !== "archived",
    })),
  listFunds: async (repos, d: OrgIn & { includeArchived?: boolean }) =>
    (await catalogRows(repos, d, "fund")).map((c) => ({
      id: c.id,
      org_id: c.orgId,
      name: c.name,
      is_restricted: c.isRestricted,
      is_active: c.status !== "archived",
    })),
  listProjects: async (repos, d: OrgIn & { includeArchived?: boolean }) =>
    (await catalogRows(repos, d, "project")).map((p) => ({
      id: p.id,
      org_id: p.orgId,
      name: p.name,
      budget_cents: p.budgetCents,
      status: p.status,
      is_active: p.status !== "archived",
    })),
  setCatalogActive: async (
    repos,
    d: OrgIn & { kind: "category" | "tag" | "fund" | "project"; id: Id; active: boolean },
  ) => catalog.setCatalogActive(repos, { ...d, userId: me }),
  createCategory: async (repos, d: OrgIn & { name: string; type?: "revenue" | "expense" }) =>
    catalog.createCatalogItem(repos, { ...d, userId: me, kind: "category", categoryType: d.type }),
  createTag: async (repos, d: OrgIn & { name: string }) =>
    catalog.createCatalogItem(repos, { ...d, userId: me, kind: "tag" }),
  createFund: async (repos, d: OrgIn & { name: string; isRestricted?: boolean }) =>
    catalog.createCatalogItem(repos, { ...d, userId: me, kind: "fund" }),
  createProject: async (repos, d: OrgIn & { name: string; budgetCents?: number }) =>
    catalog.createCatalogItem(repos, { ...d, userId: me, kind: "project" }),

  // ---------- Funds and pledges ----------
  getFundSummary: async (repos, d: OrgIn) =>
    funds.fundSummary(repos, d.orgId, await catalog.fundInfos(repos, d.orgId)),
  getFundActivity: async (repos, d: OrgIn & { from: IsoDate; to: IsoDate }) =>
    funds.fundActivity(repos, d.orgId, await catalog.fundInfos(repos, d.orgId), d.from, d.to),
  setFundRestricted: async (repos, d: OrgIn & { fundId: Id; isRestricted: boolean }) =>
    catalog.setFundRestricted(repos, { ...d, userId: me }),
  releaseFromRestriction: async (
    repos,
    d: OrgIn & {
      fundId: Id;
      amountCents: number;
      date: IsoDate;
      note?: string;
      idempotencyKey: string;
    },
  ) =>
    funds.releaseFund(repos, {
      ...d,
      userId: me,
      funds: await catalog.fundInfos(repos, d.orgId),
      idempotencyKey: `release:${d.idempotencyKey}`,
    }),
  listPledges: async (repos, d: OrgIn) => funds.listPledgeSummaries(repos, d.orgId),
  createPledge: async (repos, d: Omit<Parameters<typeof funds.recordPledge>[1], "userId">) =>
    funds.recordPledge(repos, { ...d, userId: me }),
  settlePledgeFn: async (
    repos,
    d: Omit<Parameters<typeof funds.recordPledgeSettlement>[1], "userId">,
  ) => funds.recordPledgeSettlement(repos, { ...d, userId: me }),

  // ---------- Transactions ----------
  listTransactions: async (
    repos,
    d: OrgIn & { accountId?: Id; limit?: number; filter?: TxFilter },
  ) => {
    const f = d.filter ?? {};
    const accounts = new Map(
      (await repos.accounts.list(d.orgId, { includeArchived: true })).map((a) => [a.id, a]),
    );
    const projects = new Map((await repos.projects.list(d.orgId)).map((p) => [p.id, p.name]));
    const funds = new Map((await repos.catalog.list(d.orgId, "fund")).map((x) => [x.id, x.name]));
    const cats = new Map(
      (await repos.catalog.list(d.orgId, "category")).map((x) => [x.id, x.name]),
    );
    const txs = await repos.transactions.list(d.orgId, {
      ...(d.accountId ? { accountId: d.accountId } : {}),
      ...(f.from ? { from: f.from } : {}),
      ...(f.to ? { to: f.to } : {}),
      limit: hasFilter(f) ? 100000 : (d.limit ?? 100),
      includeVoid: true,
    });
    const rows = txs.map((t) => ({
      id: t.id,
      transactionDate: t.transactionDate,
      postedDate: t.postedDate,
      description: t.description,
      source: t.source as string,
      status: t.status as string,
      entries: t.entries.map((e) => ({
        id: e.id,
        accountId: e.accountId,
        accountName: accounts.get(e.accountId)?.name ?? "",
        accountType: (accounts.get(e.accountId)?.type ?? "") as string,
        amountCents: e.amountCents,
        memo: e.memo ?? null,
        categoryName: e.categoryId ? (cats.get(e.categoryId) ?? null) : null,
        projectName: e.projectId ? (projects.get(e.projectId) ?? null) : null,
        fundName: e.fundId ? (funds.get(e.fundId) ?? null) : null,
        projectId: e.projectId ?? null,
        fundId: e.fundId ?? null,
        reconciled: !!e.reconciliationId,
      })),
    }));
    return rows.filter((t) => matchesFilter(t, f)).slice(0, hasFilter(f) ? 500 : (d.limit ?? 100));
  },
  createTransaction: async (
    repos,
    d: Omit<ledger.PostTransactionInput, "userId"> & { idempotencyKey?: string | null },
  ) =>
    ledger.postTransaction(repos, { ...d, userId: me, idempotencyKey: d.idempotencyKey ?? null }),
  voidTransaction: async (repos, d: OrgIn & { transactionId: Id }) =>
    ledger.voidTransaction(repos, { ...d, userId: me }),

  // ---------- Bank rows ----------
  listBankTransactions: async (repos, d: OrgIn & { accountId?: Id }) => {
    const names = new Map(
      (await repos.accounts.list(d.orgId, { includeArchived: true })).map((a) => [a.id, a.name]),
    );
    return (await repos.bank.listUnmatched(d.orgId, d.accountId)).map((r) => ({
      id: r.id,
      date: r.bankDate,
      description: r.description,
      amountCents: r.amountCents,
      linkedTransactionId: r.transactionId,
      needsReview: r.needsReview,
      accountName: names.get(r.accountId) ?? "",
    }));
  },
  postBankTransaction: async (repos, d: Omit<Parameters<typeof ledger.postBankRow>[1], "userId">) =>
    ledger.postBankRow(repos, { ...d, userId: me }),

  // ---------- Reports ----------
  incomeStatement: async (repos, d: OrgIn & { from?: IsoDate; to?: IsoDate }) =>
    reports.incomeStatement(repos, d.orgId, d),
  balanceSheet: async (repos, d: OrgIn & { asOf?: IsoDate }) =>
    reports.balanceSheet(repos, d.orgId, d.asOf),
  trialBalance: async (repos, d: OrgIn & { asOf?: IsoDate }) =>
    reports.trialBalance(repos, d.orgId, d.asOf),
  projectSummary: async (repos, d: OrgIn) => reports.projectSummary(repos, d.orgId),
  cashHistory: async (repos, d: OrgIn & { days: number }) =>
    reports.cashHistory(repos, d.orgId, d.days),
  generalLedger: async (repos, d: Parameters<typeof reports.generalLedger>[2] & OrgIn) =>
    reports.generalLedger(repos, d.orgId, d),

  // ---------- Books lock, month and year close ----------
  getBooksStatus: async (repos, d: OrgIn) => ({
    role: "admin" as const,
    ...(await settings.getBooksStatus(repos, d.orgId)),
  }),
  setBooksLock: async (repos, d: OrgIn & { lockedThrough: IsoDate | null }) =>
    settings.setBooksLock(repos, d.orgId, me, d.lockedThrough),
  previewYearEndClose: async (repos, d: OrgIn & { fiscalYearEnd: IsoDate }) =>
    settings.previewYearEndClose(repos, d.orgId, d.fiscalYearEnd),
  closeFiscalYear: async (
    repos,
    d: OrgIn & { fiscalYearEnd: IsoDate; retainedEarningsAccountId: Id },
  ) =>
    settings.closeFiscalYear(repos, {
      orgId: d.orgId,
      userId: me,
      fiscalYearEnd: d.fiscalYearEnd,
      retainedEarningsAccountId: d.retainedEarningsAccountId,
    }),
  previewMonthClose: async (repos, d: OrgIn & { monthEnd: IsoDate }) =>
    periods.previewMonthClose(repos, d.orgId, d.monthEnd),
  closeMonth: async (repos, d: OrgIn & { monthEnd: IsoDate; acknowledgeWarnings: boolean }) =>
    periods.closeMonth(repos, { ...d, userId: me }),
  reopenBooks: async (repos, d: OrgIn & { reopenThrough: IsoDate | null; reason: string }) =>
    periods.reopenPeriod(repos, { ...d, userId: me }),

  // ---------- Statement checks ----------
  listReconciliations: async (repos, d: OrgIn) => recon.listReconciliations(repos, d.orgId),
  suggestReconciliation: async (repos, d: OrgIn & { accountId: Id }) =>
    recon.suggestReconciliation(repos, d.orgId, d.accountId),
  startReconciliation: async (
    repos,
    d: Omit<Parameters<typeof recon.startReconciliation>[1], "userId" | "batchId"> & {
      batchId?: Id | null;
    },
  ) => recon.startReconciliation(repos, { ...d, batchId: d.batchId ?? null, userId: me }),
  getReconciliation: async (repos, d: { id: Id }) =>
    recon.getReconciliation(repos, await recon.locateReconciliation(repos, d.id)),
  setCleared: async (repos, d: { id: Id; entryIds: Id[]; cleared: boolean }) =>
    recon.setCleared(
      repos,
      await recon.locateReconciliation(repos, d.id),
      d.entryIds,
      d.cleared,
      me,
    ),
  acceptMatches: async (repos, d: { id: Id }) =>
    recon.acceptMatches(repos, await recon.locateReconciliation(repos, d.id), me),
  completeReconciliation: async (repos, d: { id: Id }) =>
    recon.completeReconciliation(repos, await recon.locateReconciliation(repos, d.id), me),
  reopenReconciliation: async (repos, d: { id: Id }) =>
    recon.reopenReconciliation(repos, await recon.locateReconciliation(repos, d.id), me),
  discardReconciliation: async (repos, d: { id: Id }) =>
    recon.discardReconciliation(repos, await recon.locateReconciliation(repos, d.id), me),

  // ---------- Templates and recurring drafts ----------
  listTemplates: async (repos, d: OrgIn) => repos.templates.list(d.orgId),
  saveTemplate: async (repos, d: Omit<tpl.SaveTemplateInput, "userId">) =>
    tpl.saveTemplate(repos, { ...d, userId: me }),
  archiveTemplate: async (repos, d: OrgIn & { id: Id }) =>
    tpl.archiveTemplate(repos, d.orgId, me, d.id),
  listDue: async (repos, d: OrgIn & { today: IsoDate }) => tpl.listDue(repos, d.orgId, d.today),
  postDue: async (repos, d: OrgIn & { templateId: Id; dueDate: IsoDate }) =>
    tpl.postDue(repos, { ...d, userId: me }),
  skipDue: async (repos, d: OrgIn & { templateId: Id; dueDate: IsoDate }) =>
    tpl.skipDue(repos, { ...d, userId: me }),
  setRecurringMode: async (repos, d: OrgIn & { mode: "drafts" | "reminder" }) =>
    tpl.setRecurringMode(repos, d.orgId, me, d.mode),

  // ---------- Budgets ----------
  budgetVsActual: async (
    repos,
    d: OrgIn & budgets.BudgetScope & { periodType: "year" | "month"; periodStart: IsoDate },
  ) => budgets.budgetVsActual(repos, d.orgId, d.periodType, d.periodStart, d),
  saveBudget: async (repos, d: Omit<Parameters<typeof budgets.saveBudget>[1], "userId">) =>
    budgets.saveBudget(repos, { ...d, userId: me }),

  // ---------- Diagnostics and first-run checklist ----------
  getDiagnostics: async (repos, d: OrgIn) => diagnostics(repos, d.orgId),
  getSetupProgress: async (repos, d: OrgIn) => getSetupProgress(repos, d.orgId),
};

/** Names answered locally; everything else reports "not available on desktop yet". */
export const LOCAL_FUNCTIONS = Object.keys(HANDLERS);

// The local file has one connection, so a transaction started by one action must not
// see statements from another. Actions run one at a time, in the order they were made.
let queue: Promise<unknown> = Promise.resolve();

export function callLocal(name: string, data: unknown, repos?: Repositories) {
  const handler = HANDLERS[name];
  if (!handler) return Promise.reject(new DesktopUnavailableError());
  const run = queue.then(async () => handler(repos ?? (await localRepos()), (data ?? {}) as never));
  queue = run.catch(() => undefined);
  return run;
}
