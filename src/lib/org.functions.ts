import { desktopAware } from "@/lib/desktop/bridge";
import type { Db } from "@/lib/db";
import { auditedWrite } from "./audited-write";
import { isValidTimeZone } from "./dates";
import { normalizeTerminology, cleanOverrides } from "./terminology";
const overridesSchema = z
  .record(z.string(), z.enum(["simplest", "simple", "accounting"]))
  .transform(cleanOverrides);
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { catalogFor, matchesCatalog, type OrgType } from "./account-catalog";
import { assertCan, type OrgRole } from "./permissions";
import {
  coreRoleFor,
  ENSURE_SETTINGS_OP,
  loadMembers,
  loadMyOrgs,
  type CoreRole,
} from "./core-org";
import { createSupabaseRepositories } from "./adapters/supabase";
import { newId } from "./domain/ledger";
import { updateOrganization as updateOrgSettings } from "./services/settings";
import { requireMfaBlocker } from "./domain/members";
import { deleteBlocker, NO_USAGE, type AccountUsage } from "./domain/accounts";

/** Non-ledger records that point at each account (entries are counted separately). */
async function accountUsage(supabase: Db, orgId: string) {
  const out = new Map<string, AccountUsage>();
  const bump = (id: string, k: keyof AccountUsage) => {
    const u = out.get(id) ?? { ...NO_USAGE };
    u[k] += 1;
    out.set(id, u);
  };
  const [bank, imports, recs, budgets] = await Promise.all([
    supabase.from("bank_transactions").select("account_id").eq("org_id", orgId),
    supabase.from("import_batches").select("account_id").eq("org_id", orgId),
    supabase.from("reconciliations").select("account_id").eq("org_id", orgId),
    supabase.from("budgets").select("account_id").eq("org_id", orgId),
  ]);
  for (const r of [bank, imports, recs, budgets]) if (r.error) throw new Error(r.error.message);
  for (const r of bank.data ?? []) bump(r.account_id, "bankRows");
  for (const r of imports.data ?? []) bump(r.account_id, "imports");
  for (const r of recs.data ?? []) bump(r.account_id, "reconciliations");
  for (const r of budgets.data ?? []) bump(r.account_id, "budgets");
  return out;
}

const getMyOrgsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgs = await loadMyOrgs(context.supabase, context.userId);
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      orgType: o.org_type,
      currency: o.currency,
      fiscalYearStartMonth: o.fiscal_year_start_month,
      timezone: o.timezone,
      terminology: normalizeTerminology(o.terminology),
      termOverrides: cleanOverrides(o.term_overrides),
      aiPdfEnabled: !!o.ai_pdf_enabled,
      requireMfa: !!o.require_mfa,
      role: o.role as string,
      configured: o.configured,
    }));
  });
export const getMyOrgs = desktopAware("getMyOrgs", getMyOrgsCloud);

const getMyProfileCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Name from the core profile; wording preferences are Ledger's own.
    const [{ data: profile }, { data: prefs }] = await Promise.all([
      context.supabase
        .schema("public")
        .from("profiles")
        .select("display_name")
        .eq("id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("user_preferences")
        .select("terminology, term_overrides")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);
    return {
      displayName: profile?.display_name ?? null,
      terminology: normalizeTerminology(prefs?.terminology),
      termOverrides: cleanOverrides(prefs?.term_overrides),
    };
  });
export const getMyProfile = desktopAware("getMyProfile", getMyProfileCloud);

const setMyTermOverridesCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ termOverrides: overridesSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_preferences")
      // cloud-only-write: per-user or service record, not organization books
      .upsert({ user_id: context.userId, term_overrides: data.termOverrides });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const setMyTermOverrides = desktopAware("setMyTermOverrides", setMyTermOverridesCloud);

async function requireOrgAdmin(supabase: Db, userId: string, orgId: string) {
  await assertCan(supabase, userId, orgId, "manage_settings");
}

const updateOrganizationCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        name: z.string().min(1).max(120),
        orgType: z.enum(["nonprofit", "business"]),
        currency: z.string().regex(/^[A-Z]{3}$/),
        fiscalYearStartMonth: z.number().int().min(1).max(12),
        timezone: z.string().max(64).refine(isValidTimeZone, "Unknown timezone"),
        terminology: z.enum(["simplest", "simple", "accounting"]),
        termOverrides: overridesSchema,
        aiPdfEnabled: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOrgAdmin(supabase, userId, data.orgId);
    return updateOrgSettings(createSupabaseRepositories(supabase), data.orgId, userId, {
      name: data.name,
      orgType: data.orgType,
      currency: data.currency,
      fiscalYearStartMonth: data.fiscalYearStartMonth,
      timezone: data.timezone,
      terminology: data.terminology,
      termOverrides: data.termOverrides as Record<string, string>,
      aiPdfEnabled: data.aiPdfEnabled,
    });
  });
export const updateOrganization = desktopAware("updateOrganization", updateOrganizationCloud);

const listOrgMembersCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Any member can see the member list (core directory plus the treasurer overlay).
    const members = await loadMembers(supabase, data.orgId);
    return members.map((m) => ({
      id: m.userId,
      userId: m.userId,
      role: m.role as string,
      displayName: m.displayName ?? m.email ?? null,
      isYou: m.userId === userId,
    }));
  });
export const listOrgMembers = desktopAware("listOrgMembers", listOrgMembersCloud);

const updateMemberRoleCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "treasurer", "member", "viewer"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCan(supabase, userId, data.orgId, "manage_members");
    if (data.userId === userId && data.role !== "admin") {
      throw new Error("You can't demote yourself. Ask another admin to do it.");
    }

    const members = await loadMembers(supabase, data.orgId);
    const target = members.find((m) => m.userId === data.userId);
    if (!target) throw new Error("That person isn't in this organization.");
    if (target.coreRole === "owner" && data.role !== "admin") {
      throw new Error(
        "The owner always has full access. Transfer ownership first to change their role.",
      );
    }

    // The Ledger role (core 0010: only here; their OpenAppHub role and the other apps stay as
    // they are; owners and admins only, enforced by the database), then Ledger's treasurer
    // overlay with its history entry.
    if (target.coreRole !== "owner") {
      const rpc = supabase.schema("public").rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{ error: { message: string } | null }>;
      const { error } = await rpc("set_app_role", {
        p_org: data.orgId,
        p_user: data.userId,
        p_app: "ledger",
        p_role: coreRoleFor(data.role as OrgRole),
      });
      if (error) throw new Error(error.message);
    }
    await auditedWrite(
      supabase,
      data.orgId,
      [
        data.role === "treasurer"
          ? {
              table: "member_roles",
              op: "insert",
              values: { user_id: data.userId, role: "treasurer" },
              conflict: "nothing",
            }
          : { table: "member_roles", op: "delete", match: { user_id: data.userId } },
      ],
      {
        action: "update",
        entity: "user_role",
        entityId: data.userId,
        before: { role: target.role },
        after: { role: data.role },
        kind: "system",
      },
    );

    return { ok: true };
  });
export const updateMemberRole = desktopAware("updateMemberRole", updateMemberRoleCloud);

const createOrganizationCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().min(1).max(120),
        orgType: z.enum(["nonprofit", "business"]),
        accountKeys: z.array(z.string().max(60)).max(100).optional(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
        fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
        timezone: z.string().max(64).refine(isValidTimeZone, "Unknown timezone").optional(),
        terminology: z.enum(["simplest", "simple", "accounting"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Core creates the organization and makes the caller its owner.
    const { data: orgId, error: orgError } = await supabase
      .schema("public")
      .rpc("create_organization", { p_name: data.name });
    if (orgError || !orgId)
      throw new Error(orgError?.message ?? "Couldn't create the organization.");
    const org = { id: orgId as string };
    const settingsRow = {
      org_type: data.orgType,
      ...(data.currency ? { currency: data.currency } : {}),
      ...(data.fiscalYearStartMonth ? { fiscal_year_start_month: data.fiscalYearStartMonth } : {}),
      ...(data.terminology ? { terminology: data.terminology } : {}),
      ...(data.timezone ? { timezone: data.timezone } : {}),
    };

    const keys = data.accountKeys ? new Set(data.accountKeys) : null;
    const accounts = catalogFor(data.orgType)
      .filter((c) => c.required || (keys ? keys.has(c.key) : c.defaultOn))
      .map((c) => ({
        id: newId(),
        name: c.name,
        type: c.type,
        subtype: c.subtype ?? null,
        org_id: org.id,
      }));
    // Settings, starter accounts and history are saved together.
    await auditedWrite(
      supabase,
      org.id,
      [
        { table: "org_settings", op: "insert", values: settingsRow },
        { table: "accounts", op: "insert", values: accounts },
      ],
      {
        action: "create",
        entity: "organization",
        entityId: org.id,
        after: { name: data.name, org_type: data.orgType },
      },
    );

    return { id: org.id as string };
  });
export const createOrganization = desktopAware("createOrganization", createOrganizationCloud);

/**
 * Sets up the books for an organization created in OpenAppHub (no Ledger settings
 * yet): its type, currency, year, wording and starter accounts. Owner or admin.
 */
const setUpOrganizationBooksCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        orgType: z.enum(["nonprofit", "business"]),
        accountKeys: z.array(z.string().max(60)).max(100).optional(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        fiscalYearStartMonth: z.number().int().min(1).max(12),
        timezone: z.string().max(64).refine(isValidTimeZone, "Unknown timezone"),
        terminology: z.enum(["simplest", "simple", "accounting"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOrgAdmin(supabase, userId, data.orgId);
    const { data: existing } = await supabase
      .from("org_settings")
      .select("org_id")
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (existing) throw new Error("This organization's books are already set up.");
    const keys = data.accountKeys ? new Set(data.accountKeys) : null;
    const accounts = catalogFor(data.orgType)
      .filter((c) => c.required || (keys ? keys.has(c.key) : c.defaultOn))
      .map((c) => ({ id: newId(), name: c.name, type: c.type, subtype: c.subtype ?? null }));
    await auditedWrite(
      supabase,
      data.orgId,
      [
        {
          table: "org_settings",
          op: "insert",
          values: {
            org_type: data.orgType,
            currency: data.currency,
            fiscal_year_start_month: data.fiscalYearStartMonth,
            timezone: data.timezone,
            terminology: data.terminology,
          },
        },
        { table: "accounts", op: "insert", values: accounts },
      ],
      {
        action: "setup",
        entity: "organization",
        entityId: data.orgId,
        after: { org_type: data.orgType, currency: data.currency },
      },
    );
    return { id: data.orgId };
  });
export const setUpOrganizationBooks = desktopAware(
  "setUpOrganizationBooks",
  setUpOrganizationBooksCloud,
);

// ---------- Account setup (which accounts the org uses) ----------

const getAccountSetupCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("id, name, type, subtype, is_active")
      .eq("org_id", data.orgId)
      .order("type")
      .order("name");
    if (error) throw new Error(error.message);
    const { data: used, error: uErr } = await supabase
      .from("entries")
      .select("account_id, transactions!inner(org_id)")
      .eq("transactions.org_id", data.orgId);
    if (uErr) throw new Error(uErr.message);
    const usage = await accountUsage(supabase, data.orgId);
    const counts = new Map<string, number>();
    for (const e of used ?? []) counts.set(e.account_id, (counts.get(e.account_id) ?? 0) + 1);
    return (accounts ?? []).map((a) => {
      const u = { ...(usage.get(a.id) ?? NO_USAGE), entries: counts.get(a.id) ?? 0 };
      return {
        id: a.id as string,
        name: a.name as string,
        type: a.type as string,
        subtype: (a.subtype ?? null) as string | null,
        isActive: a.is_active as boolean,
        entryCount: u.entries,
        deleteBlocker: deleteBlocker(u),
      };
    });
  });
export const getAccountSetup = desktopAware("getAccountSetup", getAccountSetupCloud);

const setAccountEnabledCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        catalogKey: z.string().max(60).optional(),
        accountId: z.string().uuid().optional(),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOrgAdmin(supabase, userId, data.orgId);

    const { data: org } = await supabase
      .from("org_settings")
      .select("org_type")
      .eq("org_id", data.orgId)
      .maybeSingle();
    const catalog = catalogFor((org?.org_type ?? "business") as OrgType);
    const item = data.catalogKey ? catalog.find((c) => c.key === data.catalogKey) : undefined;

    const { data: existing } = await supabase
      .from("accounts")
      .select("id, name, type, is_active")
      .eq("org_id", data.orgId);
    const target = data.accountId
      ? (existing ?? []).find((a) => a.id === data.accountId)
      : item
        ? (existing ?? []).find((a) => matchesCatalog(a, item))
        : undefined;

    if (data.enabled) {
      if (target) {
        if (target.is_active) return { ok: true };
        await auditedWrite(
          supabase,
          data.orgId,
          [
            {
              table: "accounts",
              op: "update",
              values: { is_active: true },
              match: { id: target.id },
            },
          ],
          {
            action: "reactivate",
            entity: "account",
            entityId: target.id,
            before: { is_active: false },
            after: { is_active: true },
          },
        );
        return { ok: true };
      }
      if (!item) throw new Error("Unknown account.");
      const accountId = newId();
      await auditedWrite(
        supabase,
        data.orgId,
        [
          {
            table: "accounts",
            op: "insert",
            values: {
              id: accountId,
              name: item.name,
              type: item.type,
              subtype: item.subtype ?? null,
            },
          },
        ],
        {
          action: "create",
          entity: "account",
          entityId: accountId,
          after: { name: item.name, type: item.type },
        },
      );
      return { ok: true };
    }

    if (!target) return { ok: true };
    if (item?.required) throw new Error(`${item.name} is required and can't be removed.`);
    if (!target.is_active) return { ok: true };
    await auditedWrite(
      supabase,
      data.orgId,
      [
        {
          table: "accounts",
          op: "update",
          values: { is_active: false },
          match: { id: target.id },
        },
      ],
      {
        action: "archive",
        entity: "account",
        entityId: target.id,
        before: { name: target.name, type: target.type, is_active: true },
        after: { is_active: false },
      },
    );
    return { ok: true };
  });
export const setAccountEnabled = desktopAware("setAccountEnabled", setAccountEnabledCloud);

/** Permanently removes an account that was never used. Anything with history is archived instead. */
const deleteUnusedAccountCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ orgId: z.string().uuid(), accountId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOrgAdmin(supabase, userId, data.orgId);
    const [{ data: acct, error }, { data: org }] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, type, subtype")
        .eq("org_id", data.orgId)
        .eq("id", data.accountId)
        .maybeSingle(),
      supabase.from("org_settings").select("org_type").eq("org_id", data.orgId).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    if (!acct) throw new Error("Account not found.");
    const { count, error: cErr } = await supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acct.id);
    if (cErr) throw new Error(cErr.message);
    const usage = {
      ...((await accountUsage(supabase, data.orgId)).get(acct.id) ?? NO_USAGE),
      entries: count ?? 0,
    };
    const required = catalogFor((org?.org_type ?? "business") as OrgType).some(
      (c) => c.required && matchesCatalog(acct, c),
    );
    const blocker = deleteBlocker(usage, { required });
    if (blocker) throw new Error(blocker);
    await auditedWrite(
      supabase,
      data.orgId,
      [{ table: "accounts", op: "delete", match: { id: acct.id }, minRows: 1 }],
      {
        action: "delete",
        entity: "account",
        entityId: acct.id,
        before: { name: acct.name, type: acct.type, subtype: acct.subtype },
      },
    );
    return { ok: true };
  });
export const deleteUnusedAccount = desktopAware("deleteUnusedAccount", deleteUnusedAccountCloud);

const setRequireMfaCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: z.string().uuid(), enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await requireOrgAdmin(supabase, userId, data.orgId);
    const blocker = requireMfaBlocker(data.enabled, (claims as { aal?: string }).aal);
    if (blocker) throw new Error(blocker);
    await auditedWrite(
      supabase,
      data.orgId,
      [
        ENSURE_SETTINGS_OP,
        {
          table: "org_settings",
          op: "update",
          values: { require_mfa: data.enabled },
          minRows: 1,
        },
      ],
      {
        action: data.enabled ? "require_mfa_on" : "require_mfa_off",
        entity: "organization",
        entityId: data.orgId,
        after: { requireMfa: data.enabled },
        kind: "system",
      },
    );
    return { ok: true };
  });
export const setRequireMfa = desktopAware("setRequireMfa", setRequireMfaCloud);
