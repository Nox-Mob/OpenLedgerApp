import { describe, expect, it } from "vitest";
import { catalogFor, matchesCatalog } from "./account-catalog";

describe("account catalog", () => {
  it("matchesCatalog ignores case and surrounding spaces but not type", () => {
    const c = catalogFor("business")[0]!;
    expect(matchesCatalog({ name: `  ${c.name.toUpperCase()} `, type: c.type }, c)).toBe(true);
    expect(
      matchesCatalog({ name: c.name, type: c.type === "asset" ? "expense" : "asset" }, c),
    ).toBe(false);
  });
});
