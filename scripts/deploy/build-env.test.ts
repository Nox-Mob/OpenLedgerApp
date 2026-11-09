import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { buildEnv, stripJsonc } from "./build-env.mjs";

describe("deploy build env", () => {
  it("strips comments and trailing commas but keeps URLs inside strings", () => {
    const text = `{
      // comment
      "a": "https://x.example/path", /* block */
      "b": [1, 2,],
    }`;
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: "https://x.example/path", b: [1, 2] });
  });

  it("returns only the env's own vars and refuses placeholders", () => {
    // The top level is production; staging is an env and inherits nothing.
    const config = {
      vars: { VITE_SUPABASE_PUBLISHABLE_KEY: "<set me>" },
      env: { staging: { vars: { VITE_HOSTED: "true", VITE_APP_ID: "ledger" } } },
    };
    expect(buildEnv(config, "staging")).toEqual(["VITE_HOSTED=true", "VITE_APP_ID=ledger"]);
    expect(() => buildEnv(config, "production")).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    expect(buildEnv({ vars: { A: "1" } }, "production")).toEqual(["A=1"]);
    expect(() => buildEnv(config, "nope")).toThrow(/no env/);
  });

  it("wrangler.jsonc points each environment at its own Supabase project and domain", () => {
    const config = JSON.parse(stripJsonc(readFileSync("wrangler.jsonc", "utf8")));
    const prod = config;
    const staging = config.env.staging;
    expect(config.env.production).toBeUndefined();
    expect(prod.vars.VITE_SUPABASE_URL).toBe("https://ymlesgadawnjupnvgokd.supabase.co");
    expect(staging.vars.VITE_SUPABASE_URL).toBe("https://mbloxixlykmbuuoaprnx.supabase.co");
    expect(JSON.parse(prod.vars.VITE_SUITE_URLS).ledger).toBe("https://ledger.openapphub.org");
    expect(JSON.parse(staging.vars.VITE_SUITE_URLS).hub).toBe("https://staging.openapphub.org");
    expect(prod.routes[0].pattern).toBe("ledger.openapphub.org");
    expect(staging.routes[0].pattern).toBe("ledger-staging.openapphub.org");
    for (const env of [prod, staging]) {
      expect(env.vars.VITE_HOSTED).toBe("true");
      expect(env.vars.VITE_APP_ID).toBe("ledger");
      expect(env.vars.VITE_APP_SCHEMA).toBe("ledger");
      expect(env.vars.VITE_COOKIE_DOMAIN).toBe(".openapphub.org");
      expect(env.vars.SUPABASE_URL).toBe(env.vars.VITE_SUPABASE_URL);
      // Secrets never live in wrangler.jsonc (SHARED-SPEC §7.1).
      expect(Object.keys(env.vars).join(" ")).not.toMatch(/SERVICE_ROLE|SECRET|SEED|API_KEY/);
    }
  });
});
