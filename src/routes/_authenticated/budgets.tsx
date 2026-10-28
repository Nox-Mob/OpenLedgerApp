import { checkAmount, checkName } from "@/lib/validation";
import { showError } from "@/lib/show-error";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { budgetVsActual, saveBudget } from "@/lib/budgets.functions";
import { listFunds, listProjects } from "@/lib/taxonomy.functions";
import { periodStartFor, shiftPeriod, type BudgetPeriod } from "@/lib/domain/budgets";
import { formatCents, parseToCents, todayISO } from "@/lib/money";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/budgets")({
  head: () => ({
    meta: [
      { title: "Budgets - OpenLedgerApp" },
      {
        name: "description",
        content: "Set yearly or monthly budgets and compare them to actuals.",
      },
      { property: "og:title", content: "Budgets - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Set yearly or monthly budgets and compare them to actuals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BudgetsPage,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function label(type: BudgetPeriod, start: string, end: string) {
  const [y, m] = start.split("-").map(Number) as [number, number];
  if (type === "month") return `${MONTHS[m - 1]} ${y}`;
  const ey = Number(end.slice(0, 4));
  return m === 1 ? `${y}` : `${MONTHS[m - 1]} ${y} to ${MONTHS[Number(end.slice(5, 7)) - 1]} ${ey}`;
}

function BudgetsPage() {
  const { org, reportTerms: terms } = useOrgContext();
  const qc = useQueryClient();
  const [type, setType] = useState<BudgetPeriod>("year");
  const today = todayISO(new Date(), org?.timezone);
  const fy = org?.fiscalYearStartMonth ?? 1;
  const [starts, setStarts] = useState({
    year: periodStartFor("year", today, fy),
    month: periodStartFor("month", today, fy),
  });
  const start = starts[type];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // "" = whole organization, "f:<id>" = one fund, "p:<id>" = one project.
  const [scope, setScope] = useState("");
  const fundId = scope.startsWith("f:") ? scope.slice(2) : null;
  const projectId = scope.startsWith("p:") ? scope.slice(2) : null;
  const funds = useQuery({
    queryKey: ["funds", org?.id],
    queryFn: () => listFunds({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const projects = useQuery({
    queryKey: ["projects", org?.id],
    queryFn: () => listProjects({ data: { orgId: org!.id } }),
    enabled: !!org,
  });

  const q = useQuery({
    queryKey: ["budgets", org?.id, type, start, scope],
    queryFn: () =>
      budgetVsActual({
        data: { orgId: org!.id, periodType: type, periodStart: start, fundId, projectId },
      }),
    enabled: !!org,
  });
  if (!org) return <OrgPending />;
  const canWrite = org.role !== "viewer";

  async function save(accountId: string) {
    const raw = drafts[accountId];
    if (raw === undefined) return;
    let cents: number | null = null;
    if (raw.trim() !== "") {
      const amt = checkAmount(raw, { allowZero: true, label: "Budget" });
      if (!amt.ok) {
        toast.error(amt.error);
        return;
      }
      cents = amt.value;
    }
    try {
      await saveBudget({
        data: {
          orgId: org!.id,
          accountId,
          periodType: type,
          periodStart: start,
          amountCents: cents,
          fundId,
          projectId,
        },
      });
      setDrafts(({ [accountId]: _, ...rest }) => rest);
      qc.invalidateQueries({ queryKey: ["budgets", org!.id] });
    } catch (e) {
      showError(e, "Could not save budget");
    }
  }

  const lines = q.data?.lines ?? [];
  const groups = [
    { key: "revenue" as const, title: terms.revenue },
    { key: "expense" as const, title: terms.expenses },
  ];

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">Budgets</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set a budget for the year or for a month, then compare it to what actually happened.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-input p-0.5" role="group">
          {(["year", "month"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                setDrafts({});
              }}
              aria-pressed={type === t}
              className={`rounded px-4 py-1.5 text-sm font-medium ${type === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {t === "year" ? "Yearly" : "Monthly"}
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="sr-only">Budget for</span>
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setDrafts({});
            }}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            <option value="">Whole organization</option>
            {(funds.data ?? []).map((f) => (
              <option key={f.id} value={`f:${f.id}`}>
                Fund: {f.name}
              </option>
            ))}
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                Project: {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            aria-label="Previous period"
            onClick={() => setStarts((s) => ({ ...s, [type]: shiftPeriod(type, start, -1) }))}
            className="rounded-md border border-input p-1.5 hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-40 text-center text-sm font-medium">
            {q.data ? label(type, q.data.from, q.data.to) : "…"}
          </span>
          <button
            aria-label="Next period"
            onClick={() => setStarts((s) => ({ ...s, [type]: shiftPeriod(type, start, 1) }))}
            className="rounded-md border border-input p-1.5 hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {groups.map((g) => {
          const rows = lines.filter((l) => l.type === g.key);
          const tb = rows.reduce((a, r) => a + (r.budgetCents ?? 0), 0);
          const ta = rows.reduce((a, r) => a + r.actualCents, 0);
          return (
            <div key={g.key} className="overflow-hidden rounded-lg border bg-card">
              <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">{g.title}</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2">Account</th>
                    <th className="w-40 px-4 py-2 text-right">Budget</th>
                    <th className="px-4 py-2 text-right">Actual</th>
                    <th className="px-4 py-2 text-right">Difference</th>
                    <th className="w-40 px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const budget = r.budgetCents ?? 0;
                    // Positive difference = good (more income or less spending than planned).
                    const diff =
                      g.key === "revenue" ? r.actualCents - budget : budget - r.actualCents;
                    const pct =
                      budget > 0 ? Math.min(100, Math.round((r.actualCents / budget) * 100)) : 0;
                    const draft = drafts[r.accountId];
                    return (
                      <tr key={r.accountId} className="border-b last:border-0">
                        <td className="px-4 py-2.5">{r.name}</td>
                        <td className="px-4 py-1.5 text-right">
                          {canWrite ? (
                            <input
                              aria-label={`Budget for ${r.name}`}
                              inputMode="decimal"
                              placeholder="0.00"
                              value={
                                draft ??
                                (r.budgetCents === null ? "" : (r.budgetCents / 100).toFixed(2))
                              }
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [r.accountId]: e.target.value }))
                              }
                              onBlur={() => save(r.accountId)}
                              onKeyDown={(e) =>
                                e.key === "Enter" && (e.target as HTMLInputElement).blur()
                              }
                              className="tnum w-32 rounded-md border border-input bg-background px-2 py-1 text-right outline-none focus:ring-2 focus:ring-ring"
                            />
                          ) : (
                            <span className="tnum">
                              {r.budgetCents === null ? "" : formatCents(budget)}
                            </span>
                          )}
                        </td>
                        <td className="tnum px-4 py-2.5 text-right">
                          {formatCents(r.actualCents)}
                        </td>
                        <td
                          className={`tnum px-4 py-2.5 text-right ${r.budgetCents !== null && diff < 0 ? "text-destructive" : ""}`}
                        >
                          {r.budgetCents === null ? "" : formatCents(diff)}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.budgetCents !== null && (
                            <div className="h-2 w-full overflow-hidden rounded bg-muted">
                              <div
                                className={`h-full ${g.key === "expense" && r.actualCents > budget ? "bg-destructive" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/50 font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="tnum px-4 py-2.5 text-right">{formatCents(tb)}</td>
                    <td className="tnum px-4 py-2.5 text-right">{formatCents(ta)}</td>
                    <td className="tnum px-4 py-2.5 text-right">
                      {formatCents(g.key === "revenue" ? ta - tb : tb - ta)}
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Leave a budget empty to remove it. Actuals use posted transactions only.
      </p>
    </AppShell>
  );
}
