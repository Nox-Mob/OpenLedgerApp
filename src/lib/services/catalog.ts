// Categories, tags, funds and projects, written once against the repository ports so
// the cloud and desktop editions apply the same name and restriction rules.
import type { CatalogItem, CatalogKind, Id } from "@/lib/domain/models";
import type { Repositories } from "@/lib/ports";
import { newId } from "@/lib/domain/ledger";
import { duplicateName } from "@/lib/domain/accounts";

export interface CreateCatalogInput {
  orgId: Id;
  userId: Id;
  kind: CatalogKind;
  name: string;
  categoryType?: "revenue" | "expense" | undefined;
  isRestricted?: boolean | undefined;
  budgetCents?: number | undefined;
}

export async function createCatalogItem(repos: Repositories, input: CreateCatalogInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Enter a name. Nothing was saved.");
  const dup = duplicateName(name, await repos.catalog.list(input.orgId, input.kind));
  if (dup) throw new Error(dup);
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
