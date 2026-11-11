// Ledger on the OpenAppHub core (SHARED-SPEC §3.5, MIGRATION-NOTES §4.2).
//
// Organizations, memberships, profiles and invitations are core tables in schema
// `public`; Ledger keeps its own settings (ledger.org_settings, a missing row means
// the defaults below) and the treasurer overlay (ledger.member_roles). This module
// turns those into what the app has always used: one organization object and one
// Ledger role per person ("admin", "treasurer", "member", "viewer").
import type { Db } from "@/lib/db";
import type { OrgRole } from "./permissions";

export type CoreRole = "owner" | "admin" | "member" | "viewer";

/** Ledger's role from the core role and the treasurer overlay. */
export function ledgerRole(core: CoreRole | null | undefined, treasurer: boolean): OrgRole | null {
  if (!core) return null;
  if (core === "owner" || core === "admin") return "admin";
  if (core === "member") return treasurer ? "treasurer" : "member";
  return "viewer";
}

/** The core role to store for a Ledger role (treasurer is a member plus the overlay). */
export function coreRoleFor(role: OrgRole): Exclude<CoreRole, "owner"> {
  return role === "admin" ? "admin" : role === "viewer" ? "viewer" : "member";
}

export type OrgSettingsRow = {
  org_type: "nonprofit" | "business";
  currency: string;
  fiscal_year_start_month: number;
  terminology: string;
  term_overrides: unknown;
  timezone: string;
  ai_pdf_enabled: boolean;
  books_locked_through: string | null;
  require_mfa: boolean;
  recurring_mode: string;
};

/** ledger.org_settings column defaults (0001_ledger_baseline.sql). */
export const SETTINGS_DEFAULTS: OrgSettingsRow = {
  org_type: "business",
  currency: "USD",
  fiscal_year_start_month: 1,
  terminology: "simplest",
  term_overrides: {},
  timezone: "America/Chicago",
  ai_pdf_enabled: false,
  books_locked_through: null,
  require_mfa: false,
  recurring_mode: "drafts",
};

const SETTINGS_COLUMNS =
  "org_id, org_type, currency, fiscal_year_start_month, terminology, term_overrides, timezone, ai_pdf_enabled, books_locked_through, require_mfa, recurring_mode";

/** An organization as the app has always seen it: core name and id plus Ledger's settings. */
export type LedgerOrgRow = OrgSettingsRow & { id: string; name: string; created_at: string };

function merge(
  org: { id: string; name: string; created_at: string },
  s: Partial<OrgSettingsRow> | undefined,
): LedgerOrgRow {
  const out = { ...SETTINGS_DEFAULTS, ...org } as LedgerOrgRow;
  if (s) {
    for (const [k, v] of Object.entries(s)) {
      if (k !== "org_id" && v !== null && v !== undefined)
        (out as unknown as Record<string, unknown>)[k] = v;
    }
    out.books_locked_through = s.books_locked_through ?? null;
  }
  return out;
}

async function settingsFor(sb: Db, orgIds: string[]) {
  if (orgIds.length === 0) return new Map<string, Partial<OrgSettingsRow>>();
  const { data, error } = await sb
    .from("org_settings")
    .select(SETTINGS_COLUMNS)
    .in("org_id", orgIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.org_id, r as Partial<OrgSettingsRow>]));
}

/** One organization with its settings, or null when the caller can't see it. */
export async function loadOrg(sb: Db, orgId: string): Promise<LedgerOrgRow | null> {
  const { data: org, error } = await sb
    .schema("public")
    .from("organizations")
    .select("id, name, created_at")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!org) return null;
  return merge(org, (await settingsFor(sb, [orgId])).get(orgId));
}

/** The caller's organizations with their Ledger role, alphabetical. */
export async function loadMyOrgs(
  sb: Db,
  userId: string,
): Promise<(LedgerOrgRow & { role: OrgRole; configured: boolean })[]> {
  const { data, error } = await sb
    .schema("public")
    .from("memberships")
    .select("role, organizations(id, name, created_at)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((r) => r.organizations);
  const ids = rows.map((r) => r.organizations!.id);
  const [settings, overlay] = await Promise.all([
    settingsFor(sb, ids),
    ids.length
      ? sb.from("member_roles").select("org_id, role").eq("user_id", userId).in("org_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (overlay.error) throw new Error(overlay.error.message);
  const treasurerIn = new Set(
    (overlay.data ?? []).filter((r) => r.role === "treasurer").map((r) => r.org_id),
  );
  return rows
    .map((r) => {
      const org = r.organizations!;
      return {
        ...merge(org, settings.get(org.id)),
        role: ledgerRole(r.role as CoreRole, treasurerIn.has(org.id))!,
        // False for an organization made in the hub that hasn't set up its books yet.
        configured: settings.has(org.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The caller's Ledger role in one org and whether the org asks for two-step sign-in. */
export async function loadRole(
  sb: Db,
  userId: string,
  orgId: string,
): Promise<{ role: OrgRole | null; requireMfa: boolean }> {
  const [m, t, s] = await Promise.all([
    sb
      .schema("public")
      .from("memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle(),
    sb.from("member_roles").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle(),
    sb.from("org_settings").select("require_mfa").eq("org_id", orgId).maybeSingle(),
  ]);
  return {
    role: ledgerRole(m.data?.role as CoreRole | undefined, t.data?.role === "treasurer"),
    requireMfa: !!s.data?.require_mfa,
  };
}

/** Everyone in an org with their Ledger role and name (core directory + overlay). */
export async function loadMembers(sb: Db, orgId: string) {
  const [dir, overlay] = await Promise.all([
    sb.schema("public").rpc("org_member_directory", { p_org: orgId }),
    sb.from("member_roles").select("user_id, role").eq("org_id", orgId),
  ]);
  if (dir.error) throw new Error(dir.error.message);
  const treasurers = new Set(
    (overlay.data ?? []).filter((r) => r.role === "treasurer").map((r) => r.user_id),
  );
  return (dir.data ?? []).map((r) => ({
    userId: r.user_id,
    coreRole: r.role as CoreRole,
    role: ledgerRole(r.role as CoreRole, treasurers.has(r.user_id))!,
    displayName: r.display_name,
    email: r.email,
  }));
}

/**
 * The write op that makes sure an org has its settings row before an update
 * (organizations made in the hub start without one). Put it first in an
 * audited_write batch.
 */
export const ENSURE_SETTINGS_OP = {
  table: "org_settings",
  op: "insert" as const,
  values: {},
  conflict: "nothing" as const,
};
