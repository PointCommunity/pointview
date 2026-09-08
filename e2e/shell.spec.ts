import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "phone", width: 320, height: 720 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1280, height: 900 },
]) {
  test(`shell is usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Feedback without the routing work." })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Waiting for a verified product launch");
    await expect.poll(() => page.locator("html").evaluate(() => document.defaultView?.performance.getEntriesByType("navigation").length)).toBe(1);
    const response = await page.request.get("/");
    expect(response.headers()["content-security-policy"]).toContain("script-src 'self' 'nonce-");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("skip link reaches main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
});
