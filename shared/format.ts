// The suite's one money format and one date format (SHARED-SPEC §9, DESIGN.md).
// Every app uses these; never toFixed(2), toLocaleDateString() or a local helper.
//
//   formatMoney(123456)                 "$1,234.56"
//   formatMoney(-123456)                "-$1,234.56"
//   formatMoney(5000, { sign: true })   "+$50.00"
//   formatDate("2026-11-09")            "Nov 9, 2026"
//   formatDate(ts, { time: true, timeZone: "America/Toronto" })  "Nov 9, 2026, 2:30 PM"
//   formatDateISO(ts, { timeZone })     "2026-11-09"   (exports, file names)
//   formatAmount(123456)                "1234.56"      (exports, CSV)
//
// Money is integer cents (number or bigint), as stored (§2).

export type Cents = number | bigint;

function toUnits(cents: Cents): number {
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  if (!Number.isFinite(n)) throw new RangeError(`Not an amount in cents: ${String(cents)}`);
  return Math.round(n) / 100;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();
function moneyFormatter(currency: string, sign: boolean): Intl.NumberFormat {
  const key = `${currency}|${sign}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: sign ? "exceptZero" : "auto",
    });
    moneyFormatters.set(key, f);
  }
  return f;
}

/** "$1,234.56", "-$1,234.56". `currency` is the org's ISO currency code (default USD). */
export function formatMoney(
  cents: Cents,
  opts: { currency?: string; sign?: boolean } = {},
): string {
  const units = toUnits(cents);
  // Avoid "-$0.00" for amounts that round to zero.
  return moneyFormatter(opts.currency ?? "USD", !!opts.sign).format(units === 0 ? 0 : units);
}

/** Plain decimal for exports: "1234.56", "-1234.56". */
export function formatAmount(cents: Cents): string {
  const units = toUnits(cents);
  return (units === 0 ? 0 : units).toFixed(2);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: Date | string | number): { date: Date; dateOnly: boolean } {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    // A calendar date ("2026-11-09") has no time zone; show it as written.
    return { date: new Date(`${value}T00:00:00Z`), dateOnly: true };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a date: ${String(value)}`);
  return { date, dateOnly: false };
}

// Intl puts a narrow no-break space before AM/PM in recent engines; use a plain space
// so the format is identical everywhere (server, browsers, tests).
const clean = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

/**
 * "Nov 9, 2026", or "Nov 9, 2026, 2:30 PM" with `time`. Pass the org's time zone;
 * without it the viewer's zone is used. Calendar dates ("2026-11-09") never shift.
 */
export function formatDate(
  value: Date | string | number,
  opts: { time?: boolean; timeZone?: string } = {},
): string {
  const { date, dateOnly } = toDate(value);
  const timeZone = dateOnly ? "UTC" : opts.timeZone;
  return clean(
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(opts.time && !dateOnly ? { hour: "numeric", minute: "2-digit" } : {}),
      ...(timeZone ? { timeZone } : {}),
    }).format(date),
  );
}

/** "2026-11-09", for exports and file names. */
export function formatDateISO(
  value: Date | string | number,
  opts: { timeZone?: string } = {},
): string {
  const { date, dateOnly } = toDate(value);
  const timeZone = dateOnly ? "UTC" : opts.timeZone;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
