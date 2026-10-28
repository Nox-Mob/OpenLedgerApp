import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Repeat } from "lucide-react";
import { toast } from "sonner";
import { getSetupProgress, listDue, postDue, skipDue } from "@/lib/planning.functions";
import { formatCents, todayISO } from "@/lib/money";
import { showError } from "@/lib/show-error";

const hideKey = (orgId: string) => `openledgerapp:checklist-hidden:${orgId}`;

/** First-run checklist. Ticks itself off from the books; can be hidden. */
export function SetupChecklist({ orgId }: { orgId: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(localStorage.getItem(hideKey(orgId)) === "1"), [orgId]);
  const q = useQuery({
    queryKey: ["setup-progress", orgId],
    queryFn: () => getSetupProgress({ data: { orgId } }),
    enabled: !hidden,
  });
  if (hidden || !q.data) return null;
  const done = q.data.filter((s) => s.done).length;
  if (done === q.data.length) return null;
  return (
    <section aria-label="Getting set up" className="mt-6 rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          Getting set up{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {done} of {q.data.length} done
          </span>
        </h2>
        <button
          onClick={() => {
            localStorage.setItem(hideKey(orgId), "1");
            setHidden(true);
          }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.data.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            {s.done ? (
              <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Done" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" aria-label="Not done" />
            )}
            {s.done ? (
              <span className="text-muted-foreground line-through">{s.label}</span>
            ) : (
              <Link to={s.to as "/ledger"} className="underline underline-offset-4 hover:text-primary">
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Recurring templates that are due: a review list or a reminder, per the org setting. */
export function DueDrafts({
  orgId,
  timezone,
  canWrite,
}: {
  orgId: string;
  timezone?: string | undefined;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const today = todayISO(new Date(), timezone);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["due", orgId, today],
    queryFn: () => listDue({ data: { orgId, today } }),
  });
  if (!q.data || q.data.items.length === 0) return null;
  const { mode, items } = q.data;

  async function act(kind: "post" | "skip", templateId: string, dueDate: string) {
    setBusy(`${templateId}:${dueDate}`);
    try {
      if (kind === "post") {
        await postDue({ data: { orgId, templateId, dueDate } });
        toast.success("Posted. The transaction is in your books.");
      } else {
        await skipDue({ data: { orgId, templateId, dueDate } });
        toast.success("Skipped. Nothing was recorded.");
      }
      await qc.invalidateQueries();
    } catch (e) {
      showError(e, kind === "post" ? "Could not post" : "Could not skip");
    } finally {
      setBusy(null);
    }
  }

  if (mode === "reminder")
    return (
      <div role="status" className="mt-6 flex items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          <Repeat className="h-4 w-4 text-primary" aria-hidden="true" />
          {items.length === 1
            ? `"${items[0]!.templateName}" is due (${items[0]!.dueDate}).`
            : `${items.length} recurring transactions are due.`}
        </div>
        <Link
          to="/templates"
          className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
        >
          Review
        </Link>
      </div>
    );

  return (
    <section aria-label="Ready to review" className="mt-6 overflow-hidden rounded-lg border bg-card">
      <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
        Ready to review ({items.length})
      </h2>
      <ul>
        {items.map((d) => {
          const id = `${d.templateId}:${d.dueDate}`;
          return (
            <li key={id} className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm last:border-0">
              <span className="tnum text-muted-foreground">{d.dueDate}</span>
              <span className="flex-1">{d.description}</span>
              <span className="tnum">{formatCents(d.totalCents)}</span>
              {canWrite && (
                <span className="flex gap-2">
                  <button
                    disabled={busy === id}
                    onClick={() => act("post", d.templateId, d.dueDate)}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Post
                  </button>
                  <button
                    disabled={busy === id}
                    onClick={() => act("skip", d.templateId, d.dueDate)}
                    className="rounded-md border border-input px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    Skip
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
