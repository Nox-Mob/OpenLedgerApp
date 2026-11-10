import { errorMessage } from "@/lib/errors";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BookOpen, Building2, HeartHandshake } from "lucide-react";
import { createOrganization, setUpOrganizationBooks } from "@/lib/org.functions";
import { useOrgContext } from "@/hooks/use-org-context";
import { z } from "zod";
import { setStoredOrgId } from "@/lib/current-org";
import { isDesktop, LOCAL_USER_ID } from "@/lib/edition";
import { catalogFor } from "@/lib/account-catalog";
import { getTerms } from "@/lib/terminology";
import { AccountChecklist } from "@/components/AccountChecklist";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Organization Setup - OpenLedgerApp" },
      {
        name: "description",
        content:
          "Create your organization, choose your accounts, and pick how the app talks to you.",
      },
      { property: "og:title", content: "Organization Setup - OpenLedgerApp" },
      {
        property: "og:description",
        content:
          "Create your organization, choose your accounts, and pick how the app talks to you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // ?org=<id>: set up the books of an organization created in OpenAppHub.
  validateSearch: z.object({ org: z.string().uuid().optional() }),
  component: OnboardingPage,
});

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "SEK", "NOK", "DKK", "CHF"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const LEVELS = [
  { id: "simplest", label: "Simplest", hint: '"Money you have", "Money in / out"' },
  { id: "simple", label: "Simple", hint: '"Accounts", "Income", "Expenses"' },
  { id: "accounting", label: "Double-entry", hint: '"Assets", "Revenue", "Debits / Credits"' },
] as const;
const STEPS = ["Organization", "Accounts", "Display"];
const inputCls =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function OnboardingPage() {
  const { org: existingOrgId } = Route.useSearch();
  const { orgs } = useOrgContext();
  const existing = existingOrgId ? orgs.find((o) => o.id === existingOrgId) : undefined;
  const [step, setStep] = useState(0);
  const [typedName, setName] = useState("");
  const name = existing?.name ?? typedName;
  const [orgType, setOrgType] = useState<"nonprofit" | "business">("business");
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const [terminology, setTerminology] = useState<"simplest" | "simple" | "accounting">("simplest");
  const [currency, setCurrency] = useState("USD");
  const [fyMonth, setFyMonth] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const catalog = catalogFor(orgType);
  const keys =
    picked[orgType] ?? new Set(catalog.filter((c) => c.defaultOn || c.required).map((c) => c.key));
  const terms = useMemo(() => getTerms(orgType, terminology, {}), [orgType, terminology]);

  function toggle(key: string, on: boolean) {
    const next = new Set(keys);
    if (on) next.add(key);
    else next.delete(key);
    setPicked({ ...picked, [orgType]: next });
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const input = {
        name,
        orgType,
        accountKeys: [...keys],
        currency,
        fiscalYearStartMonth: fyMonth,
        terminology,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      let id: string;
      if (isDesktop()) {
        const [{ localRepos }, { createOrganizationWithAccounts }] = await Promise.all([
          import("@/lib/desktop/local-repos"),
          import("@/lib/services/organizations"),
        ]);
        id = await createOrganizationWithAccounts(await localRepos(), LOCAL_USER_ID, input);
      } else if (existingOrgId) {
        const { name: _name, ...books } = input;
        ({ id } = await setUpOrganizationBooks({ data: { orgId: existingOrgId, ...books } }));
      } else {
        ({ id } = await createOrganization({ data: input }));
      }
      setStoredOrgId(id);
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      navigate({ to: "/ledger" });
    } catch (err) {
      setError(errorMessage(err, "Could not create organization"));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-primary" />
          <h1 className="font-display mt-3 text-2xl font-bold">Set up your organization</h1>
          <ol className="mt-4 flex justify-center gap-2 text-xs">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={`rounded-full border px-3 py-1 ${i === step ? "border-primary bg-accent font-medium" : "text-muted-foreground"}`}
              >
                {i + 1}. {s}
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {step === 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStep(1);
              }}
            >
              <label className="block text-sm font-medium">Organization name</label>
              <input
                aria-label="Organization name"
                required
                value={name}
                readOnly={!!existingOrgId}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Riverside Community Kitchen"
                className={inputCls}
              />
              <div className="mt-5 grid grid-cols-2 gap-3">
                {(
                  [
                    {
                      id: "business",
                      icon: Building2,
                      label: "Small Business",
                      hint: "Profit & loss, owner's equity",
                    },
                    {
                      id: "nonprofit",
                      icon: HeartHandshake,
                      label: "Nonprofit",
                      hint: "Funds, net assets, grants",
                    },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOrgType(o.id)}
                    className={`rounded-md border p-4 text-left transition-colors ${orgType === o.id ? "border-primary bg-accent" : "border-input hover:bg-accent/50"}`}
                  >
                    <o.icon className="h-5 w-5 text-primary" />
                    <div className="mt-2 text-sm font-medium">{o.label}</div>
                    <div className="text-xs text-muted-foreground">{o.hint}</div>
                  </button>
                ))}
              </div>
              <button
                type="submit"
                className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Next: choose accounts
              </button>
            </form>
          )}

          {step === 1 && (
            <div>
              <p className="mb-4 text-sm text-muted-foreground">
                Tick the accounts you want. You can change these any time in Settings → Accounts.
              </p>
              <AccountChecklist
                terms={terms}
                rows={catalog.map((c) => ({
                  id: c.key,
                  name: c.name,
                  type: c.type,
                  catalog: c,
                  checked: !!c.required || keys.has(c.key),
                  locked: c.required ? "Required" : null,
                }))}
                onToggle={(r, on) => toggle(r.id, on)}
              />
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setStep(0)}
                  className="flex-1 rounded-md border px-4 py-2 text-sm"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Next: display
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <span className="text-sm font-medium">Wording</span>
                <p className="text-xs text-muted-foreground">
                  How the app and reports talk to everyone. The books are always proper double-entry
                  underneath.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {LEVELS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setTerminology(l.id)}
                      className={`rounded-md border p-3 text-left ${terminology === l.id ? "border-primary bg-accent" : "border-input hover:bg-accent/50"}`}
                    >
                      <div className="text-sm font-medium">{l.label}</div>
                      <div className="text-xs text-muted-foreground">{l.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Currency</label>
                  <select
                    aria-label="Currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className={inputCls}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Fiscal year starts</label>
                  <select
                    aria-label="Fiscal year starts"
                    value={fyMonth}
                    onChange={(e) => setFyMonth(Number(e.target.value))}
                    className={inputCls}
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 rounded-md border px-4 py-2 text-sm"
                >
                  Back
                </button>
                <button
                  onClick={finish}
                  disabled={busy}
                  className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create organization"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
