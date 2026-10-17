import { defineConfig, devices } from "@playwright/test";

// Build with the same credentials-free environment before running this suite.
// Auth and workspace responses are synthetic browser mocks; no Supabase email is sent.
export default defineConfig({
  testDir: "./tests/signup-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/signup-otp",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    baseURL: "http://127.0.0.1:3007",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    // Explicit, sanitized screenshots below are the only retained browser images.
    screenshot: "off",
    video: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3007",
    url: "http://127.0.0.1:3007/login",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      FINANCE_E2E_FIXTURES: "false",
      FINANCE_PRIVATE_ENABLED: "false",
      FINANCE_PRIVATE_TEST_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_ACCESS_TOKEN: "",
      FINANCE_CLOUD_OWNER_ID: "",
      FINANCE_CLOUD_OWNER_EMAIL: "",
      APP_URL: "",
      DATABASE_URL: "",
      CRON_SECRET: "",
      AI_GATEWAY_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      VERCEL: "",
      VERCEL_ENV: "",
      VERCEL_URL: "",
      VERCEL_PROJECT_PRODUCTION_URL: "",
    },
  },
});
