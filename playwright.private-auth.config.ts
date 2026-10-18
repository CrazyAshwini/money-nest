import { defineConfig } from "@playwright/test";
import privateProfileConfig from "./playwright.private.config";

const server = privateProfileConfig.webServer;
if (!server || Array.isArray(server))
  throw new Error(
    "Private auth tests require the isolated private-profile server.",
  );

// Reuse the guarded synthetic temporary root, never a real private profile.
export default defineConfig({
  ...privateProfileConfig,
  testMatch: "private-auth.spec.ts",
  outputDir: "test-results/private-auth",
  use: {
    ...privateProfileConfig.use,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    ...server,
    env: {
      ...server.env,
      FINANCE_E2E_FIXTURES: "false",
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
      VERCEL: "",
      VERCEL_ENV: "",
      VERCEL_URL: "",
      VERCEL_PROJECT_PRODUCTION_URL: "",
    },
  },
});
