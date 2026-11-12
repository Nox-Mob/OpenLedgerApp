// Client-only PDF export for reports. Loaded dynamically so jsPDF never runs during SSR.
import type { Terms, Terminology } from "@/lib/terminology";
import { accountTypeLabel } from "@/lib/terminology";
import type { jsPDF } from "jspdf";
import type autoTableFn from "jspdf-autotable";
import type { CellHookData } from "jspdf-autotable";

type AutoTable = typeof autoTableFn;
type DocWithTable = jsPDF & { lastAutoTable: { finalY: number } };

type Row = { name: string; totalCents: number };
interface OrgInfo {
  name: string;
  orgType: string;
  currency: string;
  fiscalYearStartMonth: number;
}

const GREEN: [number, number, number] = [34, 84, 61];
const INK: [number, number, number] = [40, 36, 30];
const MUTED: [number, number, number] = [120, 112, 100];
const PAPER: [number, number, number] = [246, 242, 233];

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
function prettyDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function setup(org: OrgInfo, title: string, subtitle: string, pref: Terminology) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, w, 6, "F");
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(org.name.toUpperCase(), 56, 60);
  doc.setTextColor(...INK);
  doc.setFont("times", "bold");
  doc.setFontSize(24);
  doc.text(title, 56, 90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text(subtitle, 56, 110);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(1);
  doc.line(56, 124, w - 56, 124);
  const fy = new Date(2000, org.fiscalYearStartMonth - 1, 1).toLocaleDateString("en-US", {
    month: "long",
  });
  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      const h = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(
        `Prepared with OpenLedgerApp · Amounts in ${org.currency} · Fiscal year starts ${fy} · Generated ${prettyDate(new Date().toISOString().slice(0, 10))}`,
        56,
        h - 32,
      );
      doc.text(`Page ${i} of ${pages}`, w - 56, h - 32, { align: "right" });
    }
  };
  return { doc, autoTable, footer };
}

function section(
  autoTable: AutoTable,
  doc: jsPDF,
  startY: number,
  heading: string,
  rows: Row[],
  totalLabel: string,
  total: number,
  currency: string,
  extra: Row[] = [],
) {
  autoTable(doc, {
    startY,
    margin: { left: 56, right: 56 },
    head: [[heading, ""]],
    body: [
      ...rows.map((r) => [r.name, money(r.totalCents, currency)]),
      ...extra.map((r) => [
        { content: r.name, styles: { fontStyle: "italic" as const, textColor: MUTED } },
        money(r.totalCents, currency),
      ]),
      ...(rows.length + extra.length === 0
        ? [
            [
              {
                content: "Nothing recorded",
                styles: { textColor: MUTED, fontStyle: "italic" as const },
              },
              "",
            ],
          ]
        : []),
    ],
    foot: [[totalLabel, money(total, currency)]],
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 10,
      textColor: INK,
      cellPadding: { top: 6, bottom: 6, left: 8, right: 8 },
    },
    headStyles: { fillColor: PAPER, textColor: GREEN, fontStyle: "bold", fontSize: 11 },
    footStyles: { fillColor: PAPER, textColor: INK, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", font: "courier" } },
    didParseCell: (d: CellHookData) => {
      if (d.column.index === 1) d.cell.styles.halign = "right";
    },
    bodyStyles: { lineColor: [225, 219, 207], lineWidth: { bottom: 0.5 } },
  });
  return (doc as DocWithTable).lastAutoTable.finalY + 18;
}

function totalBar(doc: jsPDF, y: number, label: string, value: string, negative: boolean) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...GREEN);
  doc.roundedRect(56, y, w - 112, 36, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.text(label, 68, y + 23);
  doc.setFont("courier", "bold");
  doc.text(negative ? `(${value.replace("-", "")})` : value, w - 68, y + 23, { align: "right" });
  return y + 54;
}

export async function exportIncomePdf(p: {
  org: OrgInfo;
  terms: Terms;
  pref: Terminology;
  from: string;
  to: string;
  data: {
    revenue: Row[];
    expenses: Row[];
    totalRevenueCents: number;
    totalExpensesCents: number;
    netCents: number;
  };
}) {
  const { org, terms, pref, data } = p;
  const { doc, autoTable, footer } = await setup(
    org,
    terms.incomeStatement,
    `For the period ${prettyDate(p.from)} to ${prettyDate(p.to)}`,
    pref,
  );
  let y = section(
    autoTable,
    doc,
    142,
    terms.revenue,
    data.revenue,
    `Total ${terms.revenue.toLowerCase()}`,
    data.totalRevenueCents,
    org.currency,
  );
  y = section(
    autoTable,
    doc,
    y,
    terms.expenses,
    data.expenses,
    `Total ${terms.expenses.toLowerCase()}`,
    data.totalExpensesCents,
    org.currency,
  );
  totalBar(doc, y, terms.netIncome, money(data.netCents, org.currency), data.netCents < 0);
  footer();
  doc.save(`${org.name} - ${terms.incomeStatement} ${p.from} to ${p.to}.pdf`);
}

