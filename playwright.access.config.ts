import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/access-e2e",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/public-access",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    baseURL: "http://127.0.0.1:3006",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3006",
    url: "http://127.0.0.1:3006/login",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      FINANCE_E2E_FIXTURES: "0",
      FINANCE_PRIVATE_ENABLED: "false",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      FINANCE_CLOUD_OWNER_ID: "",
      FINANCE_CLOUD_OWNER_EMAIL: "",
      APP_URL: "",
      AI_GATEWAY_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
    },
  },
});
