import { useEffect, useState } from "react";
import { getCurrentOrgCookie, setCurrentOrg } from "../../shared/supabase/org";

// The current organization is the suite's `oah_org` cookie (SHARED-SPEC §4.1): set on
// .openapphub.org when hosted, so choosing an organization in any app chooses it in
// all of them. It's only a preference, re-checked against the user's memberships
// (pickCurrentOrg). Local storage is kept as well for the desktop app, which has no
// suite cookie, and so earlier choices carry over.
const KEY = "openledger_current_org";

function readLocal(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getStoredOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return getCurrentOrgCookie() ?? readLocal();
}

export function setStoredOrgId(orgId: string) {
  try {
    setCurrentOrg(orgId);
  } catch {
    // Not an organization id (the desktop app's local ids): local storage only.
  }
  try {
    window.localStorage.setItem(KEY, orgId);
  } catch {
    // Private mode: the cookie still holds the choice.
  }
  window.dispatchEvent(new Event("openledger:org-changed"));
}

export function useCurrentOrgId(): string | null {
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setOrgId(getStoredOrgId());
    read();
    window.addEventListener("openledger:org-changed", read);
    return () => window.removeEventListener("openledger:org-changed", read);
  }, []);
  return orgId;
}

/** The organization to show: the stored choice if the user still belongs to it, else the first (alphabetical). */
export function pickCurrentOrg<T extends { id: string }>(
  orgs: T[],
  storedId: string | null,
): T | null {
  return orgs.find((o) => o.id === storedId) ?? orgs[0] ?? null;
}

export function roleLabel(role: string): string {
  if (role === "admin") return "Admin";
  if (role === "treasurer") return "Treasurer";
  if (role === "member") return "Member";
  if (role === "viewer") return "View only";
  return role;
}
