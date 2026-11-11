// Billing state for the BillingBanner (SHARED-SPEC §5, §6.2). The database is
// the guard; this only explains it. Apps read `public.get_org_billing`, which
// doesn't exist on self-hosted databases (no billing), so it's feature-detected:
// no function → null → no banner.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppId } from "./hosted";

export type BillingStatus =
  "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "expired";

export type OrgBilling = {
  plan_id: string | null;
  status: BillingStatus;
  apps: string[];
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/** Same rule as billing.org_has_app_access in the database. */
export function hasAppAccess(billing: OrgBilling, app: AppId, now: Date = new Date()): boolean {
  if (app === "hub") return true;
  if (billing.status === "trialing") {
    return !billing.trial_ends_at || new Date(billing.trial_ends_at) > now;
  }
  if (billing.status === "active" || billing.status === "past_due") {
    return billing.apps.includes(app);
  }
  return false;
}

/**
 * True when billing makes this app read-only for the organization: the database refuses its
 * writes (SHARED-SPEC §5), so the app switches its write controls off (S-05). No billing (null,
 * self-hosted) is never read-only. Reading and exporting always stay on.
 */
export function isReadOnly(
  billing: OrgBilling | null | undefined,
  app: AppId,
  now: Date = new Date(),
): boolean {
  return !!billing && !hasAppAccess(billing, app, now);
}

const DAY = 24 * 60 * 60 * 1000;

export function daysLeft(until: string | null, now: Date = new Date()): number | null {
  if (!until) return null;
  return Math.max(0, Math.ceil((new Date(until).getTime() - now.getTime()) / DAY));
}

export type BillingNotice = {
  tone: "info" | "warning" | "danger";
  message: string;
  action: string;
  readOnly: boolean;
};

/**
 * What the banner says for this org and app, or null for no banner (paid and
 * fine, or billing off). Words are kept short; the hub's /billing page explains.
 */
export function billingNotice(
  billing: OrgBilling | null,
  app: AppId,
  opts: { canManage: boolean; now?: Date } = { canManage: false },
): BillingNotice | null {
  if (!billing) return null;
  const now = opts.now ?? new Date();
  const access = hasAppAccess(billing, app, now);
  const action = opts.canManage ? "Choose a plan" : "See plans";

  if (!access) {
    const why =
      billing.status === "trialing" || billing.status === "expired"
        ? "The free trial has ended"
        : billing.status === "active" || billing.status === "past_due"
          ? "This app isn't in your organization's plan"
          : "Your organization's plan has ended";
    return {
      tone: "danger",
      readOnly: true,
      message: `${why}, so this app is read-only. Everything is still here and you can export it.`,
      action,
    };
  }
  if (billing.status === "trialing") {
    const days = daysLeft(billing.trial_ends_at, now);
    if (days === null) return null;
    return {
      tone: days <= 3 ? "warning" : "info",
      readOnly: false,
      message:
        days === 0
          ? "Your free trial ends today."
          : `Your free trial ends in ${days} ${days === 1 ? "day" : "days"}.`,
      action,
    };
  }
  if (billing.status === "past_due") {
    return {
      tone: "warning",
      readOnly: false,
      message:
        "We couldn't take the last payment. Update your payment details to keep full access.",
      action: opts.canManage ? "Update payment" : "See billing",
    };
  }
  if (billing.cancel_at_period_end && billing.current_period_end) {
    const days = daysLeft(billing.current_period_end, now);
    if (days !== null && days <= 14) {
      return {
        tone: "info",
        readOnly: false,
        message: `Your plan is cancelled and ends in ${days} ${days === 1 ? "day" : "days"}. After that, the apps become read-only.`,
        action: opts.canManage ? "Keep my plan" : "See billing",
      };
    }
  }
  return null;
}

/** `get_org_billing` if the database has billing, otherwise null (self-hosted). */
export async function getOrgBilling(
  client: SupabaseClient,
  orgId: string,
): Promise<OrgBilling | null> {
  const { data, error } = await client.rpc("get_org_billing", { p_org: orgId });
  if (error) {
    // PGRST202: function not found (no billing schema). 42883: undefined function.
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as OrgBilling | undefined) ?? null;
}
