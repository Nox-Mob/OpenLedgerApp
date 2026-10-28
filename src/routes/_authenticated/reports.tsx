import { showError } from "@/lib/show-error";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, OrgPending } from "@/components/AppShell";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  incomeStatement,
  balanceSheet,
  trialBalance,
  generalLedger,
} from "@/lib/reports.functions";
import { getFundActivity } from "@/lib/funds.functions";
import { budgetVsActual } from "@/lib/budgets.functions";
import { periodStartFor } from "@/lib/domain/budgets";
import { fiscalYearStart } from "@/lib/dates";
import { formatCents, todayISO } from "@/lib/money";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { FundReport, LedgerReport, StatementCheckReport } from "@/components/DetailReports";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports - OpenLedgerApp" },
      {
        name: "description",
        content: "Financial statements, general ledger, fund and statement check reports.",
      },
      { property: "og:title", content: "Reports - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Financial statements, general ledger, fund and statement check reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

const inputCls =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

function ReportTable({
  rows,
  total,
  totalLabel,
  onPick,
}: {
  rows: Array<{ name: string; totalCents: number }>;
  total: number;
  totalLabel: string;
  onPick?: (name: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-b last:border-0">
            <td className="px-4 py-2.5">
              <AccountLink name={r.name} onPick={onPick} />
            </td>
            <td className="tnum px-4 py-2.5 text-right">{formatCents(r.totalCents)}</td>
          </tr>
        ))}
        <tr className="bg-muted/50 font-semibold">
          <td className="px-4 py-2.5">{totalLabel}</td>
          <td className="tnum px-4 py-2.5 text-right">{formatCents(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Account names open the account activity behind the total. */
function AccountLink({
  name,
  onPick,
}: {
  name: string;
  onPick?: ((n: string) => void) | undefined;
}) {
  if (!onPick) return <>{name}</>;
  return (
    <button
      type="button"
      onClick={() => onPick(name)}
      className="text-left underline decoration-dotted underline-offset-4 hover:text-primary"
      title={`See the transactions behind ${name}`}
    >
      {name}
    </button>
  );
}

type Tab = "income" | "balance" | "trial" | "ledger" | "funds" | "statement";

function ReportsPage() {
  const { org, reportTerms: terms, terminology } = useOrgContext();
  const [tab, setTab] = useState<Tab>("income");
  const yearStart = fiscalYearStart(
    todayISO(new Date(), org?.timezone),
    org?.fiscalYearStartMonth ?? 1,
  );
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(todayISO(new Date(), org?.timezone));
  const [asOf, setAsOf] = useState(todayISO(new Date(), org?.timezone));
  const [ledgerFrom, setLedgerFrom] = useState(yearStart);
  const [ledgerTo, setLedgerTo] = useState(todayISO(new Date(), org?.timezone));
  const [accountName, setAccountName] = useState("");
  /** Drill-down: open account activity for the same period as the report clicked. */
  function drill(name: string, f: string, t: string) {
    setAccountName(name);
    setLedgerFrom(f);
    setLedgerTo(t);
    setTab("ledger");
  }
  const drillIncome = (n: string) => drill(n, from, to);
  const drillAsOf = (n: string) =>
    drill(n, fiscalYearStart(asOf, org?.fiscalYearStartMonth ?? 1), asOf);

  const incomeQuery = useQuery({
    queryKey: ["income", org?.id, from, to],
    queryFn: () => incomeStatement({ data: { orgId: org!.id, from, to } }),
    enabled: !!org && tab === "income",
  });
  const balanceQuery = useQuery({
    queryKey: ["balance", org?.id, asOf],
    queryFn: () => balanceSheet({ data: { orgId: org!.id, asOf } }),
    enabled: !!org && tab === "balance",
  });
  const trialQuery = useQuery({
    queryKey: ["trial", org?.id, asOf],
    queryFn: () => trialBalance({ data: { orgId: org!.id, asOf } }),
    enabled: !!org && tab === "trial",
  });

  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  if (!org) return <OrgPending />;

  const income = incomeQuery.data;
  const balance = balanceQuery.data;

  async function exportPdf() {
    if (!org) return;
    setExporting(true);
    try {
      const pdf = await import("@/lib/report-pdf");
      if (tab === "income" && income)
        await pdf.exportIncomePdf({ org, terms, pref: terminology, from, to, data: income });
      else if (tab === "balance" && balance)
        await pdf.exportBalancePdf({ org, terms, pref: terminology, asOf, data: balance });
    } catch (e) {
      showError(e, "Could not create PDF", "No file was created.");
    } finally {
      setExporting(false);
    }
  }

  async function exportSheet(kind: "csv" | "xlsx") {
    if (!org) return;
    const ex = await import("@/lib/export");
    const s = await import("@/lib/report-sheets");
    const sheet =
      tab === "income" && income
        ? s.incomeSheet(terms.incomeStatement, income, terms)
        : tab === "balance" && balance
          ? s.balanceSheetSheet(terms.balanceSheet, balance, terms)
          : tab === "trial" && trialQuery.data
            ? s.trialSheet(trialQuery.data, terms.trialBalance)
            : null;
    if (!sheet) return;
    const base = ex.safeFileName(
      `${org.name}-${sheet.name}-${tab === "income" ? `${from}-to-${to}` : asOf}`,
    );
    try {
      if (kind === "csv") ex.downloadCsv(sheet, `${base}.csv`);
      else await ex.downloadXlsx([sheet], `${base}.xlsx`, org.currency);
    } catch (e) {
      showError(e, "Could not export", "No file was created.");
    }
  }
  /** Every report in one Excel workbook, one sheet each, using the dates on screen. */
  async function exportAll(kind: "xlsx" | "pdf" = "xlsx") {
    if (!org) return;
    setExportingAll(true);
    try {
      const orgId = org.id;
      const [inc, bal, tb, gl, fa] = await Promise.all([
        incomeStatement({ data: { orgId, from, to } }),
        balanceSheet({ data: { orgId, asOf } }),
        trialBalance({ data: { orgId, asOf } }),
        generalLedger({ data: { orgId, from, to } }),
        org.orgType === "nonprofit" ? getFundActivity({ data: { orgId, from, to } }) : null,
      ]);
      const ex = await import("@/lib/export");
      const s = await import("@/lib/report-sheets");
      const sheets = [
        s.incomeSheet(terms.incomeStatement, inc, terms),
        s.balanceSheetSheet(terms.balanceSheet, bal, terms),
        s.trialSheet(tb, terms.trialBalance),
        s.ledgerSheet(terms.generalLedger, gl.accounts),
        ...(fa ? [s.fundActivitySheet(fa.funds, terms.fundActivity)] : []),
      ];
      const base = ex.safeFileName(`${org.name}-all-reports-${from}-to-${to}`);
      if (kind === "pdf") {
        const pdf = await import("@/lib/report-pdf");
        await pdf.exportAllPdf({
          org,
          pref: terminology,
          subtitle: `${from} to ${to}, balances as of ${asOf} · Cash basis`,
          sheets,
          fileName: `${base}.pdf`,
        });
      } else await ex.downloadXlsx(sheets, `${base}.xlsx`, org.currency);
      toast.success("All reports exported");
    } catch (e) {
      showError(e, "Could not export all reports", "No file was created.");
    } finally {
      setExportingAll(false);
    }
  }
  /** Board package: cover, income, balance, budget vs actual, fund activity, one PDF. */
  async function boardPackage() {
    if (!org) return;
    setExportingAll(true);
    try {
      const orgId = org.id;
      const nonprofit = org.orgType === "nonprofit";
      const [inc, bal, bud, fa] = await Promise.all([
        incomeStatement({ data: { orgId, from, to } }),
        balanceSheet({ data: { orgId, asOf } }),
        budgetVsActual({
          data: {
            orgId,
            periodType: "year",
            periodStart: periodStartFor("year", from, org.fiscalYearStartMonth),
          },
        }),
        nonprofit ? getFundActivity({ data: { orgId, from, to } }).catch(() => null) : null,
      ]);
      const s = await import("@/lib/report-sheets");
      const ex = await import("@/lib/export");
      const pdf = await import("@/lib/report-pdf");
      const body = [
        s.incomeSheet(terms.incomeStatement, inc, terms),
        s.balanceSheetSheet(terms.balanceSheet, bal, terms),
        s.budgetSheet("Budget vs actual", bud.lines, terms),
        ...(fa ? [s.fundActivitySheet(fa.funds, terms.fundActivity)] : []),
      ];
      const period = `${from} to ${to}, balances as of ${asOf}`;
      await pdf.exportAllPdf({
        org,
        pref: terminology,
        subtitle: `${period} · Cash basis`,
        sheets: [
          s.coverSheet(
            org.name,
            period,
            body.map((b) => b.name),
          ),
          ...body,
        ],
        fileName: `${ex.safeFileName(`${org.name}-board-package-${from}-to-${to}`)}.pdf`,
      });
      toast.success("Board package created");
    } catch (e) {
      showError(e, "Could not create the board package", "No file was created.");
    } finally {
      setExportingAll(false);
    }
  }
  const sheetReady =
    tab === "income" ? !!income : tab === "balance" ? !!balance : !!trialQuery.data;
  const detail = tab === "ledger" || tab === "funds" || tab === "statement";
  const tabs: [Tab, string][] = [
    ["income", terms.incomeStatement],
    ["balance", terms.balanceSheet],
    ["trial", terms.trialBalance],
    ["ledger", terms.generalLedger],
    ...(org.orgType === "nonprofit" ? ([["funds", terms.fundActivity]] as [Tab, string][]) : []),
    ["statement", terms.statementCheck],
  ];
  const btn =
    "inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50";

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Reports</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={boardPackage}
            disabled={exportingAll}
            className={btn}
            title="One PDF for your board: income, balance, budget vs actual and funds"
          >
            <Download className="h-4 w-4" />
            {exportingAll ? "Preparing…" : "Board package (PDF)"}
          </button>
          <button
            onClick={() => exportAll("xlsx")}
            disabled={exportingAll}
            className={btn}
            title="One Excel file with every report, using the dates you picked"
          >
            <Download className="h-4 w-4" />
            {exportingAll ? "Preparing…" : "Export all (Excel)"}
          </button>
          <button
            onClick={() => exportAll("pdf")}
            disabled={exportingAll}
            className={btn}
            title="One PDF with every report, each on its own page"
          >
            <Download className="h-4 w-4" />
            {exportingAll ? "Preparing…" : "Export all (PDF)"}
          </button>
        </div>
        <div className={`flex flex-wrap gap-2 ${detail ? "hidden" : ""}`}>
          <button onClick={() => exportSheet("csv")} disabled={!sheetReady} className={btn}>
            CSV
          </button>
          <button onClick={() => exportSheet("xlsx")} disabled={!sheetReady} className={btn}>
            Excel
          </button>
          <button
            onClick={exportPdf}
            disabled={exporting || tab === "trial" || (tab === "income" ? !income : !balance)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Preparing…" : "Export PDF"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-md border px-4 py-2 text-sm font-medium ${tab === k ? "border-primary bg-accent" : "border-input hover:bg-accent/50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {!detail && (
        <p className="mt-2 text-xs text-muted-foreground">
          {tab === "income" ? `${from} to ${to}` : `As of ${asOf}`} · Cash basis · voided
          transactions are excluded. Click an account to see its transactions.
        </p>
      )}
      {tab === "ledger" && (
        <LedgerReport
          org={org}
          terms={terms}
          pref={terminology}
          from={ledgerFrom}
          to={ledgerTo}
          setFrom={setLedgerFrom}
          setTo={setLedgerTo}
          accountName={accountName}
          setAccountName={setAccountName}
        />
      )}
      {tab === "funds" && (
        <FundReport
          org={org}
          terms={terms}
          pref={terminology}
          from={ledgerFrom}
          to={ledgerTo}
          setFrom={setLedgerFrom}
          setTo={setLedgerTo}
        />
      )}
      {tab === "statement" && <StatementCheckReport org={org} terms={terms} pref={terminology} />}

      {(tab === "balance" || tab === "trial") && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <label className="text-muted-foreground">As of</label>
          <input
            aria-label="As of"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className={inputCls}
          />
        </div>
      )}

      {tab === "income" && (
        <div className="mt-6 max-w-2xl">
          <div className="flex items-center gap-3 text-sm">
            <label className="text-muted-foreground">From</label>
            <input
              aria-label="From"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputCls}
            />
            <label className="text-muted-foreground">To</label>
            <input
              aria-label="To"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputCls}
            />
          </div>

          <div className="mt-4 space-y-4">
            <div className="overflow-hidden rounded-lg border bg-card">
              <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
                {terms.revenue}
              </h2>
              <ReportTable
                onPick={drillIncome}
                rows={income?.revenue ?? []}
                total={income?.totalRevenueCents ?? 0}
                totalLabel={`Total ${terms.revenue.toLowerCase()}`}
              />
            </div>
            <div className="overflow-hidden rounded-lg border bg-card">
              <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
                {terms.expenses}
              </h2>
              <ReportTable
                onPick={drillIncome}
                rows={income?.expenses ?? []}
                total={income?.totalExpensesCents ?? 0}
                totalLabel={`Total ${terms.expenses.toLowerCase()}`}
              />
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-semibold">{terms.netIncome}</span>
                <span
                  className={`tnum text-lg font-semibold ${(income?.netCents ?? 0) < 0 ? "text-destructive" : "text-primary"}`}
                >
                  {formatCents(income?.netCents ?? 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "balance" && balance && (
        <div className="mt-6 max-w-2xl space-y-4">
          <div className="overflow-hidden rounded-lg border bg-card">
            <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">Assets</h2>
            <ReportTable
              onPick={drillAsOf}
              rows={balance.assets}
              total={balance.totalAssetsCents}
              totalLabel="Total assets"
            />
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">Liabilities</h2>
            <ReportTable
              onPick={drillAsOf}
              rows={balance.liabilities}
              total={balance.totalLiabilitiesCents}
              totalLabel="Total liabilities"
            />
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">{terms.equity}</h2>
            <table className="w-full text-sm">
              <tbody>
                {balance.equity.map((r) => (
                  <tr key={r.name} className="border-b">
                    <td className="px-4 py-2.5">
                      <AccountLink name={r.name} onPick={drillAsOf} />
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">{formatCents(r.totalCents)}</td>
                  </tr>
                ))}
                <tr className="border-b">
                  <td className="px-4 py-2.5 italic text-muted-foreground">
                    {org.orgType === "nonprofit"
                      ? "Net assets from prior years"
                      : "Retained earnings (prior years)"}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {formatCents(balance.retainedEarningsCents)}
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2.5 italic text-muted-foreground">
                    {terms.netIncome} (this fiscal year)
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {formatCents(balance.netIncomeCents)}
                  </td>
                </tr>
                <tr className="bg-muted/50 font-semibold">
                  <td className="px-4 py-2.5">Total {terms.equity.toLowerCase()}</td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {formatCents(balance.totalEquityCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Check: assets {formatCents(balance.totalAssetsCents)} = liabilities{" "}
            {formatCents(balance.totalLiabilitiesCents)} + {terms.equity.toLowerCase()}{" "}
            {formatCents(balance.totalEquityCents)}
          </p>
        </div>
      )}

      {tab === "trial" && trialQuery.data && (
        <div className="mt-6 max-w-2xl overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2 text-right">Debit</th>
                <th className="px-4 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {trialQuery.data.lines.map((l) => (
                <tr key={l.type + l.name} className="border-b">
                  <td className="px-4 py-2.5">
                    <AccountLink name={l.name} onPick={drillAsOf} />
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {l.debitCents ? formatCents(l.debitCents) : ""}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right">
                    {l.creditCents ? formatCents(l.creditCents) : ""}
                  </td>
                </tr>
              ))}
              <tr className="bg-muted/50 font-semibold">
                <td className="px-4 py-2.5">
                  Totals {trialQuery.data.balanced ? "(balanced)" : "(NOT balanced)"}
                </td>
                <td className="tnum px-4 py-2.5 text-right">
                  {formatCents(trialQuery.data.totalDebitCents)}
                </td>
                <td className="tnum px-4 py-2.5 text-right">
                  {formatCents(trialQuery.data.totalCreditCents)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
