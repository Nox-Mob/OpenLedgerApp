import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { stagingVars } from "./staging";

/**
 * Origin guard (as in OpenCharterApp, D-186): the test browser may only load the app, its
 * Supabase backend and web fonts; every other request is blocked. Add hosts for one run with
 * E2E_ALLOWED_HOSTS (comma-separated). Import `test` and `expect` from here.
 */
export function allowedHosts(baseURL: string | undefined): Set<string> {
  const hosts = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"]);
  if (baseURL) hosts.add(new URL(baseURL).hostname);
  hosts.add(new URL(stagingVars()["VITE_SUPABASE_URL"]!).hostname);
  for (const h of (process.env["E2E_ALLOWED_HOSTS"] ?? "").split(","))
    if (h.trim()) hosts.add(h.trim().toLowerCase());
  return hosts;
}

export async function guardContext(context: BrowserContext, baseURL: string | undefined) {
  const allowed = allowedHosts(baseURL);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!/^(https?|wss?):$/.test(url.protocol) || allowed.has(url.hostname))
      return route.continue();
    console.warn(`e2e origin guard blocked ${url.origin}`);
    return route.abort("blockedbyclient");
  });
}

export const test = base.extend<{ originGuard: void }>({
  originGuard: [
    async ({ context, baseURL }, use) => {
      await guardContext(context, baseURL);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
