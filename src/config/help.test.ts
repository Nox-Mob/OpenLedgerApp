import { describe, expect, it } from "vitest";
import { HELP, helpHrefFor, helpKeyFor } from "./help";

describe("help links (S-04)", () => {
  it("every docs path is a section page or the app's home", () => {
    for (const path of Object.values(HELP)) expect(path).toMatch(/^ledger\/([a-z-]+\/[a-z-]+\/)?$/);
  });

  it("each page opens its own docs page", () => {
    expect(helpKeyFor("/ledger")).toBe("overview");
    expect(helpKeyFor("/transactions/new")).toBe("transactions");
    expect(helpKeyFor("/import")).toBe("bank");
    expect(helpKeyFor("/reconcile/r1")).toBe("bank");
    expect(helpKeyFor("/budgets")).toBe("nonprofit");
    expect(helpKeyFor("/reports")).toBe("reports");
    expect(helpKeyFor("/settings")).toBe("overview");
    expect(helpKeyFor("/settings/members")).toBe("admin");
    expect(helpKeyFor("/settings/close")).toBe("reports");
    expect(helpKeyFor("/elsewhere")).toBe("home");
    expect(helpHrefFor("/import")).toBe(
      "https://docs.openapphub.org/ledger/everyday/import-and-reconcile/",
    );
  });
});
