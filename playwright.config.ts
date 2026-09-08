import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: "npm run e2e:prepare && npm run dev -- --hostname 127.0.0.1 --port 3210",
    url: "http://127.0.0.1:3210/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
