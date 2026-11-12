// OpenLedgerApp's workflow actions (S-25): carried out from public.automation_jobs.
//   ledger.reports_to_meeting  the board package (income, balance, budget against actual and, for
//                              nonprofits, fund activity) as one PDF, added to the meeting the
//                              workflow is about, as of the last closed month, today or a date.
// Hosted, the hub's scheduler asks for a run (POST /automation/run, signed with a key derived from
// the service role key); self-hosted, server/email-cron.ts runs them on the app's own cron.
// Server-only: uses the service role key.
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAutomationJobs, verifyRun, type AutomationJob } from "@shared/automation/run";
import { adminClient } from "@shared/email/selfhost";
import { addReportToBoardMeeting } from "@shared/integrations/board";
import { serverSupabaseEnv } from "@/integrations/supabase/server-env";
import { createSupabaseRepositories } from "@/lib/adapters/supabase";
import { fiscalYearStart, todayISO } from "@/lib/dates";
import { periodStartFor } from "@/lib/domain/budgets";
import { budgetVsActual } from "@/lib/services/budgets";
import { fundActivity } from "@/lib/services/funds";
import { balanceSheet, incomeStatement } from "@/lib/services/reports";
import { cleanOverrides, getTerms, normalizeTerminology } from "@/lib/terminology";

type Env = Record<string, string | undefined>;

/** The date the reports run to: the last closed month, today, or a chosen date. */
export function reportDate(
  asOf: unknown,
  date: unknown,
  org: { booksLockedThrough: string | null; timezone: string | null },
  now = new Date(),
): string {
  if (asOf === "last_closed_month") {
    if (!org.booksLockedThrough)
      throw new Error("No month is closed yet, so there's no last closed month to report on.");
    return org.booksLockedThrough;
  }
  if (asOf === "date") {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error("The workflow says to report as of a date, but no date is set.");
    return date;
  }
  return todayISO(now, org.timezone || "America/Chicago");
}

export async function reportsToMeeting(
  admin: SupabaseClient,
  job: AutomationJob,
  now = new Date(),
) {
  const meeting = (job.payload.ctx?.["meeting"] ?? null) as { id?: string; title?: string } | null;
  if (!meeting?.id) throw new Error("This workflow has no meeting to add the reports to.");
  const db = admin.schema("ledger") as unknown as Parameters<typeof createSupabaseRepositories>[0];
  const repos = createSupabaseRepositories(db);
  const org = await repos.orgs.get(job.org_id);
  if (!org) throw new Error("OpenLedgerApp isn't set up for this organization.");

  const to = reportDate(job.payload["as_of"], job.payload["date"], org, now);
  const from = fiscalYearStart(to, org.fiscalYearStartMonth || 1);
  const nonprofit = org.orgType === "nonprofit";
  const funds = nonprofit
    ? (
        ((
          await admin
            .schema("ledger")
            .from("funds")
            .select("id, name, is_restricted")
            .eq("org_id", job.org_id)
        ).data ?? []) as Array<{ id: string; name: string; is_restricted: boolean }>
      ).map((f) => ({ id: f.id, name: f.name, isRestricted: !!f.is_restricted }))
    : [];
  const [inc, bal, bud, fa] = await Promise.all([
    incomeStatement(repos, job.org_id, { from, to }),
    balanceSheet(repos, job.org_id, to),
    budgetVsActual(
      repos,
      job.org_id,
      "year",
      periodStartFor("year", to, org.fiscalYearStartMonth || 1),
    ),
    nonprofit ? fundActivity(repos, job.org_id, funds, from, to) : null,
  ]);
  const terminology = normalizeTerminology(org.terminology);
  const terms = getTerms(
    nonprofit ? "nonprofit" : "business",
    terminology,
    cleanOverrides(org.termOverrides),
  );
  const s = await import("@/lib/report-sheets");
  const pdf = await import("@/lib/report-pdf");
  const body = [
    s.incomeSheet(terms.incomeStatement, inc, terms),
    s.balanceSheetSheet(terms.balanceSheet, bal, terms),
    s.budgetSheet("Budget vs actual", bud.lines, terms),
    ...(fa ? [s.fundActivitySheet(fa.funds, terms.fundActivity)] : []),
  ];
  const period = `${from} to ${to}, balances as of ${to}`;
  const blob = await pdf.exportAllPdf({
    org: {
      name: org.name,
      orgType: org.orgType,
      currency: org.currency,
      fiscalYearStartMonth: org.fiscalYearStartMonth || 1,
    },
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
    fileName: "board-package.pdf",
    output: "blob",
  });
  if (!blob) throw new Error("The PDF could not be made.");
  const fileName = `${org.name}-financial-reports-${to}.pdf`.replace(/[^\w.-]+/g, "-");
  const documentId = await addReportToBoardMeeting(admin, {
    meetingId: meeting.id,
    title: `Financial reports as of ${to}`,
    fileName,
    pdf: blob,
    sourceApp: "ledger",
  });
  return {
    summary: `Financial reports as of ${to} added to ${meeting.title ?? "the meeting"}`,
    document_id: documentId,
    as_of: to,
  };
}

/** Runs this app's queued workflow actions. */
export async function runLedgerAutomation(env: Env) {
  const admin = adminClient(env["SUPABASE_URL"] || serverSupabaseEnv().url, env);
  if (!admin) return null;
  return runAutomationJobs(admin, "ledger", {
    "ledger.reports_to_meeting": (job) => reportsToMeeting(admin, job),
  });
}

/** POST /automation/run from the hub's scheduler (signed). */
export async function ledgerAutomationEndpoint(request: Request): Promise<Response> {
  const env = process.env as Env;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!(await verifyRun(env["SUPABASE_SERVICE_ROLE_KEY"] ?? "", "ledger", request.headers)))
    return new Response("Forbidden", { status: 403 });
  const result = await runLedgerAutomation(env);
  return Response.json(result ?? { done: 0, failed: 0 });
}
