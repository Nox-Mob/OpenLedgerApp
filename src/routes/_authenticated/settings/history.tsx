import { errorMessage } from "@/lib/errors";
import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { OrgPending } from "@/components/AppShell";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useOrgContext } from "@/hooks/use-org-context";
import { listHistory } from "@/lib/backup.functions";

export const Route = createFileRoute("/_authenticated/settings/history")({
  head: () => ({
    meta: [
      { title: "History - OpenLedgerApp" },
      { name: "description", content: "See who changed what in your books, and when." },
      { property: "og:title", content: "History - OpenLedgerApp" },
      { property: "og:description", content: "See who changed what in your books, and when." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

const ENTITIES = [
  "",
  "transaction",
  "account",
  "organization",
  "reconciliation",
  "import_batch",
  "fund",
  "pledge",
  "budget",
  "member",
];

function HistoryPage() {
  const { org } = useOrgContext();
  const [page, setPage] = useState(0);
  const [entity, setEntity] = useState("");
  const [kind, setKind] = useState<"" | "change" | "ledger" | "system">("");
  const [open, setOpen] = useState<string | null>(null);
  const isAdmin = org?.role === "admin";
  const q = useQuery({
    queryKey: ["history", org?.id, page, entity, kind],
    queryFn: () =>
      listHistory({
        data: {
          orgId: org!.id,
          page,
          ...(entity ? { entity } : {}),
          ...(kind ? { kind } : {}),
        },
      }),
    enabled: !!org && isAdmin,
  });
  if (!org) return <OrgPending inShell={false} />;
  if (!isAdmin)
    return <p className="text-sm text-muted-foreground">Only admins can view history.</p>;

  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const fmt = (ts: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: org.timezone,
    }).format(new Date(ts));

  return (
    <div>
      <h2 className="font-display text-lg font-semibold">History</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every change to this organization's books, newest first. History can't be edited or deleted.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="entity" className="text-muted-foreground">
          Show
        </label>
        <select
          id="entity"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(0);
          }}
          className="max-w-full rounded-md border border-input bg-background px-3 py-1.5"
        >
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e ? e.replace("_", " ") : "Everything"}
            </option>
          ))}
        </select>
        <label htmlFor="kind" className="text-muted-foreground sm:ml-4">
          Type
        </label>
        <select
          id="kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setPage(0);
          }}
          className="max-w-full rounded-md border border-input bg-background px-3 py-1.5"
        >
          <option value="">All types</option>
          <option value="ledger">Money (postings and voids)</option>
          <option value="change">Setup and settings</option>
          <option value="system">System (imports, backups, members)</option>
        </select>
      </div>
      <div
        className="mt-4 overflow-x-auto rounded-lg border bg-card"
        tabIndex={0}
        role="region"
        aria-label="History"
      >
        {q.isPending ? (
          <LoadingState label="Loading history" />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : (q.data?.rows ?? []).length === 0 ? (
          <EmptyState title="No history yet" description="Changes appear here as people work." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">What</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {q.data!.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-b">
                    <td className="whitespace-nowrap px-4 py-2.5">{fmt(r.created_at)}</td>
                    <td className="px-4 py-2.5">{r.who}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{r.action}</span>{" "}
                      <span className="text-muted-foreground">on {r.entity}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="text-sm underline-offset-2 hover:underline"
                        onClick={() => setOpen(open === r.id ? null : r.id)}
                      >
                        {open === r.id ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="border-b bg-muted/30">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold">Before</p>
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                              {r.before ? JSON.stringify(r.before, null, 2) : "None"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs font-semibold">After</p>
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                              {r.after ? JSON.stringify(r.after, null, 2) : "None"}
                            </pre>
                          </div>
                        </div>
                        {r.recorded_change ? (
                          <div className="mt-3">
                            <p className="text-xs font-semibold">
                              Saved change (recorded by the database)
                            </p>
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                              {JSON.stringify(r.recorded_change, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-md border border-input px-3 py-1.5 disabled:opacity-50"
        >
          Newer
        </button>
        <span className="text-muted-foreground">
          Page {page + 1} of {pages}
        </span>
        <button
          disabled={page + 1 >= pages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-md border border-input px-3 py-1.5 disabled:opacity-50"
        >
          Older
        </button>
      </div>
    </div>
  );
}
