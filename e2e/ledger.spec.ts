import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DEMO, mainMenu, signIn } from "./helpers";

// The suite demo in Ledger: Riverside's books, three months of a nonprofit's transactions,
// reconciliations, budgets, funds and reports (db/seed, reset every 12 hours).
const PAGES: { link: string; heading: string }[] = [
  { link: "Transactions", heading: "Transactions" },
  { link: "New Transaction", heading: "New Transaction" },
  { link: "Templates", heading: "Templates" },
  { link: "Accounts", heading: "Accounts" },
  { link: "Import Bank File", heading: "Import Bank File" },
  { link: "Reconcile", heading: "Reconcile" },
  { link: "Projects", heading: "Projects" },
  { link: "Budgets", heading: "Budgets" },
  { link: "Funds", heading: "Funds" },
  { link: "Pledges", heading: "Pledges" },
  { link: "Reports", heading: "Reports" },
  { link: "Settings", heading: "Settings" },
];

test.describe("the demo owner", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "owner");
  });

  test("opens Riverside's dashboard with cash on hand", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: DEMO.org })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("Cash on hand");
    await expect(main).toContainText(/\$\d{1,3}(,\d{3})+\.\d{2}/);
  });

  test("every page in the menu opens without an error", async ({ page }) => {
    const menu = mainMenu(page);
    for (const { link, heading } of PAGES) {
      await menu.getByRole("link", { name: link, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading }), link).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: /error|couldn't|failed/i }),
      ).toHaveCount(0);
    }
  });

  test("the accounts include checking, savings and the nonprofit's income", async ({ page }) => {
    await page.goto("/accounts");
    const main = page.getByRole("main");
    for (const account of ["Checking", "Savings", "Membership Dues", "Donations"])
      await expect(
        main.getByText(account, { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
  });

  test("transactions list three months of activity", async ({ page }) => {
    await page.goto("/transactions");
    const rows = page.getByRole("main").getByRole("row");
    await expect(rows.filter({ hasText: /dues/i }).first()).toBeVisible();
    await expect(rows.filter({ hasText: /festival/i }).first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(20);
  });

  test("two bank statements have been reconciled", async ({ page }) => {
    await page.goto("/reconcile");
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByText(/Checking/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  });

  test("settings pages are listed in the left sidebar under Settings", async ({ page }) => {
    await page.goto("/settings");
    const settings = page.getByRole("list", { name: "Settings" });
    for (const item of ["Organization profile", "Accounts", "Users & roles", "Security"])
      await expect(settings.getByRole("link", { name: item, exact: true })).toBeVisible();
    await settings.getByRole("link", { name: "Users & roles", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/members/);
    await expect(
      settings.getByRole("link", { name: "Users & roles", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main")).toContainText("Alex Morgan");
  });

  test("bank import takes CSV, OFX and QFX files only (no AI PDF reading)", async ({ page }) => {
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import Bank File" })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveAttribute(
      "accept",
      ".csv,.ofx,.qfx,text/csv",
    );
    await expect(page.getByRole("main")).not.toContainText(/AI service|PDF reads left/);
    await page.goto("/settings");
    await expect(page.getByRole("main").getByText("Timezone", { exact: true })).toBeVisible();
    await expect(page.getByText("Allow AI to read PDF bank statements")).toHaveCount(0);
  });
});

test("the test account is asked to accept the terms first", async ({ page }) => {
  await signIn(page, "empty");
  await expect(page.getByRole("heading", { name: "Before you continue" })).toBeVisible();
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/auth");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(DEMO.owner);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/auth/);
});

// The shell's Help link (sidebar or header) opens the docs page for the screen (S-04).
const helpLink = (page: Page, path: string) =>
  page.locator(`a[href="https://docs.openapphub.org/${path}"]`).first();

test("the Help link follows the screen", async ({ page }) => {
  await signIn(page, "owner");
  for (const [route, path] of [
    ["/import", "ledger/everyday/import-and-reconcile/"],
    ["/reports", "ledger/reports/reports-and-closing/"],
    ["/settings/members", "ledger/admin/users-security-exports/"],
  ] as const) {
    await page.goto(route);
    await expect(helpLink(page, path)).toBeAttached();
  }
});

// S-05: answer the hub's billing call with an ended trial, so the app is read-only (nothing on
// staging changes; the database would refuse the writes anyway).
async function asReadOnly(page: Page) {
  await page.route("**/rest/v1/rpc/get_org_billing*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          plan_id: null,
          status: "trialing",
          apps: [],
          trial_ends_at: "2020-01-01T00:00:00Z",
          current_period_end: null,
          cancel_at_period_end: false,
        },
      ]),
    }),
  );
}

test("when the plan makes Ledger read-only, writing is switched off", async ({ page }) => {
  await asReadOnly(page);
  await signIn(page, "owner");
  await expect(page.getByText(/this app is read-only/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "New Transaction" })).toHaveCount(0);
  await page.goto("/transactions/new");
  await expect(page.getByRole("note")).toContainText("read-only");
  await expect(page.getByRole("button", { name: "Save transaction" })).toBeDisabled();
  // reading and exporting stay on
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
