import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  securityHeaders,
  supabaseOrigins,
  withSecurityHeaders,
} from "./security-headers";

describe("security headers", () => {
  it("sets the three fixed headers from SHARED-SPEC §10.1", () => {
    const h = securityHeaders("https://abc.supabase.co");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it("allows only self plus the Supabase project for connections", () => {
    const csp = contentSecurityPolicy("https://abc.supabase.co/");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co;");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("ignores a missing or malformed Supabase URL", () => {
    expect(supabaseOrigins(undefined)).toEqual([]);
    expect(supabaseOrigins("not a url")).toEqual([]);
    expect(supabaseOrigins("javascript:alert(1)")).toEqual([]);
    expect(contentSecurityPolicy(undefined)).toContain("connect-src 'self';");
  });

  it("keeps status and existing headers when adding them", async () => {
    const original = new Response("hi", { status: 404, headers: { "content-type": "text/plain" } });
    const out = withSecurityHeaders(original, "https://abc.supabase.co");
    expect(out.status).toBe(404);
    expect(out.headers.get("content-type")).toBe("text/plain");
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
    expect(await out.text()).toBe("hi");
  });
});
