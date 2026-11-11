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

/** The `org` search parameter of a URL, when it's an organization id. */
export function orgFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("org") ?? "";
  return UUID.test(value) ? value.toLowerCase() : null;
}

/** A link that opens `url` in organization `orgId` (`?org=`, read by takeOrgFromUrl). */
export function withOrg(url: string, orgId: string): string {
  if (!UUID.test(orgId)) return url;
  const u = new URL(url, "http://placeholder.invalid");
  u.searchParams.set("org", orgId);
  return url.startsWith("http") ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Browser only: if the address has `?org=<id>` (a link from OpenAppHub), make it the
 * current org and remove it from the address. Returns the id, or null. Like the cookie,
 * it's only a preference: callers still check it against the user's memberships.
 */
export function takeOrgFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const orgId = orgFromSearch(window.location.search);
  if (!orgId) return null;
  setCurrentOrg(orgId);
  const u = new URL(window.location.href);
  u.searchParams.delete("org");
  window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}${u.hash}`);
  return orgId;
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

export type OrgPreferences = { timeZone: string; currency: string };
export const DEFAULT_ORG_PREFERENCES: OrgPreferences = { timeZone: "UTC", currency: "USD" };

/**
 * The org's time zone and currency (core 0004), for shared/format.ts. Falls back
 * to UTC / USD when the columns aren't there yet (an older core) or on any error.
 */
export async function getOrgPreferences(
  client: SupabaseClient,
  orgId: string,
): Promise<OrgPreferences> {
  try {
    const { data, error } = await client
      .from("organizations")
      .select("time_zone, currency")
      .eq("id", orgId)
      .maybeSingle();
    const row = data as { time_zone?: unknown; currency?: unknown } | null;
    if (error || !row) return DEFAULT_ORG_PREFERENCES;
    return {
      timeZone: typeof row.time_zone === "string" && row.time_zone ? row.time_zone : "UTC",
      currency: typeof row.currency === "string" && row.currency ? row.currency : "USD",
    };
  } catch {
    return DEFAULT_ORG_PREFERENCES;
  }
}
