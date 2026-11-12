import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Staging's public settings (wrangler.jsonc `env.staging`, publishable keys only). The end-to-end
 * tests run the app self-hosted (VITE_HOSTED=false: its own sign-in page) against staging.
 */
export function stagingVars(): Record<string, string> {
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config as { env?: { staging?: { vars?: Record<string, string> } } };
  const vars = config.env?.staging?.vars;
  if (!vars?.["VITE_SUPABASE_URL"])
    throw new Error("wrangler.jsonc env.staging has no VITE_SUPABASE_URL");
  return { ...vars, VITE_HOSTED: "false" };
}

/**
 * The suite demo (OpenAppHub db/seed/0002_suite_demo.sql, reset every 12 hours): the owner of
 * Riverside Community Association and an account with no organization. The password is public.
 */
export const DEMO = {
  password: "OpenAppHubDemo2026",
  owner: "demo@demo.openapphub.org",
  empty: "test@demo.openapphub.org",
  org: "Riverside Community Association",
  /** Riverside's id: the owner may also own organizations made while trying things on staging. */
  orgId: "de000000-0000-4000-8000-0000000000a1",
} as const;
