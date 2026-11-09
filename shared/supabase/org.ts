// Current-organization helpers (SHARED-SPEC §4.1).
//
// The current org is the `oah_org` cookie. In hosted mode it's set on the suite
// domain, so switching org in one app switches it everywhere. The value is only
// a preference: it's always re-checked against the user's memberships, and an
// invalid or missing value falls back to the user's first org.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookieDomainFor } from "./hosted";

export const ORG_COOKIE = "oah_org";
const ONE_YEAR = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type MyOrg = { id: string; name: string; slug: string | null; role: OrgRole };

export function readOrgCookie(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)oah_org=([^;]*)/);
  const value = match?.[1] ? decodeURIComponent(match[1]) : "";
  return UUID.test(value) ? value.toLowerCase() : null;
}

export function orgCookieString(
  orgId: string,
  opts: { domain?: string | undefined; secure?: boolean } = {},
): string {
  if (!UUID.test(orgId)) throw new Error("Not an organization id");
  const parts = [`${ORG_COOKIE}=${orgId}`, "Path=/", `Max-Age=${ONE_YEAR}`, "SameSite=Lax"];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The org to show: the cookie's org if the user is a member of it, otherwise the
 * first org (alphabetical), otherwise null (the user has no org yet).
 */
export function resolveCurrentOrg<T extends { id: string; name: string }>(
  orgs: readonly T[],
  cookieValue: string | null,
): T | null {
  if (orgs.length === 0) return null;
  const fromCookie = cookieValue ? orgs.find((o) => o.id === cookieValue) : undefined;
  if (fromCookie) return fromCookie;
  return [...orgs].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}

/** Browser only: remember the chosen org (suite-wide in hosted mode). */
export function setCurrentOrg(orgId: string): void {
  if (typeof document === "undefined") return;
  document.cookie = orgCookieString(orgId, {
    domain: cookieDomainFor(location.hostname),
    secure: location.protocol === "https:",
  });
}

export function getCurrentOrgCookie(): string | null {
  if (typeof document === "undefined") return null;
  return readOrgCookie(document.cookie);
}

type MembershipRow = {
  role: OrgRole;
  organizations: { id: string; name: string; slug: string | null } | null;
};

/** The signed-in user's organizations and their role in each (RLS: own memberships). */
export async function listMyOrgs(client: SupabaseClient): Promise<MyOrg[]> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await client
    .from("memberships")
    .select("role, organizations(id, name, slug)")
    .eq("user_id", auth.user.id);
  if (error) throw error;
  return ((data ?? []) as unknown as MembershipRow[])
    .filter((r) => r.organizations)
    .map((r) => ({ ...r.organizations!, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
