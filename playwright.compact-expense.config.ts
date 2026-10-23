import { defineConfig } from "@playwright/test";
import base from "./playwright.account-details.config";

const baseServer =
  typeof base.webServer === "object" && !Array.isArray(base.webServer)
    ? base.webServer
    : {};
const baseEnvironment =
  typeof base.webServer === "object" && !Array.isArray(base.webServer)
    ? base.webServer.env
    : {};

export default defineConfig({
  ...base,
  testDir: "./tests/compact-expense-e2e",
  testMatch: process.env.COMPACT_EXPENSE_CAPTURE_BEFORE
    ? "**/before.capture.ts"
    : "**/*.spec.ts",
  outputDir: "test-results/compact-expense",
  use: { ...base.use, baseURL: "http://127.0.0.1:3251" },
  webServer: {
    ...baseServer,
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3251",
    url: "http://127.0.0.1:3251/login",
    env: {
      ...baseEnvironment,
      DATABASE_URL: "",
      FINANCE_CLOUD_ACCESS_MODE: "",
    },
  },
});
