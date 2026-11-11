import type { Db } from "@/lib/db";
import { loadRole } from "./core-org";
// Role authorization matrix — the single source of truth for who can do what.
// Server functions call assertCan() after requireSupabaseAuth; the database
// mirrors the same rules in RLS policies and triggers so nothing slips around.

export const ROLES = ["admin", "treasurer", "member", "viewer"] as const;
export type OrgRole = (typeof ROLES)[number];

export type OrgAction =
  | "read" // view books, reports, exports
  | "write" // post/void transactions, import, reconcile
  | "reopen_reconciliation"
  | "manage_settings" // org settings, account setup, archive accounts
  | "manage_members" // change member roles
  | "close_books"; // lock books, year-end close, unlock

/** Declarative capability table. Change permissions here only; tests pin every cell. */
export const CAPABILITIES: Readonly<Record<OrgAction, readonly OrgRole[]>> = {
  read: ["admin", "treasurer", "member", "viewer"],
  write: ["admin", "treasurer", "member"],
  reopen_reconciliation: ["admin", "treasurer"],
  manage_settings: ["admin"],
  manage_members: ["admin"],
  close_books: ["admin", "treasurer"],
};

/** What still works while billing makes Ledger read-only (S-05); the database refuses the rest. */
export const READ_ONLY_SAFE: readonly OrgAction[] = ["read"];

/** `can()`, and off for writes while the organization's plan makes Ledger read-only. */
export function canNow(
  role: string | null | undefined,
  action: OrgAction,
  readOnly: boolean,
): boolean {
  return can(role, action) && (!readOnly || READ_ONLY_SAFE.includes(action));
}

export function can(role: string | null | undefined, action: OrgAction): boolean {
  return !!role && (CAPABILITIES[action] as readonly string[]).includes(role);
}

export class MfaRequiredError extends Error {
  constructor() {
    super(
      "This organization requires two-step sign-in. Turn it on in Settings, Security, then sign in again.",
    );
    this.name = "MfaRequiredError";
  }
}

export class ForbiddenError extends Error {
  constructor(action: OrgAction) {
    super(`Your role doesn't allow this action (${action}). Ask an organization admin.`);
    this.name = "ForbiddenError";
  }
}

/** Look up the caller's role in an org and require it to allow `action`. */
export async function assertCan(
  supabase: Db,
  userId: string,
  orgId: string,
  action: OrgAction,
): Promise<OrgRole> {
  // Core role plus Ledger's treasurer overlay (core-org.ts).
  const { role, requireMfa } = await loadRole(supabase, userId, orgId);
  if (!can(role, action)) throw new ForbiddenError(action);
  // The database enforces this too; checking here gives a clear message instead of empty data.
  if (requireMfa) {
    const { data: ok } = await supabase.rpc("mfa_ok", { p_org: orgId });
    if (!ok) throw new MfaRequiredError();
  }
  return role as OrgRole;
}
