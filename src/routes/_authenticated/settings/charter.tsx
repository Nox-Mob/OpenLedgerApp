// S-18: whether and how OpenCharterApp payments are offered for the books, and what was done with
// them. Owner and OpenLedgerApp admins change it; everyone with the books sees it.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { OrgPending } from "@/components/AppShell";
import { useAccess } from "@/hooks/use-access";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  getCharterImportConfig,
  listCharterImports,
  reopenCharterImport,
  saveCharterImportConfig,
} from "@/lib/charter-income.functions";
import type { CharterImportConfig } from "@/lib/services/charter-income";
import { getAccountSetup } from "@/lib/org.functions";
import { formatCents, parseToCents } from "@/lib/money";
import { showError } from "@/lib/show-error";
import { isDesktop } from "@/lib/edition";

export const Route = createFileRoute("/_authenticated/settings/charter")({
  head: () => ({
    meta: [
      { title: "OpenCharterApp payments - OpenLedgerApp" },
      {
        name: "description",
        content: "Membership dues from OpenCharterApp, reviewed before they're booked.",
      },
    ],
  }),
  component: CharterIncomeSettings,
});

type Form = Omit<CharterImportConfig, "available" | "can_change">;

const ACCOUNT_FIELDS: Array<{
  key:
    | "card_account_id"
    | "other_account_id"
    | "fee_account_id"
    | "join_account_id"
    | "renew_account_id";
  label: string;
  help: string;
  type: "asset" | "expense" | "revenue";
}> = [
  {
    key: "card_account_id",
    label: "Card payments go into",
    help: "Usually Stripe balance: payouts then move it to the bank.",
    type: "asset",
  },
  {
    key: "other_account_id",
    label: "Checks and cash go into",
    help: "Usually Undeposited funds, until you take them to the bank.",
    type: "asset",
  },
  {
    key: "fee_account_id",
    label: "Card fees",
    help: "An expense account, such as Bank and card fees.",
    type: "expense",
  },
  {
    key: "join_account_id",
    label: "New member dues",
    help: "Income from people joining.",
    type: "revenue",
  },
  {
    key: "renew_account_id",
    label: "Renewal dues",
    help: "Income from renewals. It can be the same account.",
    type: "revenue",
  },
];

