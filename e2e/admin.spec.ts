import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { authenticate, fixtureIds } from "./fixtures";

test("Owner account controls enforce optimistic versioning in the browser", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mutation behavior is covered once; mobile layout is covered by read-only flows.");
  await authenticate(context, fixtureIds.owner, "OWNER");
  await page.route(`**/api/admin/accounts/${fixtureIds.pending}`, async (route) => {
    const request = route.request();
    expect(request.headers()["if-match"]).toBe('"1"');
    expect(request.headers()["x-csrf-token"]).toHaveLength(43);
    expect(await request.postDataJSON()).toEqual({ role: "ADMIN", status: "ACTIVE" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: fixtureIds.pending, email: "pending@example.test", displayName: "Pending Teammate", role: "ADMIN", status: "ACTIVE", version: 2 }) });
  });
  await page.goto("/admin/accounts");
  const row = page.getByRole("listitem").filter({ hasText: "Pending Teammate" });
  await row.getByLabel("Role").selectOption("ADMIN");
  await row.getByLabel("Status").selectOption("ACTIVE");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Pending Teammate updated.");
});

test("Owner source controls show validation and history without secrets", async ({ context, page }) => {
  await authenticate(context, fixtureIds.owner, "OWNER");
  await page.goto("/admin/source-apps");
  await expect(page.getByRole("heading", { level: 1, name: "Source integrations." })).toBeVisible();
  await expect(page.getByText(/VALID · version 1/)).toBeVisible();
  await expect(page.getByText(/private key|github token|openai key/i)).toHaveCount(0);
  const editor = page.getByLabel("Public integration configuration").first();
  await editor.fill("not-json");
  await page.getByRole("button", { name: "Validate and save" }).first().click();
  await expect(page.getByRole("status")).toContainText("configuration must be valid JSON");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("operations distinguish queue, attention, completion, usage, and rate-limit state", async ({ context, page }) => {
  await authenticate(context, fixtureIds.admin, "ADMIN");
  await page.goto("/admin/operations");
  await expect(page.getByRole("heading", { level: 1, name: "Daily triage health." })).toBeVisible();
  const metrics = page.getByRole("region", { name: "Triage metrics" });
  await expect(metrics).toContainText("Queued");
  await expect(metrics).toContainText("Needs attention");
  await expect(metrics).toContainText("Estimated model cost");
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
});

test("operator detail exposes minimized proof and append-only controls", async ({ context, page }) => {
  await authenticate(context, fixtureIds.admin, "ADMIN");
  await page.goto(`/feedback/${fixtureIds.triaged}`);
  await expect(page.getByRole("heading", { level: 2, name: "Decision and evidence audit" })).toBeVisible();
  await expect(page.getByText("Decisions (1)")).toBeVisible();
  await expect(page.getByText("Evidence (1)")).toBeVisible();
  await expect(page.getByText("GitHub readbacks (1)")).toBeVisible();
  await expect(page.getByText("Model usage (1)")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Operator actions" })).toBeVisible();
  await expect(page.getByText(/PRIVATE KEY|api-key-value|raw model output/)).toHaveCount(0);
});

test("settings are Owner-only and expose references rather than secret values", async ({ context, page }) => {
  await authenticate(context, fixtureIds.owner, "OWNER");
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Triage policy." })).toBeVisible();
  await expect(page.getByLabel("Raw retention days")).toHaveValue("180");
  await expect(page.getByLabel("External secret reference")).toHaveValue("op://pointview/openai/api-key");
  await expect(page.getByText(/secret value/i)).toBeVisible();
});
