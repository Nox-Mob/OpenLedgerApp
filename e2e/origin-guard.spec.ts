import { expect, test } from "./fixtures";

// The test browser reaches only the app and its backend; anything else is blocked before it
// leaves the machine.
test("requests to other sites are blocked", async ({ page }) => {
  await page.goto("/auth");
  const outside = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/", { mode: "no-cors" });
      return "reached";
    } catch {
      return "blocked";
    }
  });
  expect(outside).toBe("blocked");
  await expect(page.getByLabel("Email")).toBeVisible();
});
