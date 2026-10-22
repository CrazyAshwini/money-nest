import { defineConfig } from "@playwright/test";
import base from "./playwright.account-details.config";

export default defineConfig({
  ...base,
  testDir: "./tests/accounts-redesign-e2e",
  testMatch: process.env.ACCOUNTS_CAPTURE_BEFORE
    ? "**/before.capture.ts"
    : "**/*.spec.ts",
  outputDir: "test-results/accounts-redesign",
  use: { ...base.use, baseURL: "http://127.0.0.1:3233" },
  webServer: {
    ...base.webServer,
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3233",
    url: "http://127.0.0.1:3233/login",
    env: {
      ...(typeof base.webServer === "object" && !Array.isArray(base.webServer)
        ? base.webServer.env
        : {}),
      DATABASE_URL: "",
      FINANCE_CLOUD_ACCESS_MODE: "",
    },
  },
});
