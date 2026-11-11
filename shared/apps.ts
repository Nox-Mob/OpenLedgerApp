// Suite app names, for shared UI. App IDs: SHARED-SPEC §2.
import type { AppId } from "./supabase/hosted";

export const APP_NAMES: Record<AppId, string> = {
  hub: "OpenAppHub",
  charter: "OpenCharterApp",
  board: "OpenBoardApp",
  ledger: "OpenLedgerApp",
};

export const APP_TAGLINES: Record<AppId, string> = {
  hub: "Account, organizations and billing",
  charter: "Members, chapters and dues",
  board: "Meetings, minutes and decisions",
  ledger: "Budgets and books",
};

export const APP_MARKS: Record<AppId, string> = { hub: "H", charter: "C", board: "B", ledger: "L" };

/**
 * Where an app opens for one organization: Charter's organization page, the other apps'
 * home page with `?org=` (they make it the current org, shared/supabase/org.ts takeOrgFromUrl).
 * The hub itself just opens; it reads the suite's org cookie. `base` is the app's origin.
 */
export function appOrgUrl(app: AppId, base: string, orgId: string | null | undefined): string {
  const root = base.replace(/\/+$/, "");
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) return root || "/";
  switch (app) {
    case "charter":
      return `${root}/orgs/${orgId}`;
    case "board":
      return `${root}/board?org=${orgId}`;
    case "ledger":
      return `${root}/ledger?org=${orgId}`;
    default:
      return root || "/";
  }
}
