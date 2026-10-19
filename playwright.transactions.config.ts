import { defineConfig } from "@playwright/test";
import base from "./playwright.analytics-cards.config";

export default defineConfig({
  ...base,
  testDir: "./tests/transactions-e2e",
  testMatch: process.env.TRANSACTIONS_CAPTURE_BEFORE
    ? "**/before.capture.ts"
    : "**/*.spec.ts",
  outputDir: "test-results/transactions",
});
