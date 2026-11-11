import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { privateKeyFindings, trackedEnvFindings } from "./check-env.mjs";

const jwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;

describe("env file check", () => {
  it("accepts publishable values", () => {
    expect(privateKeyFindings("VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc\n# note")).toEqual(
      [],
    );
    expect(privateKeyFindings(`SUPABASE_ANON=${jwt("anon")}`)).toEqual([]);
  });
  it("rejects a service role name, secret key or service role token", () => {
    expect(privateKeyFindings("SUPABASE_SERVICE_ROLE_KEY=x")).toHaveLength(1);
    expect(privateKeyFindings("KEY=sb_secret_abc")).toHaveLength(1);
    expect(privateKeyFindings(`KEY=${jwt("service_role")}`)).toHaveLength(1);
  });
  it("allows secret names with placeholder values only in .env.example mode", () => {
    const example =
      "SUPABASE_SERVICE_ROLE_KEY=<service-role key>\nBACKUP_SIGNING_SEED=<random>\nOTHER_API_KEY=";
    expect(privateKeyFindings(example, { allowPlaceholders: true })).toEqual([]);
    expect(privateKeyFindings(example)).toHaveLength(3);
    expect(
      privateKeyFindings("BACKUP_SIGNING_SEED=abc123", { allowPlaceholders: true }),
    ).toHaveLength(1);
  });
  it("flags tracked env files other than .env.example and .env.desktop", () => {
    expect(
      trackedEnvFindings([
        ".env",
        ".env.example",
        ".env.desktop",
        ".env.local",
        "src/.dev.vars",
        "src/env.ts",
      ]),
    ).toEqual([".env", ".env.local", "src/.dev.vars"]);
  });
});
