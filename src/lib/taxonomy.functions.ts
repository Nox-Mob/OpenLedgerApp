import { desktopAware } from "@/lib/desktop/bridge";
import { newId } from "./domain/ledger";
import { createSupabaseRepositories } from "./adapters/supabase";
import { postOpeningBalance } from "./services/ledger";
import { createCatalogItem, setCatalogActive } from "./services/catalog";
import { auditedWrite } from "./audited-write";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCan } from "./permissions";
import type { Db } from "./db";
import { nameField } from "./validation";
import { duplicateName } from "./domain/accounts";

/** Names are unique per organization, ignoring case and extra spaces. */
async function assertNameAvailable(
  supabase: Db,
  table: CrudTable | "accounts",
  orgId: string,
  name: string,
) {
  const { data, error } = await supabase.from(table).select("name").eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const dup = duplicateName(name, data ?? []);
  if (dup) throw new Error(dup);
}

const orgInput = z.object({ orgId: z.string().uuid(), includeArchived: z.boolean().optional() });

const listAccountsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("accounts")
      .select("id, name, type, subtype, is_active")
      .eq("org_id", data.orgId)
      .order("type")
      .order("name");
    if (!data.includeArchived) query = query.eq("is_active", true);
    const { data: accounts, error } = await query;
    if (error) throw new Error(error.message);

    const { data: entries, error: eError } = await context.supabase
      .from("entries")
      .select("account_id, amount_cents, transactions!inner(org_id, status)")
      .eq("transactions.org_id", data.orgId)
      .eq("transactions.status", "posted");
    if (eError) throw new Error(eError.message);

    const balances = new Map<string, number>();
    for (const e of entries ?? []) {
      balances.set(e.account_id, (balances.get(e.account_id) ?? 0) + e.amount_cents);
    }

    return (accounts ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      type: a.type as string,
      subtype: a.subtype as string | null,
      isActive: a.is_active as boolean,
      balanceCents: balances.get(a.id) ?? 0,
    }));
  });
export const listAccounts = desktopAware("listAccounts", listAccountsCloud);

const createAccountCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        name: nameField("Account name"),
        type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
        subtype: z.string().max(60).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_settings");
    await assertNameAvailable(context.supabase, "accounts", data.orgId, data.name);
    const id = newId();
    await auditedWrite(
      context.supabase,
      data.orgId,
      [
        {
          table: "accounts",
          op: "insert",
          values: { id, name: data.name.trim(), type: data.type, subtype: data.subtype ?? null },
        },
      ],
      {
        action: "create",
        entity: "account",
        entityId: id,
        after: { name: data.name, type: data.type },
      },
    );
    return { ok: true };
  });
export const createAccount = desktopAware("createAccount", createAccountCloud);

const setOpeningBalanceCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        accountId: z.string().uuid(),
        equityAccountId: z.string().uuid(),
        amountCents: z.number().int(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    return postOpeningBalance(createSupabaseRepositories(context.supabase), {
      ...data,
      userId: context.userId,
    });
  });
export const setOpeningBalance = desktopAware("setOpeningBalance", setOpeningBalanceCloud);

type CrudTable = "categories" | "tags" | "projects" | "funds";
type Kind = "category" | "tag" | "fund" | "project";

type CreateInput = {
  orgId: string;
  name: string;
  type?: "revenue" | "expense";
  isRestricted?: boolean;
  budgetCents?: number;
};

/** Create through the shared service, which returns `archived` when the name is taken by an archived item. */
async function createItem(context: { supabase: Db; userId: string }, kind: Kind, d: CreateInput) {
  await assertCan(context.supabase, context.userId, d.orgId, "write");
  return createCatalogItem(createSupabaseRepositories(context.supabase), {
    orgId: d.orgId,
    userId: context.userId,
    kind,
    name: d.name,
    categoryType: d.type,
    isRestricted: d.isRestricted,
    budgetCents: d.budgetCents,
  });
}

const baseCreate = z.object({ orgId: z.string().uuid(), name: nameField() });

const createCategoryCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    baseCreate.extend({ type: z.enum(["revenue", "expense"]).default("expense") }).parse(input),
  )
  .handler(async ({ data, context }) => createItem(context, "category", data));
const createTagCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => baseCreate.parse(input))
  .handler(async ({ data, context }) => createItem(context, "tag", data));
const createFundCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    baseCreate.extend({ isRestricted: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => createItem(context, "fund", data));
const createProjectCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    baseCreate.extend({ budgetCents: z.number().int().min(0).default(0) }).parse(input),
  )
  .handler(async ({ data, context }) => createItem(context, "project", data));

// Lists hide archived items unless asked, so pickers only offer what is in use.
const listCategoriesCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("categories").select("*").eq("org_id", data.orgId);
    if (!data.includeArchived) q = q.eq("is_active", true);
    const { data: rows, error } = await q.order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
const listTagsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("tags").select("*").eq("org_id", data.orgId);
    if (!data.includeArchived) q = q.eq("is_active", true);
    const { data: rows, error } = await q.order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
const listFundsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("funds").select("*").eq("org_id", data.orgId);
    if (!data.includeArchived) q = q.eq("is_active", true);
    const { data: rows, error } = await q.order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
const listProjectsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("projects").select("*").eq("org_id", data.orgId);
    if (!data.includeArchived) q = q.neq("status", "archived");
    const { data: rows, error } = await q.order("name");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({ ...r, is_active: r.status !== "archived" }));
  });

export const listCategories = desktopAware("listCategories", listCategoriesCloud);
export const createCategory = desktopAware("createCategory", createCategoryCloud);
export const listTags = desktopAware("listTags", listTagsCloud);
export const createTag = desktopAware("createTag", createTagCloud);
export const listProjects = desktopAware("listProjects", listProjectsCloud);
export const createProject = desktopAware("createProject", createProjectCloud);
export const listFunds = desktopAware("listFunds", listFundsCloud);
export const createFund = desktopAware("createFund", createFundCloud);

const setCatalogActiveCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        kind: z.enum(["category", "tag", "fund", "project"]),
        id: z.string().uuid(),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    return setCatalogActive(createSupabaseRepositories(context.supabase), {
      ...data,
      userId: context.userId,
    });
  });
export const setCatalogActiveFn = desktopAware("setCatalogActive", setCatalogActiveCloud);
