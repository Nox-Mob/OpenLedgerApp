import { WriteGuard } from "@/components/WriteGuard";
import { checkAmount, checkName } from "@/lib/validation";
import { showError } from "@/lib/show-error";
import { EmptyState, ErrorState, LoadingState } from "@/components/PageStates";
import { errorMessage } from "@/lib/errors";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import { listAccounts, createAccount, setOpeningBalance } from "@/lib/taxonomy.functions";
import { formatCents, parseToCents, todayISO } from "@/lib/money";
import { accountTypeLabel, displayBalance } from "@/lib/terminology";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({
    meta: [
      { title: "Accounts - OpenLedgerApp" },
      { name: "description", content: "Your chart of accounts and balances." },
      { property: "og:title", content: "Accounts - OpenLedgerApp" },
      { property: "og:description", content: "Your chart of accounts and balances." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountsPage,
});

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function AccountsPage() {
  const { org, terms } = useOrgContext();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("asset");
  const [opening, setOpening] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["accounts", org?.id],
    queryFn: () => listAccounts({ data: { orgId: org!.id, includeArchived: true } }),
    enabled: !!org,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    const n = checkName(name, "Account name");
    if (!n.ok) return void toast.error(n.error);
    if (opening.trim()) {
      const o = checkAmount(opening, { allowZero: true, label: "Opening balance" });
      if (!o.ok) return void toast.error(o.error);
    }
    try {
      await createAccount({
        data: {
          orgId: org.id,
          name,
          type: type as "asset" | "liability" | "equity" | "revenue" | "expense",
        },
      });
      const cents = parseToCents(opening);
      if (cents && cents !== 0 && (type === "asset" || type === "liability")) {
        const accounts = accountsQuery.data ?? [];
        const equity = accounts.find((a) => a.type === "equity" && a.isActive);
        if (equity) {
          const { data: fresh } = await accountsQuery.refetch();
          const newAcc = (fresh ?? []).find((a) => a.name === name);
          if (newAcc) {
            await setOpeningBalance({
              data: {
                orgId: org.id,
                accountId: newAcc.id,
                equityAccountId: equity.id,
                amountCents: type === "liability" ? -cents : cents,
                date: todayISO(new Date(), org?.timezone),
              },
            });
          }
        }
      }
      toast.success("Account created");
      setName("");
      setOpening("");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) {
      showError(err, "Could not create account");
    }
  }

  if (!org) return <OrgPending />;

  const accounts = accountsQuery.data ?? [];
  const groups = ["asset", "liability", "equity", "revenue", "expense"]
    .map((t) => ({ type: t, accounts: accounts.filter((a) => a.type === t) }))
    .filter((g) => g.accounts.length > 0);

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Accounts</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Accounts are the buckets your money is sorted into: bank accounts and cash you have,
            cards and loans you owe, and the kinds of money coming in and going out. Every
            transaction moves money between two or more of them, so pick the account that best
            describes where money came from and where it went. Archive an account you no longer use
            instead of deleting it, so past reports stay correct.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add Account
        </button>
      </div>

      {showForm && (
        <WriteGuard>
          <form
            onSubmit={submit}
            className="mt-4 grid max-w-2xl grid-cols-4 items-end gap-3 rounded-lg border bg-card p-4"
          >
            <div className="col-span-2">
              <label className="text-sm font-medium">Name</label>
              <input
                aria-label="Name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                placeholder="e.g. PayPal"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <select
                aria-label="Type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={inputCls}
              >
                <option value="asset">{accountTypeLabel("asset", terms)}</option>
                <option value="liability">{accountTypeLabel("liability", terms)}</option>
                <option value="equity">{accountTypeLabel("equity", terms)}</option>
                <option value="revenue">{accountTypeLabel("revenue", terms)}</option>
                <option value="expense">{accountTypeLabel("expense", terms)}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Opening balance</label>
              <input
                aria-label="Opening balance"
                inputMode="decimal"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                className={`${inputCls} tnum`}
                placeholder="0.00"
              />
            </div>
            <button
              type="submit"
              className="col-span-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create account
            </button>
          </form>
        </WriteGuard>
      )}

      <div className="mt-6 space-y-6">
        {accountsQuery.isPending && <LoadingState label="Loading accounts" />}
        {accountsQuery.isError && (
          <ErrorState
            message={errorMessage(accountsQuery.error)}
            onRetry={() => accountsQuery.refetch()}
          />
        )}
        {accountsQuery.isSuccess && groups.length === 0 && (
          <EmptyState
            title="No accounts yet"
            description="Add an account above, or choose from the list in Settings, Accounts."
          />
        )}
        {groups.map((g) => (
          <div key={g.type}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {accountTypeLabel(g.type, terms)}
            </h2>
            <div className="mt-2 overflow-hidden rounded-lg border bg-card">
              <table className="w-full text-sm">
                <tbody>
                  {g.accounts.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {a.name}
                        {!a.isActive && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            Archived
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{a.subtype ?? ""}</td>
                      <td className="tnum px-4 py-3 text-right">
                        {formatCents(displayBalance(a.type, a.balanceCents))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
