// Categories, tags, funds and projects, written once against the repository ports so
// the cloud and desktop editions apply the same name and restriction rules.
import type { CatalogItem, CatalogKind, Id } from "@/lib/domain/models";
import type { Repositories } from "@/lib/ports";
import { newId } from "@/lib/domain/ledger";
import { duplicateNameMessage, sameName } from "@/lib/validation";
import { formatCents } from "@/lib/money";
import { fundSummary } from "./funds";

export interface CreateCatalogInput {
  orgId: Id;
  userId: Id;
  kind: CatalogKind;
  name: string;
  categoryType?: "revenue" | "expense" | undefined;
  isRestricted?: boolean | undefined;
  budgetCents?: number | undefined;
}

export const isArchived = (item: Pick<CatalogItem, "status">) => item.status === "archived";

/**
 * Saved, or the name belongs to an archived item. Names stay unique across active and
 * archived items, so the page offers to restore the archived one instead.
 */
export type CreateCatalogResult =
  { ok: true; id: Id } | { ok: false; archived: { id: Id; name: string; kind: CatalogKind } };

export async function createCatalogItem(
  repos: Repositories,
  input: CreateCatalogInput,
): Promise<CreateCatalogResult> {
  const name = input.name.trim();
  if (!name) throw new Error("Enter a name. Nothing was saved.");
  const match = (await repos.catalog.list(input.orgId, input.kind)).find((c) =>
    sameName(c.name, name),
  );
  if (match && isArchived(match))
    return { ok: false, archived: { id: match.id, name: match.name, kind: input.kind } };
  if (match) throw new Error(duplicateNameMessage(name));
  const budget = input.budgetCents ?? 0;
  if (!Number.isInteger(budget) || budget < 0) throw new Error("Budget can't be negative.");
  const item: CatalogItem = {
    id: newId(),
    orgId: input.orgId,
    kind: input.kind,
    name,
    categoryType: input.kind === "category" ? (input.categoryType ?? "expense") : null,
    isRestricted: input.kind === "fund" ? !!input.isRestricted : false,
    budgetCents: input.kind === "project" ? budget : 0,
    status: "active",
  };
  await repos.catalog.create(item, {
    orgId: input.orgId,
    userId: input.userId,
    action: "create",
    entity: input.kind,
    entityId: item.id,
    after: { name },
  });
  return { ok: true, id: item.id };
}

/** A fund's restriction can only change before any transaction uses it. */
export async function setFundRestricted(
  repos: Repositories,
  input: { orgId: Id; userId: Id; fundId: Id; isRestricted: boolean },
) {
  const funds = await repos.catalog.list(input.orgId, "fund");
  if (!funds.some((f) => f.id === input.fundId)) throw new Error("Fund not found.");
  const used = (await repos.transactions.ledgerRows(input.orgId)).some(
    (r) => r.fundId === input.fundId,
  );
  if (used)
    throw new Error("A fund with transactions cannot change restriction. Create a new fund.");
  await repos.catalog.setRestricted(input.orgId, input.fundId, input.isRestricted, {
    orgId: input.orgId,
    userId: input.userId,
    action: "update",
    entity: "fund",
    entityId: input.fundId,
    after: { isRestricted: input.isRestricted },
  });
  return { ok: true };
}

export async function fundInfos(repos: Repositories, orgId: Id) {
  return (await repos.catalog.list(orgId, "fund")).map((f) => ({
    id: f.id,
    name: f.name,
    isRestricted: f.isRestricted,
  }));
}

/**
 * Archive hides an item from pickers but keeps it on past records; restore brings it back.
 * A restricted fund with money left must be released first so restricted net assets
 * never sit in a fund nobody can see.
 */
export async function setCatalogActive(
  repos: Repositories,
  input: { orgId: Id; userId: Id; kind: CatalogKind; id: Id; active: boolean },
) {
  const item = (await repos.catalog.list(input.orgId, input.kind)).find((c) => c.id === input.id);
  if (!item) throw new Error("Not found. It may have been removed.");
  if (input.active === !isArchived(item)) return { ok: true };
  if (!input.active && input.kind === "fund" && item.isRestricted) {
    const { funds } = await fundSummary(repos, input.orgId, await fundInfos(repos, input.orgId));
    const left = funds.find((f) => f.id === input.id)?.remainingCents ?? 0;
    if (left !== 0)
      throw new Error(
        `${item.name} still holds ${formatCents(left)}. Release it before archiving the fund.`,
      );
  }
  await repos.catalog.setActive(input.orgId, input.kind, input.id, input.active, {
    orgId: input.orgId,
    userId: input.userId,
    action: input.active ? "restore" : "archive",
    entity: input.kind,
    entityId: input.id,
    after: { name: item.name, active: input.active },
  });
  return { ok: true };
}
