import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_RECEIPT_AI_MODEL,
  DEFAULT_RECEIPT_GATEWAY_MODEL,
} from "./src/lib/receipt-scan";

const prefix = "finance-os-private-e2e-";
const testRoot = process.env.FINANCE_PRIVATE_COMMERCE_E2E_ROOT
  ? path.resolve(process.env.FINANCE_PRIVATE_COMMERCE_E2E_ROOT)
  : mkdtempSync(path.join(tmpdir(), prefix));
const relativeRoot = path.relative(path.resolve(tmpdir()), testRoot);
if (
  relativeRoot.startsWith("..") ||
  path.isAbsolute(relativeRoot) ||
  !path.basename(testRoot).startsWith(prefix)
)
  throw new Error(
    "Commerce E2E data must use an isolated temporary directory.",
  );

// The test worker and server use one disposable, fictional profile.
process.env.FINANCE_PRIVATE_COMMERCE_E2E_ROOT = testRoot;
process.env.FINANCE_PRIVATE_DIR = testRoot;
process.env.FINANCE_PRIVATE_TEST_MODE = "true";
process.env.FINANCE_PRIVATE_ENABLED = "true";
process.env.AI_GATEWAY_API_KEY = "";
process.env.AI_GATEWAY_MODEL = DEFAULT_RECEIPT_GATEWAY_MODEL;
process.env.RECEIPT_AI_PROVIDER = "gemini";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.GOOGLE_API_KEY = "";
process.env.GOOGLE_GENERATIVE_AI_MODEL = DEFAULT_RECEIPT_AI_MODEL;

export default defineConfig({
  testDir: "./tests/private-e2e",
  testMatch: "commerce.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/commerce",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    baseURL: "http://127.0.0.1:3004",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3004",
    url: "http://127.0.0.1:3004/dashboard",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      FINANCE_PRIVATE_ENABLED: "true",
      FINANCE_PRIVATE_TEST_MODE: "true",
      FINANCE_PRIVATE_DIR: testRoot,
      AI_GATEWAY_API_KEY: "",
      AI_GATEWAY_MODEL: DEFAULT_RECEIPT_GATEWAY_MODEL,
      RECEIPT_AI_PROVIDER: "gemini",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      GOOGLE_GENERATIVE_AI_MODEL: DEFAULT_RECEIPT_AI_MODEL,
      LOCALAPPDATA: testRoot,
    },
  },
});
