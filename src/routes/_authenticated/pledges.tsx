import { useAccess } from "@/hooks/use-access";
import { checkAmount, checkName } from "@/lib/validation";
import { showError } from "@/lib/show-error";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { listAccounts, listFunds } from "@/lib/taxonomy.functions";
import { createPledge, listPledges, settlePledgeFn } from "@/lib/funds.functions";
import { formatCents, parseToCents, todayISO } from "@/lib/money";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pledges")({
  head: () => ({
    meta: [
      { title: "Pledges - OpenLedgerApp" },
      { name: "description", content: "Record promised gifts and track what has been paid." },
      { property: "og:title", content: "Pledges - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Record promised gifts and track what has been paid.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PledgesPage,
});

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const btnCls =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

const STATUS: Record<string, string> = { open: "Open", paid: "Paid", written_off: "Written off" };

function PledgesPage() {
  const access = useAccess();
  const { org } = useOrgContext();
  const queryClient = useQueryClient();
  const canWrite = access.can("write");

  const pledgesQuery = useQuery({
    queryKey: ["pledges", org?.id],
    queryFn: () => listPledges({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts", org?.id],
    queryFn: () => listAccounts({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const fundsQuery = useQuery({
    queryKey: ["funds", org?.id],
    queryFn: () => listFunds({ data: { orgId: org!.id } }),
    enabled: !!org,
  });

  const today = todayISO(new Date(), org?.timezone);
  const [donor, setDonor] = useState("");
  const [amount, setAmount] = useState("");
  const [fundId, setFundId] = useState("");
  const [revenueId, setRevenueId] = useState("");
  const [pledgeDate, setPledgeDate] = useState(today);
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  const [settle, setSettle] = useState<{ id: string; kind: "payment" | "write_off" } | null>(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleDate, setSettleDate] = useState(today);
  const [cashId, setCashId] = useState("");
  const [settleKey, setSettleKey] = useState(() => crypto.randomUUID());

  if (!org) return <OrgPending />;
  const accounts = (accountsQuery.data ?? []).filter((a) => a.isActive);
  const revenue = accounts.filter((a) => a.type === "revenue");
  const cash = accounts.filter((a) => a.type === "asset" && a.subtype !== "pledges_receivable");
  const pledges = pledgesQuery.data ?? [];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["pledges"] });
    queryClient.invalidateQueries({ queryKey: ["fund-summary"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = checkAmount(amount);
    if (!amt.ok) {
      toast.error(amt.error);
      return;
    }
    const cents = amt.value;
    const rev = revenueId || revenue[0]?.id;
    if (!rev) {
      toast.error("Turn on an income account first.");
      return;
    }
    setBusy(true);
    try {
      await createPledge({
        data: {
          orgId: org!.id,
          donorName: donor,
          fundId: fundId || null,
          revenueAccountId: rev,
          amountCents: cents,
          pledgeDate,
          expectedDate: expected || null,
          note: note || null,
          idempotencyKey: key,
        },
      });
      toast.success("Pledge recorded");
      setDonor("");
      setAmount("");
      setNote("");
      setExpected("");
      setKey(crypto.randomUUID());
      refresh();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitSettle(e: React.FormEvent) {
    e.preventDefault();
    if (!settle) return;
    const amt = checkAmount(settleAmount);
    if (!amt.ok) {
      toast.error(amt.error);
      return;
    }
    const cents = amt.value;
    setBusy(true);
    try {
      await settlePledgeFn({
        data: {
          orgId: org!.id,
          pledgeId: settle.id,
          kind: settle.kind,
          amountCents: cents,
          cashAccountId: settle.kind === "payment" ? cashId || cash[0]?.id || null : null,
          date: settleDate,
          idempotencyKey: settleKey,
        },
      });
      toast.success(settle.kind === "payment" ? "Payment recorded" : "Pledge written off");
      setSettle(null);
      setSettleAmount("");
      setSettleKey(crypto.randomUUID());
      refresh();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Pledges</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A pledge is a promised gift. It counts as income when promised, and is tracked until
            paid.
          </p>
        </div>
        <Link to="/funds" className="text-sm font-medium text-primary hover:underline">
          Back to funds
        </Link>
      </div>

      {canWrite && (
        <form
          onSubmit={submit}
          className="mt-6 grid gap-3 rounded-lg border bg-card p-5 sm:grid-cols-3"
        >
          <h2 className="font-display text-lg font-semibold sm:col-span-3">Record a pledge</h2>
          <label className="text-sm">
            Donor
            <input
              required
              value={donor}
              onChange={(e) => setDonor(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="text-sm">
            Amount
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="text-sm">
            Fund
            <select value={fundId} onChange={(e) => setFundId(e.target.value)} className={inputCls}>
              <option value="">No fund (unrestricted)</option>
              {(fundsQuery.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.is_restricted ? " (restricted)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Income account
            <select
              value={revenueId}
              onChange={(e) => setRevenueId(e.target.value)}
              className={inputCls}
            >
              {revenue.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Date promised
            <input
              type="date"
              required
              value={pledgeDate}
              onChange={(e) => setPledgeDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="text-sm">
            Expected by
            <input
              type="date"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy} className={btnCls}>
              Record pledge
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 rounded-lg border bg-card p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2">Donor</th>
                <th className="py-2">Fund</th>
                <th className="py-2">Promised</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Paid</th>
                <th className="py-2 text-right">Still owed</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {pledges.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 font-medium">{p.donorName}</td>
                  <td className="py-2">{p.fundName ?? "Unrestricted"}</td>
                  <td className="py-2">{p.pledgeDate}</td>
                  <td className="py-2 text-right tabular-nums">{formatCents(p.amountCents)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCents(p.paidCents)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(p.outstandingCents)}
                  </td>
                  <td className="py-2">{STATUS[p.status]}</td>
                  <td className="space-x-3 py-2 text-right whitespace-nowrap">
                    {canWrite && p.status === "open" && (
                      <>
                        <button
                          className="text-xs font-medium text-primary hover:underline"
                          onClick={() => {
                            setSettle({ id: p.id, kind: "payment" });
                            setSettleAmount((p.outstandingCents / 100).toFixed(2));
                          }}
                        >
                          Record payment
                        </button>
                        <button
                          className="text-xs font-medium text-muted-foreground hover:underline"
                          onClick={() => {
                            setSettle({ id: p.id, kind: "write_off" });
                            setSettleAmount((p.outstandingCents / 100).toFixed(2));
                          }}
                        >
                          Write off
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {pledges.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 text-muted-foreground">
                    No pledges yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {settle && (
          <form
            onSubmit={submitSettle}
            className="mt-4 grid gap-3 rounded-md border p-4 sm:grid-cols-4"
          >
            <div className="text-sm font-medium sm:col-span-4">
              {settle.kind === "payment" ? "Record a payment" : "Write off what is left"}
            </div>
            <label className="text-sm">
              Amount
              <input
                required
                inputMode="decimal"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="text-sm">
              Date
              <input
                type="date"
                required
                value={settleDate}
                onChange={(e) => setSettleDate(e.target.value)}
                className={inputCls}
              />
            </label>
            {settle.kind === "payment" && (
              <label className="text-sm">
                Money went to
                <select
                  value={cashId}
                  onChange={(e) => setCashId(e.target.value)}
                  className={inputCls}
                >
                  {cash.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-end gap-2">
              <button type="submit" disabled={busy} className={btnCls}>
                Save
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm"
                onClick={() => setSettle(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
