import { useAccess } from "@/hooks/use-access";
import { OrgPending } from "@/components/AppShell";
import { showError } from "@/lib/show-error";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  getBooksStatus,
  setBooksLock,
  previewYearEndClose,
  closeFiscalYear,
  previewMonthClose,
  closeMonth,
  reopenBooks,
} from "@/lib/close.functions";
import { getAccountSetup } from "@/lib/org.functions";
import { formatCents } from "@/lib/money";
import { safeRandomUUID } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/close")({
  head: () => ({
    meta: [
      { title: "Close the Books - OpenLedgerApp" },
      { name: "description", content: "Lock a period and close the fiscal year." },
      { property: "og:title", content: "Close the Books - OpenLedgerApp" },
      { property: "og:description", content: "Lock a period and close the fiscal year." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CloseBooksSettings,
});

function CloseBooksSettings() {
  const access = useAccess();
  const { org } = useOrgContext();
  const queryClient = useQueryClient();
  const [lockDate, setLockDate] = useState("");
  const [equityAccountId, setEquityAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    fiscalYearStart: string;
    fiscalYearEnd: string;
    netIncomeCents: number;
  } | null>(null);
  const [fyEnd, setFyEnd] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [monthPreview, setMonthPreview] = useState<Awaited<
    ReturnType<typeof previewMonthClose>
  > | null>(null);
  const [reopenTo, setReopenTo] = useState("");
  const [reason, setReason] = useState("");

  const statusQuery = useQuery({
    queryKey: ["books-status", org?.id],
    enabled: !!org,
    queryFn: () => getBooksStatus({ data: { orgId: org!.id } }),
  });
  const accountsQuery = useQuery({
    queryKey: ["account-setup", org?.id],
    enabled: !!org,
    queryFn: () => getAccountSetup({ data: { orgId: org!.id } }),
  });

  if (!org) return <OrgPending inShell={false} />;
  const isAdmin = access.can("close_books");
  const status = statusQuery.data;
  const accounts = accountsQuery.data ?? [];
  const equityAccounts = accounts.filter((a) => a.type === "equity" && a.isActive);
  const lockedThrough = status?.booksLockedThrough ?? null;

  // Default fiscal year end: the most recent fiscal year boundary before today.
  function defaultFiscalYearEnd(): string {
    const startMonth = status?.fiscalYearStartMonth ?? 1;
    const now = new Date();
    const year = now.getUTCFullYear();
    const endMonth = startMonth === 1 ? 12 : startMonth - 1;
    const endYear = startMonth === 1 ? year - 1 : year;
    const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
    return `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }
  const fiscalYearEnd = fyEnd ?? defaultFiscalYearEnd();

  async function saveLock(clear: boolean) {
    if (!org) return;
    setBusy(true);
    try {
      await setBooksLock({ data: { orgId: org.id, lockedThrough: clear ? null : lockDate } });
      queryClient.invalidateQueries({ queryKey: ["books-status", org.id] });
      toast.success(clear ? "Books unlocked" : "Books locked");
    } catch (err) {
      showError(err, "Could not update the lock");
    } finally {
      setBusy(false);
    }
  }

  // "YYYY-MM" from the month picker to that month's last day.
  function monthEndOf(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    return `${ym}-${String(last).padStart(2, "0")}`;
  }

  async function runMonthPreview() {
    if (!org || !month) return;
    setBusy(true);
    setMonthPreview(null);
    try {
      setMonthPreview(
        await previewMonthClose({ data: { orgId: org.id, monthEnd: monthEndOf(month) } }),
      );
    } catch (err) {
      showError(err, "Could not check the month");
    } finally {
      setBusy(false);
    }
  }

  async function runMonthClose() {
    if (!org || !monthPreview) return;
    setBusy(true);
    try {
      const r = await closeMonth({
        data: {
          orgId: org.id,
          monthEnd: monthPreview.monthEnd,
          acknowledgeWarnings: monthPreview.warnings.length > 0,
        },
      });
      if ("duplicate" in r && r.duplicate) toast.info("That month was already closed.");
      else toast.success(`Month closed. Books locked through ${monthPreview.monthEnd}.`);
      setMonthPreview(null);
      queryClient.invalidateQueries({ queryKey: ["books-status", org.id] });
    } catch (err) {
      showError(err, "Could not close the month. Nothing was changed");
    } finally {
      setBusy(false);
    }
  }

  async function runReopen() {
    if (!org) return;
    setBusy(true);
    try {
      await reopenBooks({ data: { orgId: org.id, reopenThrough: reopenTo || null, reason } });
      toast.success(reopenTo ? `Books reopened after ${reopenTo}.` : "Books fully reopened.");
      setReason("");
      setReopenTo("");
      setLockDate("");
      queryClient.invalidateQueries({ queryKey: ["books-status", org.id] });
    } catch (err) {
      showError(err, "Could not reopen the books. Nothing was changed");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!org) return;
    setBusy(true);
    setPreview(null);
    try {
      const p = await previewYearEndClose({ data: { orgId: org.id, fiscalYearEnd } });
      setPreview(p);
    } catch (err) {
      showError(err, "Could not preview the close");
    } finally {
      setBusy(false);
    }
  }

  async function runClose() {
    if (!org || !preview) return;
    setBusy(true);
    try {
      const r = await closeFiscalYear({
        data: {
          orgId: org.id,
          fiscalYearEnd,
          retainedEarningsAccountId: equityAccountId,
          idempotencyKey: safeRandomUUID(),
        },
      });
      if ("duplicate" in r && r.duplicate) toast.info("That fiscal year was already closed.");
      else toast.success("Fiscal year closed and books locked");
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["books-status", org.id] });
    } catch (err) {
      showError(err, "Could not close the year");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Lock the books</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Locking the books through a date stops anyone from adding or changing transactions on or
          before that date.
          {!isAdmin && " Only admins and treasurers can change this."}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-sm font-medium" htmlFor="lock-date">
              Locked through
            </label>
            <input
              id="lock-date"
              type="date"
              className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              value={lockDate || lockedThrough || ""}
              onChange={(e) => setLockDate(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          {isAdmin && (
            <>
              <button
                onClick={() => saveLock(false)}
                disabled={busy || !lockDate}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Lock
              </button>
            </>
          )}
        </div>
        {lockedThrough && (
          <p className="mt-3 text-sm text-muted-foreground">
            Currently locked through{" "}
            <span className="font-medium text-foreground">{lockedThrough}</span>.
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Close a month</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Closing a month locks the books through its last day. Before closing, we check that every
          bank, cash and credit card account was checked against its statement.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-sm font-medium" htmlFor="close-month">
              Month
            </label>
            <input
              id="close-month"
              type="month"
              className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setMonthPreview(null);
              }}
              disabled={!isAdmin}
            />
          </div>
          {isAdmin && (
            <button
              onClick={runMonthPreview}
              disabled={busy || !month}
              className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Check month
            </button>
          )}
        </div>
        {monthPreview && (
          <div className="mt-4 rounded-md border bg-accent/40 p-4 text-sm" role="status">
            {monthPreview.alreadyClosed ? (
              <p>
                This month is already closed (books locked through {monthPreview.lockedThrough}).
              </p>
            ) : (
              <>
                {monthPreview.warnings.length ? (
                  <>
                    <p className="font-medium">
                      {monthPreview.warnings.length} thing(s) to review before closing:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {monthPreview.warnings.map((w, i) => (
                        <li key={i}>{w.message}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>Everything checks out. Ready to close through {monthPreview.monthEnd}.</p>
                )}
                <button
                  onClick={runMonthClose}
                  disabled={busy}
                  className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {monthPreview.warnings.length ? "Close anyway" : "Close this month"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {lockedThrough && isAdmin && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Reopen books</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reopening lets people change transactions in a closed period again. A reason is required
            and is saved in History with your name.
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium" htmlFor="reopen-to">
                Keep closed through (leave empty to reopen everything)
              </label>
              <input
                id="reopen-to"
                type="date"
                max={lockedThrough}
                className="mt-1 block rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={reopenTo}
                onChange={(e) => setReopenTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="reopen-reason">
                Reason for reopening
              </label>
              <textarea
                id="reopen-reason"
                rows={2}
                maxLength={500}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example: a September bank fee was missed"
              />
            </div>
            <button
              onClick={runReopen}
              disabled={busy || reason.trim().length < 10}
              className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Reopen books
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Close a fiscal year</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This records one closing transaction that moves the year's{" "}
          {org.orgType === "nonprofit"
            ? "net result into Net Assets"
            : "profit into Retained Earnings"}
          , then locks the books through the year's last day. It can't be undone. The closing entry
          becomes part of the audit trail.
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-sm font-medium" htmlFor="fy-end">
                Fiscal year ends
              </label>
              <input
                id="fy-end"
                type="date"
                className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
                value={fiscalYearEnd}
                onChange={(e) => {
                  setFyEnd(e.target.value);
                  setPreview(null);
                }}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="equity-account">
                {org.orgType === "nonprofit" ? "Net assets account" : "Retained earnings account"}
              </label>
              <select
                id="equity-account"
                className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
                value={equityAccountId}
                onChange={(e) => setEquityAccountId(e.target.value)}
                disabled={!isAdmin}
              >
                <option value="">Choose…</option>
                {equityAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {isAdmin && (
              <button
                onClick={runPreview}
                disabled={busy || !equityAccountId}
                className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                Preview close
              </button>
            )}
          </div>
          {preview && (
            <div className="rounded-md border bg-accent/40 p-4 text-sm">
              <p>
                Fiscal year {preview.fiscalYearStart} → {preview.fiscalYearEnd}:{" "}
                <span className="font-medium">
                  {formatCents(preview.netIncomeCents)} net{" "}
                  {preview.netIncomeCents >= 0 ? "income" : "loss"}
                </span>{" "}
                will move into the chosen equity account, and the books will lock through{" "}
                {preview.fiscalYearEnd}.
              </p>
              {isAdmin && (
                <button
                  onClick={runClose}
                  disabled={busy}
                  className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy ? "Closing…" : "Close this fiscal year"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Closed years</h2>
        {status?.closes?.length ? (
          <ul className="mt-3 divide-y text-sm">
            {status.closes.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>Fiscal year ending {c.fiscal_year_end}</span>
                <span className="text-muted-foreground">
                  {formatCents(c.net_income_cents)} · closed{" "}
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No fiscal years have been closed yet.
          </p>
        )}
      </div>
    </div>
  );
}
