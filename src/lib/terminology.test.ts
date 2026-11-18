import { describe, expect, it } from "vitest";
import {
  LEVELS,
  TERM_ITEMS,
  accountTypeLabel,
  cleanOverrides,
  displayBalance,
  getTerms,
  normalizeTerminology,
} from "./terminology";

describe("normalizeTerminology", () => {
  it("keeps known levels and maps legacy/unknown values to simplest", () => {
    expect(normalizeTerminology("simple")).toBe("simple");
    expect(normalizeTerminology("accounting")).toBe("accounting");
    expect(normalizeTerminology("simplified")).toBe("simplest");
    expect(normalizeTerminology(undefined)).toBe("simplest");
    expect(normalizeTerminology(42)).toBe("simplest");
  });
});

describe("getTerms", () => {
  it("uses plain wording at the simplest level", () => {
    const t = getTerms("business", "simplest");
    expect(t.assets).toBe("Money You Have");
    expect(t.debit).toBe("Increase");
    expect(t.credit).toBe("Decrease");
    expect(t.reconcile).toBe("Check against statement");
  });
  it("uses accounting wording at the double-entry level", () => {
    const t = getTerms("business", "accounting");
    expect(t.assets).toBe("Assets");
    expect(t.debit).toBe("Debit");
    expect(t.credit).toBe("Credit");
    expect(t.incomeStatement).toBe("Profit & Loss");
    expect(t.reconcile).toBe("Reconcile");
  });
  it("uses nonprofit wording where it differs", () => {
    const t = getTerms("nonprofit", "accounting");
    expect(t.equity).toBe("Net Assets");
    expect(t.incomeStatement).toBe("Statement of Activities");
    expect(t.balanceSheet).toBe("Statement of Financial Position");
    expect(t.orgLabel).toBe("Nonprofit");
  });
  it("applies per-term overrides on top of the base level", () => {
    const t = getTerms("business", "simplest", { assets: "accounting" });
    expect(t.assets).toBe("Assets");
    expect(t.liabilities).toBe("Money You Owe");
    expect(t.levels.assets).toBe("accounting");
  });
  it("produces a non-empty label for every term, org type and level", () => {
    for (const org of ["business", "nonprofit"] as const)
      for (const lvl of LEVELS) {
        const t = getTerms(org, lvl);
        for (const k of [
          "assets",
          "liabilities",
          "equity",
          "revenue",
          "expenses",
          "netIncome",
          "debit",
          "credit",
          "journal",
        ] as const)
          expect(t[k], `${org}/${lvl}/${k}`).toBeTruthy();
      }
  });
});

describe("cleanOverrides", () => {
  it("drops unknown keys and invalid levels", () => {
    expect(cleanOverrides({ assets: "simple", bogus: "simple", equity: "nope" })).toEqual({
      assets: "simple",
    });
    expect(cleanOverrides(null)).toEqual({});
    expect(cleanOverrides("x")).toEqual({});
  });
});

describe("displayBalance", () => {
  it("shows debit-normal accounts as-is and flips credit-normal ones", () => {
    expect(displayBalance("asset", 500)).toBe(500);
    expect(displayBalance("expense", 500)).toBe(500);
    expect(displayBalance("liability", -500)).toBe(500);
    expect(displayBalance("equity", -500)).toBe(500);
    expect(displayBalance("revenue", -500)).toBe(500);
  });
});

describe("accountTypeLabel", () => {
  it("maps account types to the org's wording and passes unknowns through", () => {
    const t = getTerms("nonprofit", "accounting");
    expect(accountTypeLabel("equity", t)).toBe("Net Assets");
    expect(accountTypeLabel("mystery", t)).toBe("mystery");
  });
});

describe("report names", () => {
  it("uses plain names at the simplest level", () => {
    const t = getTerms("nonprofit", "simplest");
    expect(t.trialBalance).toBe("Totals Check");
    expect(t.generalLedger).toBe("Every Transaction");
    expect(t.fundActivity).toBe("Money by Purpose");
    expect(t.statementCheck).toBe("Bank Statement Check");
    expect(t.accountActivity("Checking")).toBe("History for Checking");
  });
  it("uses accounting names at the double-entry level", () => {
    const t = getTerms("business", "accounting");
    expect(t.trialBalance).toBe("Trial Balance");
    expect(t.generalLedger).toBe("General Ledger");
    expect(t.statementCheck).toBe("Reconciliation Report");
  });
});
