// Diagnostics and first-run progress: pure checks over ledger data. No personal or
// financial details leave these functions, only counts and pass/fail.
import type { Id, IsoDate } from "./models";

export interface DiagInput {
  accounts: { id: Id }[];
  transactions: {
    id: Id;
    status: string;
    source: string;
    entries: { accountId: Id; amountCents: number }[];
  }[];
  reconciliations: { status: string }[];
  booksLockedThrough: IsoDate | null;
}

export interface DiagCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function runChecks(d: DiagInput): DiagCheck[] {
  const known = new Set(d.accounts.map((a) => a.id));
  const posted = d.transactions.filter((t) => t.status === "posted" && t.source !== "closing");
  const total = posted.reduce((a, t) => a + t.entries.reduce((s, e) => s + e.amountCents, 0), 0);
  const unbalanced = posted.filter((t) => t.entries.reduce((s, e) => s + e.amountCents, 0) !== 0);
  const orphans = posted.reduce(
    (a, t) => a + t.entries.filter((e) => !known.has(e.accountId)).length,
    0,
  );
  const open = d.reconciliations.filter((r) => r.status === "in_progress").length;
  return [
    {
      key: "balanced_books",
      label: "Books balance (totals check is zero)",
      ok: total === 0,
      detail: total === 0 ? "Increases equal decreases." : "Increases and decreases don't match.",
    },
    {
      key: "unbalanced_transactions",
      label: "Every transaction balances",
      ok: unbalanced.length === 0,
      detail: `${unbalanced.length} transaction(s) don't balance.`,
    },
    {
      key: "lines_without_account",
      label: "Every line has an account",
      ok: orphans === 0,
      detail: `${orphans} line(s) point at a missing account.`,
    },
    {
      key: "open_statement_checks",
      label: "No unfinished statement checks",
      ok: open === 0,
      detail: `${open} statement check(s) in progress.`,
    },
    {
      key: "books_locked",
      label: "Books closed through a date",
      ok: d.booksLockedThrough !== null,
      detail: d.booksLockedThrough
        ? `Closed through ${d.booksLockedThrough}.`
        : "No month closed yet.",
    },
  ];
}

export interface SetupStep {
  key: "org" | "accounts" | "opening" | "first_tx" | "statement" | "close";
  label: string;
  done: boolean;
  to: string;
}

export function setupProgress(d: DiagInput): SetupStep[] {
  const posted = d.transactions.filter((t) => t.status === "posted");
  return [
    { key: "org", label: "Set up your organization", done: true, to: "/settings" },
    {
      key: "accounts",
      label: "Choose your accounts",
      done: d.accounts.length > 0,
      to: "/accounts",
    },
    {
      key: "opening",
      label: "Add starting balances",
      done: posted.some((t) => t.source === "opening_balance"),
      to: "/accounts",
    },
    {
      key: "first_tx",
      label: "Record your first transaction",
      done: posted.some((t) => t.source !== "opening_balance"),
      to: "/transactions/new",
    },
    {
      key: "statement",
      label: "Finish a bank statement check",
      done: d.reconciliations.some((r) => r.status === "completed"),
      to: "/reconcile",
    },
    {
      key: "close",
      label: "Close your first month",
      done: d.booksLockedThrough !== null,
      to: "/settings/close",
    },
  ];
}
