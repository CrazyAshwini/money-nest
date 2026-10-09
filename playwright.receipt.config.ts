import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_RECEIPT_AI_MODEL } from "./src/lib/receipt-scan";

const prefix = "finance-os-private-e2e-";
const testRoot = process.env.FINANCE_PRIVATE_RECEIPT_E2E_ROOT
  ? path.resolve(process.env.FINANCE_PRIVATE_RECEIPT_E2E_ROOT)
  : mkdtempSync(path.join(tmpdir(), prefix));
const relativeRoot = path.relative(path.resolve(tmpdir()), testRoot);
if (
  relativeRoot.startsWith("..") ||
  path.isAbsolute(relativeRoot) ||
  !path.basename(testRoot).startsWith(prefix)
)
  throw new Error("Receipt E2E data must use an isolated temporary directory.");

// The worker and production server share only a synthetic, temporary profile.
process.env.FINANCE_PRIVATE_RECEIPT_E2E_ROOT = testRoot;
process.env.FINANCE_PRIVATE_DIR = testRoot;
process.env.FINANCE_PRIVATE_TEST_MODE = "true";
process.env.FINANCE_PRIVATE_ENABLED = "true";
// Never inherit an app owner's real cloud credentials into test processes.
process.env.AI_GATEWAY_API_KEY = "";
process.env.AI_GATEWAY_MODEL = DEFAULT_RECEIPT_AI_MODEL;

export default defineConfig({
  testDir: "./tests/private-e2e",
  testMatch: "receipt-scan.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/receipt-scan",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    baseURL: "http://127.0.0.1:3002",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3002",
    url: "http://127.0.0.1:3002/dashboard",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      FINANCE_PRIVATE_ENABLED: "true",
      FINANCE_PRIVATE_TEST_MODE: "true",
      FINANCE_PRIVATE_DIR: testRoot,
      AI_GATEWAY_API_KEY: "",
      AI_GATEWAY_MODEL: DEFAULT_RECEIPT_AI_MODEL,
      // Extra isolation if an explicit test override becomes unavailable.
      LOCALAPPDATA: testRoot,
    },
  },
});
