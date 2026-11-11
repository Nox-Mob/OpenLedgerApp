import { describe, expect, it } from "vitest";
import { currentSettingsSection, inSettings } from "./settings-sections";

describe("settings sections (left sidebar)", () => {
  it("knows which settings page is open", () => {
    expect(currentSettingsSection("/settings")).toBe("/settings");
    expect(currentSettingsSection("/settings/members")).toBe("/settings/members");
    expect(currentSettingsSection("/settings/accounts/123")).toBe("/settings/accounts");
  });

  it("is closed outside settings", () => {
    expect(currentSettingsSection("/ledger")).toBeNull();
    expect(currentSettingsSection("/settingsx")).toBeNull();
    expect(inSettings("/accounts")).toBe(false);
  });
});
