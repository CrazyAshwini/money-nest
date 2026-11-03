import { defineConfig } from "@playwright/test";
import base from "./playwright.compact-expense.config";
export default defineConfig({
  ...base,
  testDir: "./tests/moneynest-upgrade-e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/moneynest-upgrade",
});
