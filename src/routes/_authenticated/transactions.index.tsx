import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { showError } from "@/lib/show-error";
import { errorMessage } from "@/lib/errors";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { listAccounts, listProjects, listFunds } from "@/lib/taxonomy.functions";
import { parseToCents } from "@/lib/money";
import type { TxFilter } from "@/lib/domain/search";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { listTransactions, voidTransaction } from "@/lib/transactions.functions";
import { formatCents } from "@/lib/money";
import { PlusCircle, Ban } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/transactions/")({
  head: () => ({
    meta: [
      { title: "Transactions - OpenLedgerApp" },
      { name: "description", content: "Every transaction in your ledger." },
      { property: "og:title", content: "Transactions - OpenLedgerApp" },
      { property: "og:description", content: "Every transaction in your ledger." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s) =>
    z
      .object({
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        accountId: z.string().optional(),
        projectId: z.string().optional(),
        fundId: z.string().optional(),
        min: z.string().optional(),
        max: z.string().optional(),
        status: z.enum(["posted", "void"]).optional(),
        source: z.string().optional(),
        reconciled: z.enum(["yes", "no"]).optional(),
      })
      .parse(s),
  component: TransactionsPage,
});

const fCls =
  "rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const SOURCES = ["manual", "import", "opening_balance", "adjustment", "transfer", "release", "pledge"];

function toFilter(s: ReturnType<typeof Route.useSearch>): TxFilter {
  const cents = (v?: string) => {
    if (!v) return undefined;
    const c = parseToCents(v);
    return Number.isFinite(c) ? c : undefined;
  };
  const f: TxFilter = {
    q: s.q || undefined,
    from: s.from || undefined,
    to: s.to || undefined,
    accountId: s.accountId || undefined,
    projectId: s.projectId || undefined,
    fundId: s.fundId || undefined,
    minCents: cents(s.min),
    maxCents: cents(s.max),
    status: s.status,
    source: s.source || undefined,
    reconciled: s.reconciled,
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as TxFilter;
}

function TransactionsPage() {
  const { org, terms, terminology } = useOrgContext();
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/transactions/" });
  const filter = toFilter(search);
  const filtering = Object.keys(filter).length > 0;
  const setParam = (k: keyof typeof search, v: string) =>
    navigate({ search: (p) => ({ ...p, [k]: v || undefined }), replace: true });

  const txQuery = useQuery({
    queryKey: ["transactions", org?.id, "all", filter],
    queryFn: () => listTransactions({ data: { orgId: org!.id, limit: 300, filter } }),
    enabled: !!org,
  });
  const accountsQ = useQuery({
    queryKey: ["accounts", org?.id],
    queryFn: () => listAccounts({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const projectsQ = useQuery({
    queryKey: ["projects", org?.id],
    queryFn: () => listProjects({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const fundsQ = useQuery({
    queryKey: ["funds", org?.id],
    queryFn: () => listFunds({ data: { orgId: org!.id } }),
    enabled: !!org,
  });

  async function exportResults() {
    if (!org || !txQuery.data) return;
    const ex = await import("@/lib/export");
    const rows: (string | number)[][] = [["Date", "Description", "Source", "Status", "Amount"]];
    for (const t of txQuery.data)
      rows.push([
        t.transactionDate,
        t.description,
        t.source,
        t.status,
        ex.centsToNumber(t.entries.filter((e) => e.amountCents > 0).reduce((a, e) => a + e.amountCents, 0)),
      ]);
    ex.downloadCsv({ name: "Transactions", rows }, ex.safeFileName(`${org.name}-transactions`) + ".csv");
  }

  async function handleVoid(id: string) {
    if (!org) return;
    try {
      await voidTransaction({ data: { orgId: org.id, transactionId: id } });
      toast.success("Transaction voided");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err) {
      showError(err, "Could not void transaction");
    }
  }

  if (!org) return <OrgPending />;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Transactions</h1>
        <Link
          to="/transactions/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <PlusCircle className="h-4 w-4" /> New Transaction
        </Link>
      </div>

      <form
        role="search"
        aria-label="Search transactions"
        onSubmit={(e) => e.preventDefault()}
        className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3"
      >
        <label className="text-xs text-muted-foreground">
          Search
          <input
            className={`${fCls} block w-48`}
            placeholder="Description or note"
            defaultValue={search.q ?? ""}
            onChange={(e) => setParam("q", e.target.value)}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          From
          <input type="date" className={`${fCls} block`} value={search.from ?? ""} onChange={(e) => setParam("from", e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input type="date" className={`${fCls} block`} value={search.to ?? ""} onChange={(e) => setParam("to", e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          Account
          <select className={`${fCls} block`} value={search.accountId ?? ""} onChange={(e) => setParam("accountId", e.target.value)}>
            <option value="">Any</option>
            {(accountsQ.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        {(projectsQ.data ?? []).length > 0 && (
          <label className="text-xs text-muted-foreground">
            Project
            <select className={`${fCls} block`} value={search.projectId ?? ""} onChange={(e) => setParam("projectId", e.target.value)}>
              <option value="">Any</option>
              {(projectsQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        {(fundsQ.data ?? []).length > 0 && (
          <label className="text-xs text-muted-foreground">
            Fund
            <select className={`${fCls} block`} value={search.fundId ?? ""} onChange={(e) => setParam("fundId", e.target.value)}>
              <option value="">Any</option>
              {(fundsQ.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-muted-foreground">
          Min amount
          <input inputMode="decimal" className={`${fCls} block w-24`} defaultValue={search.min ?? ""} onChange={(e) => setParam("min", e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          Max amount
          <input inputMode="decimal" className={`${fCls} block w-24`} defaultValue={search.max ?? ""} onChange={(e) => setParam("max", e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          Status
          <select className={`${fCls} block`} value={search.status ?? ""} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">Any</option>
            <option value="posted">Posted</option>
            <option value="void">Void</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Source
          <select className={`${fCls} block`} value={search.source ?? ""} onChange={(e) => setParam("source", e.target.value)}>
            <option value="">Any</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Checked against statement
          <select className={`${fCls} block`} value={search.reconciled ?? ""} onChange={(e) => setParam("reconciled", e.target.value)}>
            <option value="">Any</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        {filtering && (
          <button
            type="button"
            onClick={() => navigate({ search: {}, replace: true })}
            className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={exportResults}
          disabled={!txQuery.data?.length}
          className="ml-auto rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          Export results (CSV)
        </button>
      </form>

      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        {txQuery.isPending ? (
          <LoadingState label="Loading transactions" />
        ) : txQuery.isError ? (
          <ErrorState message={errorMessage(txQuery.error)} onRetry={() => txQuery.refetch()} />
        ) : (txQuery.data ?? []).length === 0 && filtering ? (
          <EmptyState title="No matches" description="Nothing matches these filters. Try clearing some." />
        ) : (txQuery.data ?? []).length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="Record money coming in or going out, or import a bank file."
            action={
              <Link
                to="/transactions/new"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                New transaction
              </Link>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(txQuery.data ?? []).map((t) => {
                const total = t.entries
                  .filter((e) => e.amountCents > 0)
                  .reduce((a, e) => a + e.amountCents, 0);
                const isOpen = expanded === t.id;
                return (
                  <Fragment key={t.id}>
                    <tr
                      key={t.id}
                      onClick={() => setExpanded(isOpen ? null : t.id)}
                      className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
                    >
                      <td className="tnum px-4 py-3 text-muted-foreground">{t.transactionDate}</td>
                      <td className="px-4 py-3">
                        {t.description}
                        {t.status === "void" && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            void
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t.source.replace("_", " ")}
                      </td>
                      <td className="tnum px-4 py-3 text-right">{formatCents(total)}</td>
                      <td className="px-4 py-3 text-right">
                        {t.status === "posted" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVoid(t.id);
                            }}
                            title="Void transaction"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${t.id}-detail`} className="border-b bg-muted/30">
                        <td colSpan={5} className="px-6 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="py-1">Account</th>
                                <th className="py-1">Details</th>
                                <th className="py-1 text-right">{terms.debit}</th>
                                <th className="py-1 text-right">{terms.credit}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {t.entries.map((e) => (
                                <tr key={e.id}>
                                  <td className="py-1 font-medium">{e.accountName}</td>
                                  <td className="py-1 text-muted-foreground">
                                    {[e.categoryName, e.projectName, e.fundName, e.memo]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </td>
                                  <td className="tnum py-1 text-right">
                                    {e.amountCents > 0 ? formatCents(e.amountCents) : ""}
                                  </td>
                                  <td className="tnum py-1 text-right">
                                    {e.amountCents < 0 ? formatCents(-e.amountCents) : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {terms.levels.debitCredit !== "accounting" && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Every transaction moves money between accounts. Increases always equal
                              decreases.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
