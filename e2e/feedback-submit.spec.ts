import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { authenticate, fixtureIds } from "./fixtures";

test.beforeEach(async ({ context }) => authenticate(context, fixtureIds.user, "USER", true));

test("verified-context form asks for feedback and optional screenshots only", async ({ page }) => {
  await page.goto("/feedback/new");
  await expect(page.getByRole("heading", { level: 1, name: "Tell us what you found." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Fixture App" })).toBeVisible();
  await expect(page.getByText("canary", { exact: true })).toBeVisible();
  await expect(page.getByText("fixture-revision", { exact: true })).toBeVisible();
  await expect(page.getByText(/raw content is deleted 180 days after triage finishes/i)).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText(/repository|project|github label/i)).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("submission shows a safe server error and preserves the form", async ({ page }) => {
  await page.route("**/api/feedback", (route) => route.fulfill({
    status: 413,
    contentType: "application/problem+json",
    body: JSON.stringify({ title: "Screenshot is too large", correlationId: "safe-reference" }),
  }));
  await page.goto("/feedback/new");
  await page.getByLabel("What should we know?").fill("The profile form needs better validation.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(page.locator(".form-status[role='alert']")).toContainText("Screenshot is too large Reference: safe-reference");
  await expect(page.getByLabel("What should we know?")).toHaveValue("The profile form needs better validation.");
});
