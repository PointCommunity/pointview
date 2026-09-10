import { expect, test } from "@playwright/test";

import { authenticate, fixtureIds } from "./fixtures";

test("a user sees only owned history and can request queued withdrawal", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mutation behavior is covered once; mobile layout is covered by read-only flows.");
  await authenticate(context, fixtureIds.user, "USER");
  await page.goto("/feedback");
  await expect(page.getByRole("heading", { level: 1, name: "Your feedback." })).toBeVisible();
  await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Fixture Owner")).toHaveCount(0);

  await page.route(`**/api/feedback/${fixtureIds.queued}`, (route) => route.fulfill({ status: 204 }));
  await page.goto(`/feedback/${fixtureIds.queued}`);
  await expect(page.getByText("Please improve the queue controls.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  const request = page.waitForRequest((candidate) => candidate.url().endsWith(`/api/feedback/${fixtureIds.queued}`));
  await page.getByRole("button", { name: "Withdraw feedback" }).click();
  expect((await request).method()).toBe("DELETE");
});

test("a user cannot open account administration", async ({ context, page }) => {
  await authenticate(context, fixtureIds.user, "USER");
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/feedback$/);
});
