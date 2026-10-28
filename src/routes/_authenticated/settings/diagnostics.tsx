import { errorMessage } from "@/lib/errors";
import { ErrorState, LoadingState } from "@/components/PageStates";
import { OrgPending } from "@/components/AppShell";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";
import { useOrgContext } from "@/hooks/use-org-context";
import { getDiagnostics } from "@/lib/planning.functions";
import { APP_VERSION } from "@/lib/version";
import { isDesktop } from "@/lib/edition";
import { SQLITE_MIGRATIONS } from "@/lib/adapters/sqlite/schema";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/settings/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnostics - OpenLedgerApp" },
      { name: "description", content: "Health checks for your books and this installation." },
      { property: "og:title", content: "Diagnostics - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Health checks for your books and this installation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiagnosticsPage,
});

function DiagnosticsPage() {
  const { org } = useOrgContext();
  const allowed = can(org?.role, "close_books");
  const q = useQuery({
    queryKey: ["diagnostics", org?.id],
    queryFn: () => getDiagnostics({ data: { orgId: org!.id } }),
    enabled: !!org && allowed,
  });
  if (!org) return <OrgPending inShell={false} />;
  if (!allowed)
    return (
      <p className="text-sm text-muted-foreground">Diagnostics are for admins and treasurers.</p>
    );

  const edition = isDesktop() ? "Desktop" : "Cloud or self-hosted";
  const info: [string, string][] = [
    ["Version", APP_VERSION],
    ["Edition", edition],
    ...(isDesktop()
      ? ([
          ["Database file", "openledgerapp.db in the app's data folder"],
          ["Database version", String(SQLITE_MIGRATIONS.at(-1)?.version ?? 0)],
        ] as [string, string][])
      : []),
  ];

  function copyReport() {
    if (!q.data) return;
    // Counts and pass/fail only: no names, amounts or descriptions.
    const lines = [
      `OpenLedgerApp diagnostics`,
      ...info.map(([k, v]) => `${k}: ${v}`),
      `Accounts: ${q.data.counts.accounts}`,
      `Transactions: ${q.data.counts.transactions}`,
      `Statement checks: ${q.data.counts.statementChecks}`,
      ...q.data.checks.map((c) => `${c.ok ? "OK" : "PROBLEM"} ${c.key}`),
    ];
    void navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Report copied. It contains no names or amounts.");
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">This installation</h2>
        <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
          {info.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Book health</h2>
          <button
            onClick={copyReport}
            disabled={!q.data}
            className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            <Copy className="h-4 w-4" /> Copy report
          </button>
        </div>
        {q.isPending ? (
          <LoadingState label="Running checks" />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : (
          <ul className="mt-3 space-y-2">
            {q.data.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" aria-label="OK" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" aria-label="Problem" />
                )}
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-muted-foreground">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
