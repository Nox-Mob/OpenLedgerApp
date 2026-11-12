// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const legal = vi.hoisted(() => ({
  status: { missing: ["terms", "privacy", "non_advice"] as string[], viaHub: false },
  accept: vi.fn(async (_input: unknown) => ({ ok: true })),
}));
vi.mock("@/lib/legal.functions", () => ({
  getLegalStatus: async () => legal.status,
  acceptCurrentLegalDocuments: legal.accept,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

import { LegalGate } from "./LegalGate";

afterEach(cleanup);
const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LegalGate>
        <p>The books</p>
      </LegalGate>
    </QueryClientProvider>,
  );

describe("one terms step (H-07)", () => {
  it("asks for everything when the hub hasn't", async () => {
    legal.status = { missing: ["terms", "privacy", "non_advice"], viaHub: false };
    wrap();
    expect(await screen.findByText(/I agree to the/)).toBeTruthy();
  });

  it("shows only the not-advice notice when OpenAppHub already has the terms", async () => {
    legal.status = { missing: ["non_advice"], viaHub: true };
    wrap();
    expect(
      await screen.findByText(/You already agreed to the Terms and Privacy Policy in OpenAppHub/),
    ).toBeTruthy();
    expect(screen.queryByText(/I agree to the/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button"));
    await vi.waitFor(() =>
      expect(legal.accept).toHaveBeenCalledWith({
        data: { terms: false, privacy: false, nonAdvice: true },
      }),
    );
  });
});
