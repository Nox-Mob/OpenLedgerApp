import { describe, expect, it } from "vitest";
import { serverSupabaseEnv } from "./server-env";

const staging = { VITE_SUPABASE_URL: "https://staging.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging" };

describe("serverSupabaseEnv", () => {
  it("follows the build when the Worker's runtime settings are for another project", () => {
    const env = serverSupabaseEnv(staging, {
      SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prod",
    });
    expect(env).toEqual({
      url: "https://staging.supabase.co",
      publishableKey: "sb_publishable_staging",
      runtimeMatchesBuild: false,
    });
  });

  it("uses the runtime address for the same project (an internal URL)", () => {
    const env = serverSupabaseEnv(staging, {
      SUPABASE_URL: "http://kong:8000",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging",
    });
    expect(env.url).toBe("http://kong:8000");
    expect(env.runtimeMatchesBuild).toBe(true);
  });

  it("falls back to whichever side is set", () => {
    expect(serverSupabaseEnv(staging, {}).url).toBe("https://staging.supabase.co");
    expect(
      serverSupabaseEnv({}, { SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "k" }),
    ).toEqual({ url: "https://x.supabase.co", publishableKey: "k", runtimeMatchesBuild: true });
  });
});
