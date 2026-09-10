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

test("Owner administration makes AI provider setup discoverable", async ({ context, page }) => {
  await authenticate(context, fixtureIds.owner, "OWNER");
  await page.goto("/admin/source-apps");

  const providerLink = page.getByRole("link", { name: "AI providers" });
  await expect(providerLink).toBeVisible();
  await expect(providerLink).toHaveAttribute("href", "/admin/settings");
  await providerLink.click();

  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("heading", { level: 2, name: "Connect an AI service" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Admin navigation does not advertise Owner-only controls", async ({ context, page }) => {
  await authenticate(context, fixtureIds.admin, "ADMIN");
  await page.goto("/admin/operations");

  await expect(page.getByRole("navigation", { name: "Administration" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Operations" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "AI providers" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Source apps" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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

test("settings explain provider setup and hide technical policy fields", async ({ context, page }) => {
  await authenticate(context, fixtureIds.owner, "OWNER");
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Set up automatic triage." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Connect an AI service" })).toBeVisible();
  await expect(page.getByText(/Ollama Cloud is connected|Connected · 1 models available/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with ChatGPT" })).toBeVisible();
  await expect(page.getByLabel("AI model")).toHaveValue("OLLAMA_CLOUD::fixture-ollama");
  await expect(page.getByLabel("Keep original feedback for")).toHaveValue("180");
  await expect(page.getByText("This model is text-only. PointView will use screenshot details but will not send image files to it.")).toBeVisible();
  await expect(page.getByText(/prompt text|schema text|token|timeout|secret reference|retrieval limits/i)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("settings provider errors use plain language and remain recoverable", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Provider mutation behavior is covered once; mobile layout is covered above.");
  await authenticate(context, fixtureIds.owner, "OWNER");
  await page.route("**/api/admin/providers/OLLAMA_CLOUD", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/admin/providers", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { provider: "OLLAMA_CLOUD", status: "DISCONNECTED", credentialConfigured: false, planType: null, models: [], lastVerifiedAt: null, failureCode: null, version: 2 },
      { provider: "OPENAI_CODEX", status: "DISCONNECTED", credentialConfigured: false, planType: null, models: [], lastVerifiedAt: null, failureCode: null, version: 0 },
    ]) });
  });
  await page.route("**/api/admin/providers/ollama", async (route) => {
    expect(await route.request().postDataJSON()).toEqual({ apiKey: "not-a-real-key", expectedVersion: 2 });
    await route.fulfill({ status: 400, contentType: "application/problem+json", body: JSON.stringify({ title: "Ollama Cloud did not accept that API key" }) });
  });
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("Ollama Cloud API key")).toBeVisible();
  await page.getByLabel("Ollama Cloud API key").fill("not-a-real-key");
  await page.getByRole("button", { name: "Connect Ollama Cloud" }).click();
  await expect(page.getByRole("status")).toContainText("Ollama Cloud did not accept that API key");
  await expect(page.getByRole("button", { name: "Connect Ollama Cloud" })).toBeEnabled();
});

test("ChatGPT sign-in presents a browser-safe device code", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Device authorization behavior is covered once; mobile layout is covered above.");
  await authenticate(context, fixtureIds.owner, "OWNER");
  await page.route("**/api/admin/providers/codex/device", async (route) => {
    expect(await route.request().postDataJSON()).toEqual({ expectedVersion: 0 });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      sessionId: "018f4f6d-7c00-7000-8000-000000000777",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
      expiresAt: "2026-09-09T06:00:00.000Z",
    }) });
  });
  await page.route("**/api/admin/providers/codex/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "WAITING" }) });
  });
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Sign in with ChatGPT" }).click();
  await expect(page.getByText("ABCD-1234")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open ChatGPT sign-in" })).toHaveAttribute("href", "https://auth.openai.com/codex/device");
  await expect(page.getByText("This page will update automatically after you approve access.")).toBeVisible();
});
