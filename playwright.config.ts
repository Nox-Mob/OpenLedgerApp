import { defineConfig, devices } from "@playwright/test";
import { stagingVars } from "./e2e/staging";

/**
 * End-to-end tests: Chromium against the dev server running self-hosted (its own sign-in page)
 * on STAGING, signed in as the suite demo accounts (e2e/staging.ts). The demo is reset every 12
 * hours. No secrets: staging's public settings come from wrangler.jsonc env.staging.
 * Run: `npm run test:e2e`. E2E_BASE_URL tests a deployed site instead of a local server.
 * Hardening as in OpenCharterApp: an origin guard (e2e/fixtures.ts), Chromium's sandbox on
 * (E2E_NO_SANDBOX=1 where only root is available), E2E_BROWSER_CHANNEL=chrome in CI.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 4312);
const external = process.env["E2E_BASE_URL"] || undefined;
const proxy = process.env["HTTPS_PROXY"] ?? process.env["https_proxy"];
const chromiumPath = process.env["E2E_CHROMIUM_PATH"] || undefined;
const channel = process.env["E2E_BROWSER_CHANNEL"] || undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...(channel ? { channel } : {}),
    launchOptions: {
      chromiumSandbox: process.env["E2E_NO_SANDBOX"] !== "1",
      ...(proxy ? { proxy: { server: proxy, bypass: "127.0.0.1,localhost" } } : {}),
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(external
    ? {}
    : {
        webServer: {
          command: `npx vite dev --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: `http://127.0.0.1:${PORT}/auth`,
          reuseExistingServer: !process.env["CI"],
          env: {
            ...stagingVars(),
            // Server functions call the backend from Node; behind a proxy, Node must use it too.
            ...(proxy ? { NODE_USE_ENV_PROXY: "1" } : {}),
          },
          timeout: 180_000,
        },
      }),
});
