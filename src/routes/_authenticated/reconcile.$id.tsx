import { useAccess } from "@/hooks/use-access";
import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { showError } from "@/lib/show-error";
import { errorMessage } from "@/lib/errors";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  acceptMatches,
  completeReconciliation,
  discardReconciliation,
  getReconciliation,
  reopenReconciliation,
  setCleared,
} from "@/lib/reconcile.functions";
import { displayBalance } from "@/lib/terminology";
import { formatCents } from "@/lib/money";
import { ArrowLeft, CheckCircle2, Wand2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reconcile/$id")({
  head: () => ({
    meta: [
      { title: "Statement Check - OpenLedgerApp" },
      { name: "description", content: "Match your books to a bank statement, item by item." },
      { property: "og:title", content: "Statement Check - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Match your books to a bank statement, item by item.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReconcileWorkspace,
});

const ACTION_LABEL: Record<string, string> = {
  reconcile_start: "Started",
  reconcile_clear: "Ticked items",
  reconcile_unclear: "Unticked items",
  reconcile_accept_matches: "Accepted automatic matches",
  reconcile_complete: "Finished",
  reconcile_reopen: "Reopened",
};

function ReconcileWorkspace() {
  const access = useAccess();
  const { id } = Route.useParams();
  const { org, terms } = useOrgContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["reconciliation", id],
    queryFn: () => getReconciliation({ data: { id } }),
    enabled: !!org,
  });

  if (!org) return <OrgPending />;
  if (q.isError)
    return (
      <AppShell>
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </AppShell>
    );
  if (q.isPending || !q.data)
    return (
      <AppShell>
        <LoadingState label="Loading statement check" />
      </AppShell>
    );

  const { reconciliation: r, entries, bankRows, matches, summary, history } = q.data;
  const done = r.status === "completed";
  const show = (c: number) => formatCents(displayBalance(r.accountType, c));
  const matchedEntry = new Map(matches.map((m) => [m.entryId, m.bankId]));
  const matchedBank = new Set(matches.map((m) => m.bankId));
  const unmatchedBank = bankRows.filter((b) => !matchedBank.has(b.id));
  const unmatchedEntries = entries.filter((e) => !matchedEntry.has(e.id));
  const isAdmin = access.can("reopen_reconciliation");

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["reconciliation", id] });
      qc.invalidateQueries({ queryKey: ["reconciliations"] });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (entryId: string, cleared: boolean) =>
    run(() => setCleared({ data: { id, entryIds: [entryId], cleared } }));
  const setAll = (cleared: boolean) => {
    const ids = entries.filter((e) => e.cleared !== cleared).map((e) => e.id);
    if (ids.length) run(() => setCleared({ data: { id, entryIds: ids, cleared } }));
  };

  const entryRow = (e: (typeof entries)[number], badge?: string | undefined) => (
    <tr key={e.id} className={`border-b last:border-0 ${e.cleared ? "bg-primary/5" : ""}`}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={e.cleared}
          disabled={done || busy}
          onChange={(ev) => toggle(e.id, ev.target.checked)}
          aria-label={`Tick ${e.description}`}
        />
      </td>
      <td className="tnum px-3 py-2 text-muted-foreground">{e.date}</td>
      <td className="px-3 py-2">
        {e.description}
        {badge && <span className="ml-2 rounded bg-muted px-1.5 text-[10px]">{badge}</span>}
        {e.beforePeriod && (
          <span
            className="ml-2 rounded bg-accent px-1.5 text-[10px] text-accent-foreground"
            title="Dated before this statement period. Only tick it if it actually cleared on this statement."
          >
            Earlier period
          </span>
        )}
      </td>
      <td className="tnum px-3 py-2 text-right">{show(e.amountCents)}</td>
    </tr>
  );
  const entryTable = ({
    rows,
    empty,
    badge,
  }: {
    rows: typeof entries;
    empty: string;
    badge?: (e: (typeof entries)[number]) => string | undefined;
  }) =>
    rows.length === 0 ? (
      <p className="p-4 text-sm text-muted-foreground">{empty}</p>
    ) : (
      <table className="w-full text-sm">
        <tbody>{rows.map((e) => entryRow(e, badge?.(e)))}</tbody>
      </table>
    );

  return (
    <AppShell>
      <Link
        to="/reconcile"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {terms.reconcile}
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-bold">{r.accountName}</h1>
        <span className="tnum text-sm text-muted-foreground">
          {r.periodStart} → {r.periodEnd}
        </span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs">
          {r.mode === "simple" ? "Simple" : "Full"}
        </span>
        {done && (
          <span className="flex items-center gap-1 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed {r.completedAt?.slice(0, 10)}
          </span>
        )}
      </div>

      <div className="sticky top-0 z-10 mt-4 grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 md:grid-cols-5">
        <Stat label="Beginning balance" value={formatCents(r.beginningBalanceCents)} />
        <Stat label="+ Ticked items" value={formatCents(summary.clearedCents)} />
        <Stat label="= Ticked balance" value={formatCents(summary.clearedBalance)} />
        <Stat label="Statement ending" value={formatCents(r.endingBalanceCents)} />
        <Stat
          label="Difference"
          value={formatCents(summary.difference)}
          highlight={summary.difference === 0 ? "ok" : "bad"}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!done && (
          <>
            {r.mode === "simple" && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const x = await acceptMatches({ data: { id } });
                    toast.success(`Ticked ${x.cleared} matched items`);
                  })
                }
                className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                <Wand2 className="h-4 w-4" /> Accept {matches.length} matches
              </button>
            )}
            {r.mode === "full" && (
              <>
                <button
                  disabled={busy}
                  onClick={() => setAll(true)}
                  className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  Tick all
                </button>
                <button
                  disabled={busy}
                  onClick={() => setAll(false)}
                  className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  Untick all
                </button>
              </>
            )}
            <button
              disabled={busy || summary.difference !== 0}
              onClick={() =>
                run(() => completeReconciliation({ data: { id } }), "Statement checked and locked")
              }
              title={summary.difference !== 0 ? "Difference must be zero" : undefined}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Finish
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Discard this statement check? Ticks are removed; your books don't change.",
                  )
                )
                  run(async () => {
                    await discardReconciliation({ data: { id } });
                    navigate({ to: "/reconcile" });
                  });
              }}
              className="ml-auto rounded-md border px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              Discard
            </button>
          </>
        )}
        {done && isAdmin && (
          <button
            disabled={busy}
            onClick={() => {
              if (confirm("Reopen this statement? Its items unlock so mistakes can be fixed."))
                run(() => reopenReconciliation({ data: { id } }), "Reopened");
            }}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            Reopen (admin)
          </button>
        )}
      </div>

      {r.mode === "simple" && !done ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Section title={`Matched to bank (${matches.length})`}>
            {entryTable({
              rows: entries.filter((e) => matchedEntry.has(e.id)),
              empty:
                "No matches found. Import this period's statement first, or switch to ticking items yourself.",
              badge: () => "bank match",
            })}
          </Section>
          <Section title={`In the bank, not in your books (${unmatchedBank.length})`}>
            {unmatchedBank.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nothing missing.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {unmatchedBank.map((b) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="tnum px-3 py-2 text-muted-foreground">{b.date}</td>
                      <td className="px-3 py-2">{b.description}</td>
                      <td className="tnum px-3 py-2 text-right">{show(b.amountCents)}</td>
                      <td className="px-3 py-2 text-right">
                        {!b.linkedTransactionId && (
                          <Link to="/import" className="text-xs text-primary underline">
                            Post it
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          <Section
            title={`In your books, not in the bank (${unmatchedEntries.length})`}
            className="lg:col-span-2"
          >
            {entryTable({
              rows: unmatchedEntries,
              empty: "Everything in your books has a bank match.",
            })}
          </Section>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Section
            title={
              done
                ? `Items on this statement (${entries.length})`
                : `Items up to ${r.periodEnd} (${entries.length})`
            }
            className="lg:col-span-2"
          >
            {entryTable({
              rows: entries,
              empty: "No unreconciled items for this account.",
              badge: (e) => (matchedEntry.has(e.id) ? "bank match" : undefined),
            })}
          </Section>
          {!done && (
            <Section title={`Bank rows with no match (${unmatchedBank.length})`}>
              {unmatchedBank.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">None.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {unmatchedBank.map((b) => (
                      <tr key={b.id} className="border-b last:border-0">
                        <td className="tnum px-3 py-2">{b.date}</td>
                        <td className="px-3 py-2">{b.description}</td>
                        <td className="tnum px-3 py-2 text-right">{show(b.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}
        </div>
      )}

      <Section title="Activity" className="mt-6">
        <ul className="divide-y text-sm">
          {history.map((h, i) => (
            <li key={i} className="flex justify-between px-4 py-2">
              <span>
                {ACTION_LABEL[h.action] ?? h.action}
                {entryCount(h.after) !== null ? ` (${entryCount(h.after)})` : ""}
              </span>
              <span className="tnum text-xs text-muted-foreground">
                {new Date(h.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "ok" | "bad";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`tnum text-lg font-semibold ${highlight === "ok" ? "text-primary" : highlight === "bad" ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border bg-card ${className}`}>
      <div className="border-b bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function entryCount(after: unknown): number | null {
  const ids = (after as { entryIds?: unknown } | null)?.entryIds;
  return Array.isArray(ids) ? ids.length : null;
}
