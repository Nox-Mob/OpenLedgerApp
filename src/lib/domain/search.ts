// Transaction search and filters: pure matching shared by cloud and desktop.
import type { Id, IsoDate } from "./models";

export interface TxFilter {
  q?: string | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  accountId?: Id | undefined;
  projectId?: Id | undefined;
  fundId?: Id | undefined;
  /** Whole-transaction amount (sum of increases), in cents. */
  minCents?: number | undefined;
  maxCents?: number | undefined;
  status?: "posted" | "void" | undefined;
  source?: string | undefined;
  reconciled?: "yes" | "no" | undefined;
}

export interface SearchableTx {
  transactionDate: IsoDate;
  description: string;
  status: string;
  source: string;
  entries: {
    accountId: Id;
    amountCents: number;
    memo: string | null;
    projectId?: Id | null | undefined;
    fundId?: Id | null | undefined;
    reconciled?: boolean | undefined;
  }[];
}

export function txTotalCents(t: SearchableTx) {
  return t.entries.filter((e) => e.amountCents > 0).reduce((a, e) => a + e.amountCents, 0);
}

export function hasFilter(f: TxFilter) {
  return Object.values(f).some((v) => v !== undefined && v !== "");
}

export function matchesFilter(t: SearchableTx, f: TxFilter): boolean {
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    const hay = [t.description, ...t.entries.map((e) => e.memo ?? "")].join(" ").toLowerCase();
    if (q && !hay.includes(q)) return false;
  }
  if (f.from && t.transactionDate < f.from) return false;
  if (f.to && t.transactionDate > f.to) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.source && t.source !== f.source) return false;
  if (f.accountId && !t.entries.some((e) => e.accountId === f.accountId)) return false;
  if (f.projectId && !t.entries.some((e) => e.projectId === f.projectId)) return false;
  if (f.fundId && !t.entries.some((e) => e.fundId === f.fundId)) return false;
  const total = txTotalCents(t);
  if (f.minCents !== undefined && total < f.minCents) return false;
  if (f.maxCents !== undefined && total > f.maxCents) return false;
  if (f.reconciled) {
    const lines = f.accountId ? t.entries.filter((e) => e.accountId === f.accountId) : t.entries;
    const any = lines.some((e) => e.reconciled);
    if (f.reconciled === "yes" ? !any : any) return false;
  }
  return true;
}
