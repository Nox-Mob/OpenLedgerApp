import { describe, expect, it } from "vitest";
import { can, ForbiddenError } from "./permissions";

describe("role authorization matrix", () => {
  it("everyone can read", () => {
    for (const role of ["admin", "treasurer", "member", "viewer"]) {
      expect(can(role, "read")).toBe(true);
    }
  });

  it("viewers cannot write", () => {
    expect(can("viewer", "write")).toBe(false);
    expect(can("member", "write")).toBe(true);
    expect(can("admin", "write")).toBe(true);
  });

  it("admin-only actions", () => {
    for (const action of ["reopen_reconciliation", "close_books"] as const) {
      expect(can("treasurer", action)).toBe(true);
    }
    expect(can("treasurer", "write")).toBe(true);
    expect(can("treasurer", "manage_settings")).toBe(false);
    expect(can("treasurer", "manage_members")).toBe(false);
    for (const action of [
      "reopen_reconciliation",
      "manage_settings",
      "manage_members",
      "close_books",
    ] as const) {
      expect(can("admin", action)).toBe(true);
      expect(can("member", action)).toBe(false);
      expect(can("viewer", action)).toBe(false);
    }
  });

  it("unknown or missing roles can do nothing", () => {
    expect(can(null, "read")).toBe(false);
    expect(can(undefined, "read")).toBe(false);
    expect(can("superuser", "read")).toBe(false);
  });

  it("ForbiddenError names the action", () => {
    expect(new ForbiddenError("close_books").message).toContain("close_books");
  });
});
