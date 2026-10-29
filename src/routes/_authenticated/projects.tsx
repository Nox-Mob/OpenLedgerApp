import { checkAmount, checkName } from "@/lib/validation";
import { showError } from "@/lib/show-error";
import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { errorMessage } from "@/lib/errors";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { listProjects, createProject } from "@/lib/taxonomy.functions";
import { projectSummary } from "@/lib/reports.functions";
import { formatCents, parseToCents } from "@/lib/money";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  useRestoreArchived,
  toggleArchived,
  type CreateResult,
} from "@/components/RestoreArchivedDialog";

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({
    meta: [
      { title: "Projects - OpenLedgerApp" },
      { name: "description", content: "Track budget vs actual spending by project." },
      { property: "og:title", content: "Projects - OpenLedgerApp" },
      { property: "og:description", content: "Track budget vs actual spending by project." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectsPage,
});

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function ProjectsPage() {
  const { org } = useOrgContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");

  const summaryQuery = useQuery({
    queryKey: ["project-summary", org?.id],
    queryFn: () => projectSummary({ data: { orgId: org!.id } }),
    enabled: !!org,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["project-summary"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };
  const restorePrompt = useRestoreArchived(org?.id, refresh);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    const n = checkName(name, "Project name");
    if (!n.ok) return void toast.error(n.error);
    let budgetCents = 0;
    if (budget.trim()) {
      const b = checkAmount(budget, { allowZero: true, label: "Budget" });
      if (!b.ok) return void toast.error(b.error);
      budgetCents = b.value;
    }
    try {
      const res = (await createProject({
        data: { orgId: org.id, name: n.value, budgetCents },
      })) as CreateResult;
      setName("");
      setBudget("");
      if (!restorePrompt.handle(res)) return;
      toast.success("Project created");
      refresh();
    } catch (err) {
      showError(err, "Could not create project");
    }
  }

  if (!org) return <OrgPending />;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">Projects</h1>
      <p className="mt-1 text-sm text-muted-foreground">Budget vs actual spending, per project.</p>

      <form
        onSubmit={submit}
        className="mt-5 flex max-w-xl items-end gap-3 rounded-lg border bg-card p-4"
      >
        <div className="flex-1">
          <label className="text-sm font-medium">Project name</label>
          <input
            aria-label="Project name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="e.g. Summer Food Program"
          />
        </div>
        <div className="w-36">
          <label className="text-sm font-medium">Budget</label>
          <input
            aria-label="Budget"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={`${inputCls} tnum`}
            placeholder="0.00"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>

      <div className="mt-6 overflow-hidden rounded-lg border bg-card">
        {summaryQuery.isPending ? (
          <LoadingState label="Loading projects" />
        ) : summaryQuery.isError ? (
          <ErrorState
            message={errorMessage(summaryQuery.error)}
            onRetry={() => summaryQuery.refetch()}
          />
        ) : (summaryQuery.data ?? []).length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Add a project above to track its budget and spending."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Budget</th>
                <th className="px-4 py-2 text-right">Spent</th>
                <th className="px-4 py-2 text-right">Remaining</th>
                <th className="px-4 py-2 w-48"></th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(summaryQuery.data ?? []).map((p) => {
                const remaining = p.budgetCents - p.spentCents;
                const pct =
                  p.budgetCents > 0
                    ? Math.min(100, Math.round((p.spentCents / p.budgetCents) * 100))
                    : 0;
                return (
                  <tr
                    key={p.id}
                    className={`border-b last:border-0 ${p.status === "archived" ? "opacity-70" : ""}`}
                  >
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.status}</td>
                    <td className="tnum px-4 py-3 text-right">{formatCents(p.budgetCents)}</td>
                    <td className="tnum px-4 py-3 text-right">{formatCents(p.spentCents)}</td>
                    <td
                      className={`tnum px-4 py-3 text-right ${remaining < 0 ? "text-destructive" : ""}`}
                    >
                      {formatCents(remaining)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-full overflow-hidden rounded bg-muted">
                        <div
                          className={`h-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="text-xs font-medium text-primary hover:underline"
                        aria-label={`${p.status === "archived" ? "Restore" : "Archive"} ${p.name}`}
                        onClick={() =>
                          toggleArchived(
                            org.id,
                            { kind: "project", id: p.id, name: p.name },
                            p.status === "archived",
                            refresh,
                          )
                        }
                      >
                        {p.status === "archived" ? "Restore" : "Archive"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {restorePrompt.dialog}
    </AppShell>
  );
}
