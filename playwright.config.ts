import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "npm run dev -- --port 3000",
    url: "http://127.0.0.1:3000/dashboard",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
