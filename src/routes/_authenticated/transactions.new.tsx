import { WriteGuard } from "@/components/WriteGuard";
import { checkAmount, checkName } from "@/lib/validation";
import { showError } from "@/lib/show-error";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { listAccounts, listCategories, listProjects, listFunds } from "@/lib/taxonomy.functions";
import { createTransaction } from "@/lib/transactions.functions";
import { parseToCents, todayISO, formatCents } from "@/lib/money";
import { safeRandomUUID } from "@/lib/utils";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Repeat,
  SlidersHorizontal,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/transactions/new")({
  head: () => ({
    meta: [
      { title: "New Transaction - OpenLedgerApp" },
      { name: "description", content: "Record money in, money out, or a transfer." },
      { property: "og:title", content: "New Transaction - OpenLedgerApp" },
      { property: "og:description", content: "Record money in, money out, or a transfer." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewTransactionPage,
});

type Mode = "in" | "out" | "transfer" | "advanced";

const MODES: Array<{ id: Mode; label: string; icon: LucideIcon }> = [
  { id: "in", label: "Money In", icon: ArrowDownToLine },
  { id: "out", label: "Money Out", icon: ArrowUpFromLine },
  { id: "transfer", label: "Transfer", icon: Repeat },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
];

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function NewTransactionPage() {
  const { org, terms, terminology } = useOrgContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("out");
  const [date, setDate] = useState(() => todayISO(new Date(), org?.timezone));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [moneyAccountId, setMoneyAccountId] = useState("");
  const [otherAccountId, setOtherAccountId] = useState("");
  const [transferToId, setTransferToId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [fundId, setFundId] = useState("");
  const [moneyInKind, setMoneyInKind] = useState<"donation" | "sale" | "other">("donation");
  const [busy, setBusy] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ["accounts", org?.id],
    queryFn: () => listAccounts({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", org?.id],
    queryFn: () => listCategories({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", org?.id],
    queryFn: () => listProjects({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const fundsQuery = useQuery({
    queryKey: ["funds", org?.id],
    queryFn: () => listFunds({ data: { orgId: org!.id } }),
    enabled: !!org,
  });

  const accounts = (accountsQuery.data ?? []).filter((account) => account.isActive);
  const moneyAccounts = accounts.filter((a) => a.type === "asset" || a.type === "liability");
  const inAccounts = accounts.filter((a) => a.type === "revenue");
  const outAccounts = accounts.filter((a) => a.type === "expense");

  // Advanced mode rows
  const [rows, setRows] = useState<
    Array<{ accountId: string; debit: string; credit: string; memo: string }>
  >([
    { accountId: "", debit: "", credit: "", memo: "" },
    { accountId: "", debit: "", credit: "", memo: "" },
  ]);

  const advancedTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of rows) {
      debit += parseToCents(r.debit) ?? 0;
      credit += parseToCents(r.credit) ?? 0;
    }
    return { debit, credit, balanced: debit === credit && debit > 0 };
  }, [rows]);

  // Same key for every retry of this form; a double click can't save twice.
  const submitKeyRef = useRef(safeRandomUUID());
  const submittingRef = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      let entries: Array<{
        accountId: string;
        amountCents: number;
        categoryId?: string | null;
        projectId?: string | null;
        fundId?: string | null;
        memo?: string | null;
      }> = [];
      let source: "manual" | "transfer" = "manual";

      if (mode === "advanced") {
        if (!advancedTotals.balanced)
          throw new Error(`${terms.debit}s and ${terms.credit.toLowerCase()}s must be equal.`);
        for (const r of rows) {
          for (const [v, label] of [
            [r.debit, terms.debit],
            [r.credit, terms.credit],
          ] as const) {
            if (!v.trim()) continue;
            const c = checkAmount(v, { allowZero: true, label });
            if (!c.ok) throw new Error(c.error);
          }
        }
        entries = rows.flatMap((r) => {
          const d = parseToCents(r.debit) ?? 0;
          const c = parseToCents(r.credit) ?? 0;
          const amt = d - c;
          if (!r.accountId || amt === 0) return [];
          return [{ accountId: r.accountId, amountCents: amt, memo: r.memo || null }];
        });
        if (entries.length < 2) throw new Error("Add at least two account lines.");
      } else {
        const amt = checkAmount(amount);
        if (!amt.ok) throw new Error(amt.error);
        const cents = amt.value;
        if (!moneyAccountId) throw new Error("Choose an account.");

        if (mode === "in") {
          if (!otherAccountId) throw new Error(`Choose where the money came from.`);
          entries = [
            { accountId: moneyAccountId, amountCents: cents },
            {
              accountId: otherAccountId,
              amountCents: -cents,
              categoryId: categoryId || null,
              projectId: projectId || null,
              fundId: fundId || null,
            },
          ];
        } else if (mode === "out") {
          if (!otherAccountId) throw new Error("Choose what the money was for.");
          entries = [
            {
              accountId: otherAccountId,
              amountCents: cents,
              categoryId: categoryId || null,
              projectId: projectId || null,
              fundId: fundId || null,
            },
            { accountId: moneyAccountId, amountCents: -cents },
          ];
        } else {
          if (!transferToId) throw new Error("Choose the destination account.");
          if (transferToId === moneyAccountId) throw new Error("Choose two different accounts.");
          source = "transfer";
          entries = [
            { accountId: transferToId, amountCents: cents },
            { accountId: moneyAccountId, amountCents: -cents },
          ];
        }
      }

      await createTransaction({
        data: {
          orgId: org.id,
          transactionDate: date,
          description: description || (mode === "transfer" ? "Transfer" : "Transaction"),
          source,
          entries,
          idempotencyKey: submitKeyRef.current,
        },
      });
      toast.success("Transaction recorded");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      navigate({ to: "/transactions" });
    } catch (err) {
      showError(err, "Could not save transaction");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (!org) return <OrgPending />;

  const selectCls = inputCls;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">New Transaction</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Record what happened. The ledger keeps both sides balanced for you.
      </p>

      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Kind of transaction">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              mode === m.id
                ? "border-primary bg-accent text-accent-foreground"
                : "border-input hover:bg-accent/50"
            }`}
          >
            <m.icon className="h-4 w-4" />
            {m.id === "advanced" && terms.levels.journal === "accounting" ? terms.journal : m.label}
          </button>
        ))}
      </div>

      <WriteGuard>
        <form onSubmit={submit} className="mt-6 max-w-2xl space-y-4 rounded-lg border bg-card p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                aria-label="Date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <input
                aria-label="Description"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  mode === "in"
                    ? "e.g. Donation from Smith family"
                    : mode === "out"
                      ? "e.g. Office supplies"
                      : "e.g. Move to savings"
                }
                className={inputCls}
              />
            </div>
          </div>

          {mode !== "advanced" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Amount</label>
                  <input
                    aria-label="Amount"
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className={`${inputCls} tnum`}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">
                    {mode === "in" ? "Deposit into" : mode === "out" ? "Paid from" : "From account"}
                  </label>
                  <select
                    aria-label={
                      mode === "in" ? "Deposit into" : mode === "out" ? "Paid from" : "From account"
                    }
                    required
                    value={moneyAccountId}
                    onChange={(e) => setMoneyAccountId(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Choose account…</option>
                    {moneyAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {mode === "transfer" ? (
                <div>
                  <label className="text-sm font-medium">To account</label>
                  <select
                    aria-label="To account"
                    required
                    value={transferToId}
                    onChange={(e) => setTransferToId(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Choose account…</option>
                    {moneyAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  {mode === "in" && org.orgType === "nonprofit" && (
                    <div className="mb-4">
                      <label className="text-sm font-medium">Type of money in</label>
                      <div className="mt-1.5 grid grid-cols-3 gap-2">
                        {(
                          [
                            {
                              id: "donation",
                              label: "Donation",
                              hint: "Given freely, nothing sold",
                              accountName: "Donations",
                            },
                            {
                              id: "sale",
                              label: "Fundraising Sale",
                              hint: "e.g. T-shirts, bake sale",
                              accountName: "Fundraising Sales",
                            },
                            {
                              id: "other",
                              label: "Other",
                              hint: "Grants, program revenue…",
                              accountName: null,
                            },
                          ] as const
                        ).map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            onClick={() => {
                              setMoneyInKind(k.id);
                              if (k.accountName) {
                                const match = inAccounts.find((a) => a.name === k.accountName);
                                if (match) setOtherAccountId(match.id);
                              }
                            }}
                            className={`rounded-md border px-3 py-2 text-left transition-colors ${
                              moneyInKind === k.id
                                ? "border-primary bg-accent"
                                : "border-input hover:bg-accent/50"
                            }`}
                          >
                            <span className="block text-sm font-medium">{k.label}</span>
                            <span className="block text-xs text-muted-foreground">{k.hint}</span>
                          </button>
                        ))}
                      </div>
                      {moneyInKind !== "other" &&
                        !inAccounts.some(
                          (a) =>
                            a.name === (moneyInKind === "sale" ? "Fundraising Sales" : "Donations"),
                        ) && (
                          <p className="mt-2 text-xs text-destructive">
                            This organization doesn't have a "
                            {moneyInKind === "sale" ? "Fundraising Sales" : "Donations"}" account
                            yet. An admin can turn it on in Settings → Accounts.
                          </p>
                        )}
                    </div>
                  )}
                  <label className="text-sm font-medium">
                    {mode === "in"
                      ? `Where it came from (${terms.revenue})`
                      : `What it was for (${terms.expenses})`}
                  </label>
                  <select
                    aria-label={mode === "in" ? "Where it came from" : "What it was for"}
                    required
                    value={otherAccountId}
                    onChange={(e) => setOtherAccountId(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Choose…</option>
                    {(mode === "in" ? inAccounts : outAccounts).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {mode !== "transfer" && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium">
                      Category <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <select
                      aria-label="Category"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className={selectCls}
                    >
                      <option value="">None</option>
                      {(categoriesQuery.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Project <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <select
                      aria-label="Project"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className={selectCls}
                    >
                      <option value="">None</option>
                      {(projectsQuery.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Fund <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <select
                      aria-label="Fund"
                      value={fundId}
                      onChange={(e) => setFundId(e.target.value)}
                      className={selectCls}
                    >
                      <option value="">None</option>
                      {(fundsQuery.data ?? []).map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {mode === "advanced" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Split a transaction across accounts. {terms.debit}s must equal{" "}
                {terms.credit.toLowerCase()}s.
              </p>
              {/* On a phone the lines are wider than the screen: they scroll sideways. */}
              <div
                className="-mx-2 overflow-x-auto px-2"
                tabIndex={0}
                role="region"
                aria-label="Lines"
              >
                <div className="min-w-[34rem] space-y-2">
                  <div className="grid grid-cols-[1fr_110px_110px_1fr_32px] gap-2 text-xs font-medium text-muted-foreground">
                    <span>Account</span>
                    <span className="text-right">{terms.debit}</span>
                    <span className="text-right">{terms.credit}</span>
                    <span>Memo</span>
                    <span></span>
                  </div>
                  {rows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_110px_110px_1fr_32px] gap-2">
                      <select
                        aria-label={`Line ${i + 1} account`}
                        value={row.accountId}
                        onChange={(e) =>
                          setRows(
                            rows.map((r, j) => (j === i ? { ...r, accountId: e.target.value } : r)),
                          )
                        }
                        className={selectCls}
                      >
                        <option value="">Choose…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Line ${i + 1} ${terms.debit}`}
                        inputMode="decimal"
                        value={row.debit}
                        onChange={(e) =>
                          setRows(
                            rows.map((r, j) =>
                              j === i ? { ...r, debit: e.target.value, credit: "" } : r,
                            ),
                          )
                        }
                        placeholder="0.00"
                        className={`${inputCls} tnum text-right`}
                      />
                      <input
                        aria-label={`Line ${i + 1} ${terms.credit}`}
                        inputMode="decimal"
                        value={row.credit}
                        onChange={(e) =>
                          setRows(
                            rows.map((r, j) =>
                              j === i ? { ...r, credit: e.target.value, debit: "" } : r,
                            ),
                          )
                        }
                        placeholder="0.00"
                        className={`${inputCls} tnum text-right`}
                      />
                      <input
                        aria-label={`Line ${i + 1} memo`}
                        value={row.memo}
                        onChange={(e) =>
                          setRows(
                            rows.map((r, j) => (j === i ? { ...r, memo: e.target.value } : r)),
                          )
                        }
                        placeholder="Optional note"
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={() => rows.length > 2 && setRows(rows.filter((_, j) => j !== i))}
                        aria-label={`Remove line ${i + 1}`}
                        className="grid min-h-8 place-items-center text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setRows([...rows, { accountId: "", debit: "", credit: "", memo: "" }])
                }
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Plus className="h-4 w-4" /> Add line
              </button>
              <div className="flex justify-end gap-6 border-t pt-3 text-sm">
                <span className="tnum">
                  {terms.debit}: {formatCents(advancedTotals.debit)}
                </span>
                <span className="tnum">
                  {terms.credit}: {formatCents(advancedTotals.credit)}
                </span>
                <span
                  className={
                    advancedTotals.balanced
                      ? "text-primary font-medium"
                      : "text-destructive font-medium"
                  }
                >
                  {advancedTotals.balanced ? "Balanced" : "Not balanced"}
                </span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || (mode === "advanced" && !advancedTotals.balanced)}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save transaction"}
          </button>
        </form>
      </WriteGuard>
    </AppShell>
  );
}
