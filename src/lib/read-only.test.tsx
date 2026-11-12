// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CAPABILITIES, READ_ONLY_SAFE, canNow, type OrgAction } from "./permissions";

// S-05: while billing makes Ledger read-only, write controls are off; reading stays on.
describe("canNow (role and read-only)", () => {
  const actions = Object.keys(CAPABILITIES) as OrgAction[];

  it("with full access it is exactly the role table", () => {
    for (const a of actions) expect(canNow("admin", a, false)).toBe(true);
    expect(canNow("viewer", "write", false)).toBe(false);
  });

  it("read-only turns every write off, even for admins; reading stays", () => {
    for (const a of actions) expect(canNow("admin", a, true)).toBe(READ_ONLY_SAFE.includes(a));
    expect(canNow("viewer", "read", true)).toBe(true);
  });
});

const access = { readOnly: false, can: (_a: OrgAction) => true };
vi.mock("@/hooks/use-access", () => ({ useAccess: () => access }));

describe("WriteGuard", () => {
  afterEach(cleanup);

  it("leaves the form alone with full access", async () => {
    const { WriteGuard } = await import("@/components/WriteGuard");
    Object.assign(access, { readOnly: false, can: () => true });
    render(
      <WriteGuard>
        <button>Save</button>
      </WriteGuard>,
    );
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("switches the form off and says why while read-only", async () => {
    const { WriteGuard } = await import("@/components/WriteGuard");
    Object.assign(access, { readOnly: true, can: () => false });
    render(
      <WriteGuard>
        <button>Save</button>
      </WriteGuard>,
    );
    expect(screen.getByRole("button", { name: "Save" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("note").textContent).toMatch(/read-only/);
  });
});
