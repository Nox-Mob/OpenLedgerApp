// Billing state under the top bar (SHARED-SPEC §5). The database enforces
// access; this explains it and links to the hub's billing page. Shows nothing
// when billing is off (self-hosted) or the plan is fine.
import type { AppId } from "../supabase/hosted";
import { billingNotice, type OrgBilling } from "../supabase/billing";
import { AlertIcon, InfoIcon } from "./icons";

const TONE = {
  info: "border-info/25 bg-info/8 [&_svg]:text-info",
  warning: "border-warning/30 bg-warning/10 [&_svg]:text-warning",
  danger: "border-destructive/30 bg-destructive/8 [&_svg]:text-destructive",
} as const;

export function BillingBanner({
  billing,
  app,
  canManage,
  billingHref,
  now,
}: {
  billing: OrgBilling | null | undefined;
  app: AppId;
  /** Owner/admin: can choose a plan. */
  canManage: boolean;
  /** Usually hubUrl("/billing"). */
  billingHref: string;
  now?: Date;
}) {
  const notice = billingNotice(billing ?? null, app, { canManage, ...(now ? { now } : {}) });
  if (!notice) return null;
  const Icon = notice.tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm text-foreground sm:items-center sm:px-6 ${TONE[notice.tone]}`}
    >
      <Icon className="mt-0.5 sm:mt-0" />
      <p className="min-w-0 flex-1">{notice.message}</p>
      <a href={billingHref} className="font-semibold underline-offset-4 hover:underline">
        {notice.action}
      </a>
    </div>
  );
}
