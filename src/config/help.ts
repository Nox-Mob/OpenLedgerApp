// Docs pages linked from OpenLedgerApp (S-04, SHARED-SPEC §12.3). The shell's Help link opens
// the page for where you are; every path must exist on docs.openapphub.org.
import { docsUrl, type HelpMap } from "@shared/docs";

export const HELP = {
  home: "ledger/",
  overview: "ledger/start/overview/",
  transactions: "ledger/everyday/transactions/",
  bank: "ledger/everyday/import-and-reconcile/",
  nonprofit: "ledger/nonprofit/funds-and-budgets/",
  reports: "ledger/reports/reports-and-closing/",
  admin: "ledger/admin/users-security-exports/",
  troubleshooting: "ledger/help/troubleshooting/",
} satisfies HelpMap;

export type HelpKey = keyof typeof HELP;

// Longest prefix first.
const PAGES: [prefix: string, key: HelpKey][] = [
  ["/settings/members", "admin"],
  ["/settings/security", "admin"],
  ["/settings/exports", "admin"],
  ["/settings/history", "admin"],
  ["/settings/close", "reports"],
  ["/settings/diagnostics", "troubleshooting"],
  ["/settings", "overview"],
  ["/transactions", "transactions"],
  ["/templates", "transactions"],
  ["/import", "bank"],
  ["/reconcile", "bank"],
  ["/funds", "nonprofit"],
  ["/budgets", "nonprofit"],
  ["/pledges", "nonprofit"],
  ["/projects", "nonprofit"],
  ["/reports", "reports"],
  ["/accounts", "overview"],
  ["/onboarding", "overview"],
  ["/ledger", "overview"],
];

/** The help page for a location in the app. */
export function helpKeyFor(pathname: string): HelpKey {
  return (
    PAGES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ??
    "home"
  );
}

export function helpHrefFor(pathname: string): string {
  return docsUrl(HELP[helpKeyFor(pathname)]);
}
