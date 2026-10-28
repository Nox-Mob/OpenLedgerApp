import { errorMessage } from "@/lib/errors";
import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { listAccounts } from "@/lib/taxonomy.functions";
import { listTransactions } from "@/lib/transactions.functions";
import { incomeStatement } from "@/lib/reports.functions";
import { CashChart } from "@/components/CashChart";
import { DueDrafts, SetupChecklist } from "@/components/DashboardCards";
import { setStoredOrgId } from "@/lib/current-org";
import { formatCents, todayISO } from "@/lib/money";
import { displayBalance } from "@/lib/terminology";
import { PlusCircle, ArrowUpRight, ArrowDownRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ledger")({
  head: () => ({
    meta: [
      { title: "Dashboard - OpenLedgerApp" },
      { name: "description", content: "Your organization's money at a glance." },
      { property: "og:title", content: "Dashboard - OpenLedgerApp" },
      { property: "og:description", content: "Your organization's money at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { org, orgs, terms, isLoading } = useOrgContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && orgs.length === 0) navigate({ to: "/onboarding" });
    if (!isLoading && org) setStoredOrgId(org.id);
  }, [isLoading, orgs.length, org, navigate]);

  const monthStart = todayISO(new Date(), org?.timezone).slice(0, 8) + "01";

  const accountsQuery = useQuery({
    queryKey: ["accounts", org?.id],
    queryFn: () => listAccounts({ data: { orgId: org?.id ?? "" } }),
    enabled: !!org,
  });
  const txQuery = useQuery({
    queryKey: ["transactions", org?.id],
    queryFn: () => listTransactions({ data: { orgId: org?.id ?? "", limit: 8 } }),
    enabled: !!org,
  });
  const monthQuery = useQuery({
    queryKey: ["income", org?.id, monthStart],
    queryFn: () => incomeStatement({ data: { orgId: org?.id ?? "", from: monthStart } }),
    enabled: !!org,
  });

  if (isLoading || !org) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <LoadingState label="Loading your dashboard" />
      </div>
    );
  }

  const accounts = accountsQuery.data ?? [];
  const cashCents = accounts
    .filter((a) => a.isActive && a.type === "asset")
    .reduce((sum, a) => sum + a.balanceCents, 0);
  const month = monthQuery.data;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{org.name}</h1>
          <p className="text-sm text-muted-foreground">{terms.orgLabel} ledger</p>
        </div>
        <Link
          to="/transactions/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <PlusCircle className="h-4 w-4" /> New Transaction
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-5">
          <div className="text-sm text-muted-foreground">Cash on hand</div>
          <div className="tnum mt-1 text-2xl font-semibold">{formatCents(cashCents)}</div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowUpRight className="h-4 w-4 text-primary" /> {terms.revenue} this month
          </div>
          <div className="tnum mt-1 text-2xl font-semibold text-primary">
            {formatCents(month?.totalRevenueCents ?? 0)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowDownRight className="h-4 w-4 text-destructive" /> {terms.expenses} this month
          </div>
          <div className="tnum mt-1 text-2xl font-semibold">
            {formatCents(month?.totalExpensesCents ?? 0)}
          </div>
        </div>
      </div>

      <SetupChecklist orgId={org.id} />
      <DueDrafts orgId={org.id} timezone={org.timezone} canWrite={org.role !== "viewer"} />

      <CashChart orgId={org.id} currency={org.currency} />

      <h2 className="font-display mt-8 text-lg font-semibold">Recent transactions</h2>
      <div className="mt-3 overflow-hidden rounded-lg border bg-card">
        {(txQuery.data ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No transactions yet.{" "}
            <Link to="/transactions/new" className="text-primary underline">
              Record your first one
            </Link>
            .
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {(txQuery.data ?? []).map((t) => {
                const total = t.entries
                  .filter((e) => e.amountCents > 0)
                  .reduce((a, e) => a + e.amountCents, 0);
                return (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="tnum px-4 py-3 text-muted-foreground">{t.transactionDate}</td>
                    <td className="px-4 py-3">
                      {t.description}
                      {t.status === "void" && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          void
                        </span>
                      )}
                    </td>
                    <td className="tnum px-4 py-3 text-right">{formatCents(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
