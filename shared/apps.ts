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
