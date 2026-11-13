import { describe, expect, it } from "vitest";
import {
  draftDescription,
  draftEntries,
  draftKey,
  type CharterDraft,
  type CharterImportConfig,
} from "./charter-income";

const cfg: CharterImportConfig = {
  available: true,
  can_change: true,
  enabled: true,
  scope: "all",
  starts_on: "2026-11-01",
  card_account_id: "stripe",
  other_account_id: "undep",
  fee_account_id: "fees",
  join_account_id: "join",
  renew_account_id: "renew",
  fee_percent_bp: 290,
  fee_fixed_cents: 30,
};

const card: CharterDraft = {
  day: "2026-11-12",
  channel: "card",
  kind: "payments",
  payment_count: 3,
  gross_cents: 10500,
  fee_cents: 365,
  payment_ids: ["b", "a", "c"],
  lines: [
    { purpose: "join", unit_id: "n", unit_name: "Riverside", is_national: true, cents: 5000 },
    { purpose: "renew", unit_id: "n", unit_name: "Riverside", is_national: true, cents: 3000 },
    { purpose: "renew", unit_id: "c1", unit_name: "North", is_national: false, cents: 2500 },
  ],
};

const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);

describe("Charter payments into the books", () => {
  it("books card payments net of the fee, by purpose and chapter", () => {
    const e = draftEntries(card, cfg);
    expect(sum(e)).toBe(0);
    expect(e[0]).toEqual({ accountId: "stripe", amountCents: 10135, memo: null });
    expect(e[1]).toMatchObject({ accountId: "fees", amountCents: 365 });
    expect(e.filter((x) => x.accountId === "renew").map((x) => x.memo)).toEqual([
      "From OpenCharterApp",
      "From OpenCharterApp: North",
    ]);
  });

  it("takes the reviewer's fee, within reason", () => {
    expect(draftEntries(card, cfg, 400)[0]!.amountCents).toBe(10100);
    expect(() => draftEntries(card, cfg, -1)).toThrow(/fee/);
    expect(() => draftEntries(card, cfg, 10500)).toThrow(/fee/);
  });

  it("books checks and cash whole, into Undeposited funds", () => {
    const e = draftEntries({ ...card, channel: "other", fee_cents: 0 }, cfg);
    expect(e[0]).toEqual({ accountId: "undep", amountCents: 10500, memo: null });
    expect(e.some((x) => x.accountId === "fees")).toBe(false);
    expect(sum(e)).toBe(0);
  });

  it("reverses refunds, without the fee", () => {
    const e = draftEntries(
      {
        ...card,
        kind: "refunds",
        gross_cents: 1000,
        fee_cents: 0,
        lines: [{ ...card.lines[0]!, cents: 1000 }],
      },
      cfg,
    );
    expect(e).toEqual([
      { accountId: "stripe", amountCents: -1000, memo: null },
      { accountId: "join", amountCents: 1000, memo: "From OpenCharterApp" },
    ]);
  });

  it("asks for a missing account", () => {
    expect(() => draftEntries(card, { ...cfg, fee_account_id: null })).toThrow(/card fees/);
  });

  it("keys a draft by its payments, in any order", () => {
    expect(draftKey(card, 10500)).toBe(draftKey({ ...card, payment_ids: ["c", "b", "a"] }, 10500));
    expect(draftKey(card, 10500)).not.toBe(draftKey({ ...card, payment_ids: ["a", "b"] }, 10500));
    expect(draftDescription(card)).toBe("Membership dues: card (3 payments)");
  });
});