function CharterIncomeSettings() {
  const { org } = useOrgContext();
  const access = useAccess();
  const qc = useQueryClient();
  const cfgQ = useQuery({
    queryKey: ["charter-config", org?.id],
    enabled: !!org && !isDesktop(),
    queryFn: () => getCharterImportConfig({ data: { orgId: org!.id } }),
  });
  const accountsQ = useQuery({
    queryKey: ["account-setup", org?.id],
    enabled: !!org,
    queryFn: () => getAccountSetup({ data: { orgId: org!.id } }),
  });
  const logQ = useQuery({
    queryKey: ["charter-imports", org?.id],
    enabled: !!org && !isDesktop(),
    queryFn: () => listCharterImports({ data: { orgId: org!.id } }),
  });
  const [form, setForm] = useState<Form | null>(null);
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cfgQ.data) return;
    const { available: _a, can_change: _c, ...rest } = cfgQ.data;
    setForm(rest);
    setFee((rest.fee_fixed_cents / 100).toFixed(2));
  }, [cfgQ.data]);

  if (!org) return <OrgPending inShell={false} />;
  if (isDesktop())
    return (
      <Card title="OpenCharterApp payments">
        <p className="text-muted-foreground">
          The desktop edition doesn't connect to OpenCharterApp. Record dues as usual.
        </p>
      </Card>
    );
  const cfg = cfgQ.data;
  if (cfgQ.isLoading || (cfg && !form))
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!cfg || !cfg.available)
    return (
      <Card title="OpenCharterApp payments">
        <p className="text-muted-foreground">
          When your organization uses OpenCharterApp for memberships, the dues people pay there can
          come here to be booked, after you review them. OpenCharterApp isn't set up here yet.
        </p>
      </Card>
    );
  const f = form!;
  const canChange = cfg.can_change && access.can("manage_settings");
  const accounts = (accountsQ.data ?? []).filter((a) => a.isActive);

  async function save(e: FormEvent) {
    e.preventDefault();
    const fixed = parseToCents(fee);
    if (fixed === null || fixed < 0 || fixed > 1000) {
      toast.error("Enter a fixed fee between $0.00 and $10.00.");
      return;
    }
    setBusy(true);
    try {
      await saveCharterImportConfig({ data: { orgId: org!.id, ...f, fee_fixed_cents: fixed } });
      toast.success(f.enabled ? "Saved. New dues will wait for you to review them." : "Saved.");
      await qc.invalidateQueries();
    } catch (err) {
      showError(err, "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function reopen(id: string) {
    try {
      await reopenCharterImport({ data: { orgId: org!.id, id } });
      toast.success("It's back in the list to review.");
      await qc.invalidateQueries();
    } catch (err) {
      showError(err, "Could not bring it back");
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...f, [k]: v });
  const select = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="max-w-2xl space-y-4">
      <Card title="OpenCharterApp payments">
        <form onSubmit={save} className="space-y-4">
          <p className="text-muted-foreground">
            Dues people pay in OpenCharterApp are offered here as drafts, one per day for card
            payments and one for checks and cash, with refunds on their own. Nothing is booked until
            someone selects <strong>Post</strong> on the home page. Each payment is booked once.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={f.enabled}
              disabled={!canChange}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            <span className="font-medium">Offer OpenCharterApp payments for review</span>
          </label>
          <fieldset className="space-y-1.5" disabled={!canChange}>
            <legend className="font-medium">Whose payments</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scope"
                checked={f.scope === "national"}
                onChange={() => set("scope", "national")}
              />
              Only those paid to the organization itself
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scope"
                checked={f.scope === "all"}
                onChange={() => set("scope", "all")}
              />
              Every chapter's too, each chapter on its own line
            </label>
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor="starts" className="font-medium">
              Starting with payments received on
            </label>
            <input
              id="starts"
              type="date"
              className="h-9 rounded-md border border-input bg-background px-2"
              value={f.starts_on}
              disabled={!canChange}
              onChange={(e) => set("starts_on", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Anything earlier isn't offered, so dues you've already entered by hand aren't booked
              twice.
            </p>
          </div>
          {ACCOUNT_FIELDS.map((a) => (
            <div key={a.key} className="space-y-1">
              <label htmlFor={a.key} className="font-medium">
                {a.label}
              </label>
              <select
                id={a.key}
                className={select}
                value={f[a.key] ?? ""}
                disabled={!canChange}
                onChange={(e) => set(a.key, e.target.value || null)}
              >
                <option value="">Choose an account</option>
                {accounts
                  .filter((x) => x.type === a.type)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {a.help}{" "}
                {a.key === "card_account_id" || a.key === "other_account_id" ? (
                  <Link to="/settings/accounts" className="underline">
                    Add an account
                  </Link>
                ) : null}
              </p>
            </div>
          ))}
          <div className="space-y-1">
            <span className="font-medium">Estimated card fee</span>
            <div className="flex items-center gap-2">
              <input
                aria-label="Percent of each card payment"
                inputMode="decimal"
                className="tnum h-9 w-20 rounded-md border border-input bg-background px-2 text-right"
                value={(f.fee_percent_bp / 100).toString()}
                disabled={!canChange}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value) * 100);
                  if (Number.isFinite(n) && n >= 0 && n <= 2000) set("fee_percent_bp", n);
                }}
              />
              % plus $
              <input
                aria-label="Fixed fee per card payment"
                inputMode="decimal"
                className="tnum h-9 w-20 rounded-md border border-input bg-background px-2 text-right"
                value={fee}
                disabled={!canChange}
                onChange={(e) => setFee(e.target.value)}
              />
              per card payment
            </div>
            <p className="text-xs text-muted-foreground">
              Stripe's standard rate is 2.9% + 30¢. The fee is an estimate: change it on a draft
              before posting to match your Stripe report.
            </p>
          </div>
          {canChange ? (
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              The owner and OpenLedgerApp admins change these.
            </p>
          )}
        </form>
      </Card>
      <Card title="What was done">
        {(logQ.data ?? []).length === 0 ? (
          <p className="text-muted-foreground">Nothing posted or skipped yet.</p>
        ) : (
          <ul className="divide-y">
            {logQ.data!.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="tnum text-muted-foreground">{r.day}</span>
                <span className="flex-1">
                  {r.kind === "refunds" ? "Refunds" : "Dues"}:{" "}
                  {r.channel === "card" ? "card" : "checks and cash"} · {r.payment_count}{" "}
                  {r.payment_count === 1 ? "payment" : "payments"}
                  {r.fee_cents ? ` · fee ${formatCents(r.fee_cents)}` : ""}
                </span>
                <span className="tnum">{formatCents(r.gross_cents)}</span>
                <span className="text-xs text-muted-foreground">
                  {r.status === "posted" ? "Posted" : "Skipped"}
                </span>
                {r.status === "skipped" && access.can("write") ? (
                  <button className="text-xs underline" onClick={() => void reopen(r.id)}>
                    Bring back
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-5 text-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