export async function exportBalancePdf(p: {
  org: OrgInfo;
  terms: Terms;
  pref: Terminology;
  asOf: string;
  data: {
    assets: Row[];
    liabilities: Row[];
    equity: Row[];
    netIncomeCents: number;
    retainedEarningsCents: number;
    totalAssetsCents: number;
    totalLiabilitiesCents: number;
    totalEquityCents: number;
  };
}) {
  const { org, terms, pref, data } = p;
  const { doc, autoTable, footer } = await setup(
    org,
    terms.balanceSheet,
    `As of ${prettyDate(p.asOf)}`,
    pref,
  );
  const assetsL = accountTypeLabel("asset", terms);
  const liabL = accountTypeLabel("liability", terms);
  let y = section(
    autoTable,
    doc,
    142,
    assetsL,
    data.assets,
    `Total ${assetsL.toLowerCase()}`,
    data.totalAssetsCents,
    org.currency,
  );
  y = section(
    autoTable,
    doc,
    y,
    liabL,
    data.liabilities,
    `Total ${liabL.toLowerCase()}`,
    data.totalLiabilitiesCents,
    org.currency,
  );
  y = section(
    autoTable,
    doc,
    y,
    terms.equity,
    data.equity,
    `Total ${terms.equity.toLowerCase()}`,
    data.totalEquityCents,
    org.currency,
    [
      {
        name:
          org.orgType === "nonprofit"
            ? "Net assets from prior years"
            : "Retained earnings (prior years)",
        totalCents: data.retainedEarningsCents,
      },
      { name: `${terms.netIncome} (this fiscal year)`, totalCents: data.netIncomeCents },
    ],
  );
  const label =
    terms.levels.liabilities === "accounting"
      ? `Total ${liabL.toLowerCase()} & ${terms.equity.toLowerCase()}`
      : `What you owe + ${terms.equity.toLowerCase()}`;
  const sum = data.totalLiabilitiesCents + data.totalEquityCents;
  y = totalBar(doc, y, label, money(sum, org.currency), sum < 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const ok = sum === data.totalAssetsCents;
  doc.text(
    ok
      ? terms.levels.assets === "accounting"
        ? "Balanced: assets equal liabilities plus equity."
        : "Everything adds up: what you have equals what you owe plus what's yours."
      : "Warning: totals do not balance.",
    56,
    y,
  );
  footer();
  doc.save(`${org.name} - ${terms.balanceSheet} ${p.asOf}.pdf`);
}

/** Any tabular report as a PDF. Number cells are cents and print as money. */
export async function exportTablePdf(p: {
  org: OrgInfo;
  pref: Terminology;
  title: string;
  subtitle: string;
  head: string[];
  body: (string | number)[][];
  fileName: string;
}) {
  const { doc, autoTable, footer } = await setup(p.org, p.title, p.subtitle, p.pref);
  autoTable(doc, {
    startY: 142,
    margin: { left: 56, right: 56 },
    head: [p.head],
    body: p.body.map((r) => r.map((v) => (typeof v === "number" ? money(v, p.org.currency) : v))),
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8, textColor: INK, cellPadding: 4 },
    headStyles: { fillColor: PAPER, textColor: GREEN, fontStyle: "bold" },
    didParseCell: (d: CellHookData) => {
      if (typeof p.body[d.row.index]?.[d.column.index] === "number" && d.section === "body")
        d.cell.styles.halign = "right";
    },
    bodyStyles: { lineColor: [225, 219, 207], lineWidth: { bottom: 0.5 } },
  });
  footer();
  doc.save(p.fileName);
}

/** Every report in one PDF, each starting on its own page. Number cells are whole currency units. */
export async function exportAllPdf(p: {
  org: OrgInfo;
  pref: Terminology;
  subtitle: string;
  sheets: { name: string; rows: (string | number | null | undefined)[][] }[];
  fileName: string;
  /** "save" (default) downloads the file; "blob" returns it (e.g. for a board package). */
  output?: "save" | "blob";
}): Promise<Blob | undefined> {
  const first = p.sheets[0];
  const { doc, autoTable, footer } = await setup(
    p.org,
    first?.name ?? "Reports",
    p.subtitle,
    p.pref,
  );
  const fmt = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: p.org.currency }).format(v);
  p.sheets.forEach((sheet, i) => {
    let startY = 142;
    if (i > 0) {
      doc.addPage();
      doc.setTextColor(...INK);
      doc.setFont("times", "bold");
      doc.setFontSize(20);
      doc.text(sheet.name, 56, 70);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...MUTED);
      doc.text(p.subtitle, 56, 88);
      startY = 104;
    }
    const [head = [], ...body] = sheet.rows;
    autoTable(doc, {
      startY,
      margin: { left: 56, right: 56, bottom: 56 },
      head: [head.map((c) => String(c ?? ""))],
      body: body.map((r) => r.map((v) => (typeof v === "number" ? fmt(v) : (v ?? "")))),
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8, textColor: INK, cellPadding: 4 },
      headStyles: { fillColor: PAPER, textColor: GREEN, fontStyle: "bold" },
      didParseCell: (d: CellHookData) => {
        if (d.section === "body" && typeof body[d.row.index]?.[d.column.index] === "number") {
          d.cell.styles.halign = "right";
          d.cell.styles.font = "courier";
        }
      },
      bodyStyles: { lineColor: [225, 219, 207], lineWidth: { bottom: 0.5 } },
    });
  });
  footer();
  if (p.output === "blob") return doc.output("blob");
  doc.save(p.fileName);
  return undefined;
}
