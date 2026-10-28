import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, OrgPending } from "@/components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { DueDrafts } from "@/components/DashboardCards";
import { useOrgContext } from "@/hooks/use-org-context";
import { listAccounts } from "@/lib/taxonomy.functions";
import {
  archiveTemplate,
  listDue,
  listTemplates,
  saveTemplate,
  setRecurringMode,
} from "@/lib/planning.functions";
import { checkAmount, checkName } from "@/lib/validation";
import { formatCents, todayISO } from "@/lib/money";
import { errorMessage } from "@/lib/errors";
import { showError } from "@/lib/show-error";
import { can } from "@/lib/permissions";
import { FREQUENCIES, type Frequency } from "@/lib/domain/templates";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({
    meta: [
      { title: "Templates - OpenLedgerApp" },
      {
        name: "description",
        content: "Save transactions you repeat and get drafts when recurring ones are due.",
      },
      { property: "og:title", content: "Templates - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Save transactions you repeat and get drafts when recurring ones are due.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemplatesPage,
});

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const FREQ_LABEL: Record<Frequency, string> = {
  weekly: "Every week",
  monthly: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
};

function TemplatesPage() {
  const { org } = useOrgContext();
  const qc = useQueryClient();
  const today = todayISO(new Date(), org?.timezone);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency | "">("monthly");
  const [nextDue, setNextDue] = useState(today);
  const [busy, setBusy] = useState(false);

  const accounts = useQuery({
    queryKey: ["accounts", org?.id],
    queryFn: () => listAccounts({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const templates = useQuery({
    queryKey: ["templates", org?.id],
    queryFn: () => listTemplates({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const due = useQuery({
    queryKey: ["due", org?.id, today],
    queryFn: () => listDue({ data: { orgId: org!.id, today } }),
    enabled: !!org,
  });
  if (!org) return <OrgPending />;
  const canWrite = can(org.role, "write");
  const isAdmin = can(org.role, "manage_settings");
  const names = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = checkName(name, "Template name");
    if (!n.ok) return void toast.error(n.error);
    if (!description.trim()) return void toast.error("Add a description. Nothing was saved.");
    if (!fromId || !toId || fromId === toId)
      return void toast.error("Pick two different accounts. Nothing was saved.");
    const amt = checkAmount(amount);
    if (!amt.ok) return void toast.error(amt.error);
    setBusy(true);
    try {
      await saveTemplate({
        data: {
          orgId: org!.id,
          name: n.value,
          description: description.trim(),
          lines: [
            { accountId: toId, amountCents: amt.value },
            { accountId: fromId, amountCents: -amt.value },
          ],
          frequency: frequency || null,
          nextDue: frequency ? nextDue : null,
        },
      });
      toast.success("Template saved");
      setName("");
      setDescription("");
      setAmount("");
      await qc.invalidateQueries({ queryKey: ["templates"] });
      await qc.invalidateQueries({ queryKey: ["due"] });
    } catch (err) {
      showError(err, "Could not save template");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    try {
      await archiveTemplate({ data: { orgId: org!.id, id } });
      toast.success("Template archived. Past transactions are unchanged.");
      await qc.invalidateQueries({ queryKey: ["templates"] });
      await qc.invalidateQueries({ queryKey: ["due"] });
    } catch (err) {
      showError(err, "Could not archive template");
    }
  }

  async function changeMode(mode: "drafts" | "reminder") {
    try {
      await setRecurringMode({ data: { orgId: org!.id, mode } });
      await qc.invalidateQueries({ queryKey: ["due"] });
      toast.success("Saved");
    } catch (err) {
      showError(err, "Could not save");
    }
  }

  const active = (templates.data ?? []).filter((t) => t.active);

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">Templates</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Save transactions you repeat, like rent or payroll. Recurring ones never post by
        themselves: you review each one and post or skip it.
      </p>

      <DueDrafts orgId={org.id} timezone={org.timezone} canWrite={canWrite} />
      {due.data?.mode === "reminder" && (due.data.items.length ?? 0) > 0 && canWrite && (
        <ul className="mt-2 space-y-1 text-sm">
          {due.data.items.map((d) => (
            <li key={`${d.templateId}:${d.dueDate}`} className="text-muted-foreground">
              {d.dueDate}: {d.templateName}, {formatCents(d.totalCents)}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && due.data && (
        <fieldset className="mt-6 rounded-lg border bg-card p-5">
          <legend className="px-1 text-sm font-semibold">When a recurring one is due</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(
              [
                ["drafts", "Add it to a Ready to review list where I post or skip it"],
                ["reminder", "Just remind me; I'll post it myself"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="recurring-mode"
                  checked={due.data.mode === v}
                  onChange={() => changeMode(v)}
                />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {canWrite && (
        <form onSubmit={create} className="mt-6 grid gap-3 rounded-lg border bg-card p-5 sm:grid-cols-2">
          <h2 className="font-display text-lg font-semibold sm:col-span-2">New template</h2>
          <label className="text-sm">
            Name
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent" />
          </label>
          <label className="text-sm">
            Description on the transaction
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Monthly rent" />
          </label>
          <label className="text-sm">
            Money comes from
            <select className={inputCls} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">Choose an account</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Money goes to
            <select className={inputCls} value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Choose an account</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Amount
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
          <label className="text-sm">
            Repeats
            <select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency | "")}>
              <option value="">Doesn't repeat</option>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{FREQ_LABEL[f]}</option>
              ))}
            </select>
          </label>
          {frequency && (
            <label className="text-sm">
              First due date
              <input type="date" className={inputCls} value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
            </label>
          )}
          <div className="sm:col-span-2">
            <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border bg-card">
        {templates.isPending ? (
          <LoadingState label="Loading templates" />
        ) : templates.isError ? (
          <ErrorState message={errorMessage(templates.error)} onRetry={() => templates.refetch()} />
        ) : active.length === 0 ? (
          <EmptyState title="No templates yet" description="Save one above for anything you record again and again." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Accounts</th>
                <th className="px-4 py-2">Repeats</th>
                <th className="px-4 py-2">Next due</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {active.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium">{t.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {t.lines.map((l) => names.get(l.accountId) ?? "").join(" / ")}
                  </td>
                  <td className="px-4 py-2.5">{t.frequency ? FREQ_LABEL[t.frequency] : "No"}</td>
                  <td className="tnum px-4 py-2.5">{t.nextDue ?? ""}</td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {formatCents(t.lines.filter((l) => l.amountCents > 0).reduce((a, l) => a + l.amountCents, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canWrite && (
                      <button onClick={() => archive(t.id)} className="text-xs text-muted-foreground hover:text-destructive">
                        Archive
                      </button>
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
