import { defineConfig } from "@playwright/test";
import base from "./playwright.analytics-cards.config";

export default defineConfig({
  ...base,
  testDir: "./tests/final-ui-e2e",
  outputDir: "test-results/final-ui",
  use: { ...base.use, serviceWorkers: "block" },
});
