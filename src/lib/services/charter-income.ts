// S-18 / L-17: OpenCharterApp payments into the books, reviewed first. The database offers drafts
// (ledger.charter_drafts, migration 0011); this turns one into balanced entries for the usual
// transaction service, so the books' own rules (balanced, not in closed months) still apply.

export type CharterChannel = "card" | "other";
export type CharterKind = "payments" | "refunds";

export type CharterDraftLine = {
  purpose: "join" | "renew" | string;
  unit_id: string;
  unit_name: string;
  is_national: boolean;
  cents: number;
};

export type CharterDraft = {
  day: string;
  channel: CharterChannel;
  kind: CharterKind;
  payment_count: number;
  gross_cents: number;
  fee_cents: number;
  payment_ids: string[];
  lines: CharterDraftLine[];
};

export type CharterImportConfig = {
  available: boolean;
  can_change: boolean;
  enabled: boolean;
  scope: "national" | "all";
  starts_on: string;
  card_account_id: string | null;
  other_account_id: string | null;
  fee_account_id: string | null;
  join_account_id: string | null;
  renew_account_id: string | null;
  fee_percent_bp: number;
  fee_fixed_cents: number;
};

export type DraftEntry = { accountId: string; amountCents: number; memo: string | null };

/** The key a draft posts under: the same payments always give the same key. */
export function draftKey(
  d: Pick<CharterDraft, "kind" | "payment_ids">,
  amountCents: number,
): string {
  const ids = [...d.payment_ids].sort().join(",");
  let h = 0x811c9dc5;
  for (let i = 0; i < ids.length; i++) {
    h ^= ids.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `charter:${d.kind}:${h.toString(16)}:${d.payment_ids.length}:${amountCents}`;
}

export function draftDescription(d: Pick<CharterDraft, "channel" | "kind" | "payment_count">) {
  const n = `${d.payment_count} ${d.payment_count === 1 ? "payment" : "payments"}`;
  if (d.kind === "refunds")
    return `Membership dues refunded: ${d.channel === "card" ? "card" : "checks and cash"} (${n})`;
  return `Membership dues: ${d.channel === "card" ? "card" : "checks and cash"} (${n})`;
}

/**
 * Balanced entries for a draft. Payments: the deposit account (Stripe balance, net of the fee,
 * or Undeposited funds) and the fee against the income accounts, one credit per purpose and, for
 * chapters, per chapter. Refunds: the reverse, without the fee (card processors keep it).
 */
export function draftEntries(
  d: CharterDraft,
  cfg: CharterImportConfig,
  feeCents: number = d.fee_cents,
): DraftEntry[] {
  const need = (id: string | null, what: string) => {
    if (!id) throw new Error(`Choose the ${what} account in Settings → OpenCharterApp payments.`);
    return id;
  };
  const deposit = need(
    d.channel === "card" ? cfg.card_account_id : cfg.other_account_id,
    d.channel === "card" ? "card deposits" : "checks and cash",
  );
  const fee = d.kind === "payments" && d.channel === "card" ? feeCents : 0;
  if (!Number.isInteger(fee) || fee < 0 || fee >= d.gross_cents)
    throw new Error("The fee must be at least 0 and less than the total.");
  const sign = d.kind === "payments" ? 1 : -1;
  // One income line per account and chapter.
  const income = new Map<string, DraftEntry>();
  for (const l of d.lines) {
    const account = need(
      l.purpose === "join" ? cfg.join_account_id : cfg.renew_account_id,
      l.purpose === "join" ? "new member dues" : "renewal dues",
    );
    const memo = l.is_national ? "From OpenCharterApp" : `From OpenCharterApp: ${l.unit_name}`;
    const k = `${account}|${memo}`;
    const e = income.get(k) ?? { accountId: account, amountCents: 0, memo };
    e.amountCents -= sign * l.cents;
    income.set(k, e);
  }
  const total = -sign * [...income.values()].reduce((s, e) => s + e.amountCents, 0);
  if (total !== d.gross_cents) throw new Error("This draft doesn't add up. Refresh and try again.");
  const out: DraftEntry[] = [
    { accountId: deposit, amountCents: sign * (d.gross_cents - fee), memo: null },
  ];
  if (fee > 0)
    out.push({
      accountId: need(cfg.fee_account_id, "card fees"),
      amountCents: fee,
      memo: "Card processing fees (estimated)",
    });
  return [...out, ...income.values()];
}
