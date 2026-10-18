import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./tests/refinement-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results/refinement",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    baseURL: "http://127.0.0.1:3020",
    viewport: { width: 1440, height: 1000 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    launchOptions: {
      executablePath: chromiumPath,
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3020",
    url: "http://127.0.0.1:3020/login",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      FINANCE_PRIVATE_ENABLED: "false",
      FINANCE_PRIVATE_TEST_MODE: "false",
      FINANCE_PRIVATE_DIR: "",
      FINANCE_E2E_FIXTURES: "0",
      FINANCE_ALLOW_SIGNUP: "false",
      AI_GATEWAY_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
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
      VERCEL: "",
      VERCEL_ENV: "",
      VERCEL_URL: "",
      VERCEL_PROJECT_PRODUCTION_URL: "",
    },
  },
});
