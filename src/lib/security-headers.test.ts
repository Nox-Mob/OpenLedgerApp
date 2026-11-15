import { describe, expect, it, vi } from "vitest";
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

describe("Cloudflare Web Analytics in the CSP (production only)", () => {
  it("isn't allowed without the production token", () => {
    vi.stubEnv("VITE_CF_ANALYTICS_TOKEN", "");
    expect(contentSecurityPolicy("https://abc.supabase.co")).not.toContain("cloudflareinsights");
    vi.unstubAllEnvs();
  });
  it("allows only the beacon script and its reporting endpoint with the token", () => {
    vi.stubEnv("VITE_CF_ANALYTICS_TOKEN", "054d7738b858425f863060e1c3b9dbb3");
    const csp = contentSecurityPolicy("https://abc.supabase.co");
    expect(csp).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
    vi.unstubAllEnvs();
  });
});

describe("no caching of rendered pages (OWASP A04:2025)", () => {
  it("adds private, no-store unless the response sets its own Cache-Control", () => {
    const fresh = withSecurityHeaders(new Response("hi"), "https://abc.supabase.co");
    expect(fresh.headers.get("Cache-Control")).toBe("private, no-store");
    const own = withSecurityHeaders(
      new Response("hi", { headers: { "Cache-Control": "public, max-age=60" } }),
      "https://abc.supabase.co",
    );
    expect(own.headers.get("Cache-Control")).toBe("public, max-age=60");
  });
});
