import { WriteGuard } from "@/components/WriteGuard";
import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { showError } from "@/lib/show-error";
import { errorMessage } from "@/lib/errors";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { listAccounts } from "@/lib/taxonomy.functions";
import {
  listReconciliations,
  startReconciliation,
  suggestReconciliation,
} from "@/lib/reconcile.functions";
import { formatCents, parseToCents } from "@/lib/money";
import { CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reconcile/")({
  validateSearch: z.object({ account: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Reconcile - OpenLedgerApp" },
      {
        name: "description",
        content: "Check your books against bank statements and keep a reconciliation history.",
      },
      { property: "og:title", content: "Reconcile - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Check your books against bank statements and keep a reconciliation history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReconcileIndex,
});

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function ReconcileIndex() {
  const { org, terms } = useOrgContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState(search.account ?? "");
  const [form, setForm] = useState({
    start: "",
    end: "",
    beginning: "",
    ending: "",
    mode: "simple" as "simple" | "full",
  });
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ["accounts", org?.id],
    queryFn: () => listAccounts({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const recsQuery = useQuery({
    queryKey: ["reconciliations", org?.id],
    queryFn: () => listReconciliations({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const suggestQuery = useQuery({
    queryKey: ["reconcile-suggest", accountId],
    queryFn: () => suggestReconciliation({ data: { orgId: org!.id, accountId } }),
    enabled: !!org && !!accountId,
  });

  useEffect(() => {
    const s = suggestQuery.data;
    if (!s) return;
    const c = (v: number | null | undefined) => (v == null ? "" : (v / 100).toFixed(2));
    setForm((f) => ({
      ...f,
      start: s.periodStart ?? "",
      end: s.periodEnd ?? "",
      beginning: c(s.beginningBalanceCents),
      ending: c(s.endingBalanceCents),
    }));
    setBatchId(s.batchId);
  }, [suggestQuery.data]);

  if (!org) return <OrgPending />;
  const accounts = (accountsQuery.data ?? []).filter(
    (a) => a.isActive && (a.type === "asset" || a.type === "liability"),
  );
  const recs = recsQuery.data ?? [];
  const openForAccount = recs.find((r) => r.accountId === accountId && r.status === "in_progress");

  async function start() {
    if (!org || !accountId) return;
    const beginning = parseToCents(form.beginning || "0");
    const ending = parseToCents(form.ending);
    if (!form.start || !form.end || ending == null || beginning == null) {
      toast.error("Fill in the period and both balances");
      return;
    }
    setBusy(true);
    try {
      const { id } = await startReconciliation({
        data: {
          orgId: org.id,
          accountId,
          periodStart: form.start,
          periodEnd: form.end,
          beginningBalanceCents: beginning,
          endingBalanceCents: ending,
          mode: form.mode,
          batchId,
        },
      });
      navigate({ to: "/reconcile/$id", params: { id } });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">{terms.reconcile}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Compare your books with a bank or card statement. Nothing in your books changes. You're only
        confirming what matches.
      </p>

      <WriteGuard>
        <div className="mt-6 max-w-3xl rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Start a new statement</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-sm font-medium">Account</label>
              <select
                aria-label="Account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={inputCls}
              >
                <option value="">Choose account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {accountId && openForAccount ? (
              <div className="md:col-span-2 rounded-md bg-accent/50 p-3 text-sm">
                This account already has a statement in progress.{" "}
                <Link
                  to="/reconcile/$id"
                  params={{ id: openForAccount.id }}
                  className="font-medium text-primary underline"
                >
                  Continue it
                </Link>
              </div>
            ) : (
              accountId && (
                <>
                  <div>
                    <label className="text-sm font-medium">Statement from</label>
                    <input
                      aria-label="Statement from"
                      type="date"
                      value={form.start}
                      onChange={(e) => setForm({ ...form, start: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Statement to</label>
                    <input
                      aria-label="Statement to"
                      type="date"
                      value={form.end}
                      onChange={(e) => setForm({ ...form, end: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Beginning balance</label>
                    <input
                      aria-label="Beginning balance"
                      inputMode="decimal"
                      value={form.beginning}
                      onChange={(e) => setForm({ ...form, beginning: e.target.value })}
                      className={`${inputCls} tnum`}
                      placeholder="0.00"
                    />
                    {suggestQuery.data?.hasPrevious && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        From your last completed statement.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Ending balance (from statement)</label>
                    <input
                      aria-label="Ending balance (from statement)"
                      inputMode="decimal"
                      value={form.ending}
                      onChange={(e) => setForm({ ...form, ending: e.target.value })}
                      className={`${inputCls} tnum`}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium">How do you want to check?</label>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {(
                        [
                          [
                            "simple",
                            "Simple",
                            "We match imported bank rows to your books automatically. You review the leftovers.",
                          ],
                          ["full", "Full", "Tick each item yourself, like balancing a checkbook."],
                        ] as const
                      ).map(([v, label, desc]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setForm({ ...form, mode: v })}
                          className={`rounded-md border p-3 text-left text-sm ${form.mode === v ? "border-primary bg-primary/5" : "hover:bg-accent/40"}`}
                        >
                          <div className="font-medium">{label}</div>
                          <div className="text-xs text-muted-foreground">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <button
                      onClick={start}
                      disabled={busy}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {busy ? "Starting…" : "Start"}
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      </WriteGuard>

      <h2 className="font-display mt-8 text-lg font-semibold">History</h2>
      <div className="mt-3 overflow-hidden rounded-lg border bg-card">
        {recsQuery.isPending ? (
          <LoadingState label="Loading statement checks" />
        ) : recsQuery.isError ? (
          <ErrorState message={errorMessage(recsQuery.error)} onRetry={() => recsQuery.refetch()} />
        ) : recs.length === 0 ? (
          <EmptyState
            title="No statements checked yet"
            description="Start one above when your bank statement arrives."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Period</th>
                <th className="px-4 py-2 text-right">Beginning</th>
                <th className="px-4 py-2 text-right">Ending</th>
                <th className="px-4 py-2 text-right">Items</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-2.5">
                    <Link
                      to="/reconcile/$id"
                      params={{ id: r.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.accountName}
                    </Link>
                  </td>
                  <td className="tnum px-4 py-2.5 text-xs">
                    {r.periodStart} → {r.periodEnd}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {formatCents(r.beginningBalanceCents)}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {formatCents(r.endingBalanceCents)}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">{r.itemCount}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.status === "completed" ? (
                      <span className="flex items-center gap-1 text-primary">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Done {r.completedAt?.slice(0, 10)}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" /> In progress ({r.mode})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
