import { pathToFileURL } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const documents = ["architecture", "source-app-integration", "operations", "privacy-and-retention"];

for (const documentName of documents) {
  test(`${documentName} documentation is responsive and accessible`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(pathToFileURL(`${process.cwd()}/docs/${documentName}.html`).href);

    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Documentation" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
