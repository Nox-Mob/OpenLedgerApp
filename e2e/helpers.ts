import { expect, type Page } from "./fixtures";
import { DEMO } from "./staging";

export { DEMO };
export type Who = "owner" | "empty";

/** Sign in through the app's own sign-in page as one of the suite demo accounts. */
export async function signIn(page: Page, who: Who) {
  // The current organization is the oah_org cookie: open Riverside, not whichever organization
  // the demo owner made most recently while someone tried things on staging.
  await page.goto("/auth");
  if (who === "owner")
    await page
      .context()
      .addCookies([{ name: "oah_org", value: DEMO.orgId, url: new URL(page.url()).origin }]);
  // wait for the app to hydrate, or React resets fields typed into the server-rendered form
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(who === "owner" ? DEMO.owner : DEMO.empty);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/ledger/);
}

/** The app's main menu in the left sidebar (shared AppShell). */
export const mainMenu = (page: Page) => page.getByRole("navigation", { name: "OpenLedgerApp" });
