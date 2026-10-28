// Transaction templates and recurring drafts: pure rules, no storage imports.
// A recurring template never posts by itself; due dates become drafts or reminders
// that a person posts or skips. Each due date posts at most once (idempotency key).
import type { Id, IsoDate } from "./models";

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
export type RecurringMode = "drafts" | "reminder";
export const FREQUENCIES: Frequency[] = ["weekly", "monthly", "quarterly", "yearly"];

export interface TemplateLine {
  accountId: Id;
  amountCents: number;
  projectId?: Id | null | undefined;
  fundId?: Id | null | undefined;
  memo?: string | null | undefined;
}

export interface TransactionTemplate {
  id: Id;
  orgId: Id;
  name: string;
  description: string;
  lines: TemplateLine[];
  frequency: Frequency | null;
  /** Next date a draft is due; null when the template doesn't repeat. */
  nextDue: IsoDate | null;
  active: boolean;
}

export interface Occurrence {
  id: Id;
  orgId: Id;
  templateId: Id;
  dueDate: IsoDate;
  status: "posted" | "skipped";
  transactionId: Id | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The next due date after `date`. Month-based steps keep the day, clamped to month end. */
export function nextDate(freq: Frequency, date: IsoDate, anchorDay?: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  if (freq === "weekly") {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const step = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : 12;
  const idx = y * 12 + (m - 1) + step;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysIn(ny, nm));
  return `${ny}-${pad(nm)}-${pad(day)}`;
}

/** Due dates from the template's next due date up to and including today (max 24). */
export function dueDates(t: TransactionTemplate, today: IsoDate, max = 24): IsoDate[] {
  if (!t.active || !t.frequency || !t.nextDue) return [];
  const anchor = Number(t.nextDue.slice(8, 10));
  const out: IsoDate[] = [];
  let d = t.nextDue;
  while (d <= today && out.length < max) {
    out.push(d);
    d = nextDate(t.frequency, d, anchor);
  }
  return out;
}

/** Idempotency key for posting one due date of a template. Posting twice returns the first. */
export function occurrenceKey(templateId: Id, dueDate: IsoDate) {
  return `recurring:${templateId}:${dueDate}`;
}

/** Checks a template before saving. Lines must balance like a real transaction. */
export function templateProblem(
  t: Pick<TransactionTemplate, "name" | "description" | "lines" | "frequency" | "nextDue">,
): string | null {
  if (!t.name.trim()) return "Give the template a name.";
  if (!t.description.trim()) return "Add a description.";
  if (t.lines.length < 2) return "A template needs at least two lines.";
  if (t.lines.some((l) => !Number.isInteger(l.amountCents) || l.amountCents === 0))
    return "Every line needs an amount.";
  const sum = t.lines.reduce((a, l) => a + l.amountCents, 0);
  if (sum !== 0) return "The template doesn't balance: increases must equal decreases.";
  if (t.frequency && !t.nextDue) return "Pick the first date it's due.";
  return null;
}
