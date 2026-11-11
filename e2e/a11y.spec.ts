import { expect, test, type Page } from "./fixtures";
import { mainMenu, signIn } from "./helpers";

// Accessibility pass (WCAG 2.1 AA basics, as in OpenCharterApp): every visible control has an
// accessible name, each page has one level-1 heading and a language, and sign-in works by keyboard
// with visible focus. Contrast and screen-reader wording are checked by hand.
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="combobox"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"]';
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const textOf = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
    const name = (el: Element): string => {
      const aria = el.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map(textOf).join(" ").trim();
      const id = el.getAttribute("id");
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const wrap = el.closest("label");
      if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select")
        return (el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "").trim();
      const text = (el.textContent ?? "").trim();
      if (text) return text;
      const img = el.querySelector("img[alt], svg[aria-label]");
      return (
        img?.getAttribute("alt") ??
        img?.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        ""
      ).trim();
    };
    return [...document.querySelectorAll(sel)]
      .filter((el) => visible(el) && el.getAttribute("aria-hidden") !== "true")
      .filter((el) => !name(el))
      .map((el) => el.outerHTML.slice(0, 160));
  });
}

async function checkPage(page: Page, where: string) {
  await page.waitForLoadState("networkidle");
  expect(await page.locator("html").getAttribute("lang"), `${where}: page language`).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1 }), `${where}: one main heading`).toHaveCount(
    1,
  );
  expect(await unnamedControls(page), `${where}: controls without a name`).toEqual([]);
}

test("controls are named on every page in the menu", async ({ page }) => {
  await signIn(page, "owner");
  const links = await mainMenu(page)
    .getByRole("link")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  for (const href of links.filter(Boolean)) {
    await page.goto(href);
    await checkPage(page, href);
  }
});

test("sign-in works by keyboard alone, with visible focus", async ({ page }) => {
  await page.goto("/auth");
  await checkPage(page, "sign in");
  const email = page.getByLabel("Email");
  await email.focus();
  const ring = await email.evaluate((el) => {
    const s = getComputedStyle(el);
    return (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || s.boxShadow !== "none";
  });
  expect(ring, "focused field shows a focus indicator").toBe(true);
  await page.keyboard.type("test@demo.openapphub.org");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
});
