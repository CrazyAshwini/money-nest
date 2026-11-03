import {
  test as base,
  expect,
  type Page,
  type Locator,
  type BrowserContext,
  type Browser,
} from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDemoData } from "../../../src/lib/seed";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../../../src/lib/private-profile-store";
import type { WorkspaceData } from "../../../src/lib/types";
import {
  type ReceiptExtraction,
  type ReceiptScanResult,
} from "../../../src/lib/receipt-scan";

export const baseURL = "http://127.0.0.1:3002";

export const owner = randomUUID();

export const profileName = `Synthetic receipt tester ${randomBytes(5).toString("hex")}`;

export const email = `receipt.${randomBytes(5).toString("hex")}@example.test`;

const password = randomBytes(18).toString("base64url");

export const bankName = "Synthetic receipt bank";

export const merchant = "Synthetic Shopping Corner";

const imageReference = "SYNTHETIC-PAYMENT-RECEIPT-1";

export const receiptDescription =
  "Synthetic receipt shopping at Synthetic Shopping Corner";

export let reference = imageReference;

export let fingerprint = "1".repeat(64);

export const redactionLabel =
  "I removed personal, banking and other sensitive information from this image";

export type ReceiptProvider = "Google Gemini" | "Vercel AI Gateway";

export const syntheticModel = (provider: ReceiptProvider) =>
  provider === "Google Gemini"
    ? "synthetic-gemini-model"
    : "synthetic-gateway-model";

export const reviewLabel =
  "I checked the extracted details, selected the correct account, and reviewed possible duplicates.";

export let png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9sAAAAASUVORK5CYII=",
  "base64",
);

let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

export let testDirectory = "";

function guardedTestDirectory() {
  const root = path.resolve(process.env.FINANCE_PRIVATE_DIR ?? "");
  const relativeRoot = path.relative(path.resolve(tmpdir()), root);
  if (
    relativeRoot.startsWith("..") ||
    path.isAbsolute(relativeRoot) ||
    !path.basename(root).startsWith("finance-os-private-e2e-")
  )
    throw new Error("Refusing to use a non-test receipt profile directory.");
  return root;
}

function syntheticWorkspace(): WorkspaceData {
  const workspace = createDemoData();
  for (const rows of Object.values(workspace))
    for (const record of rows) record.userId = owner;
  workspace.accounts[0].name = bankName;
  return workspace;
}

export async function transactions(page: Page) {
  const response = await page.request.get("/api/workspace");
  expect(response.status()).toBe(200);
  return ((await response.json()).workspace as WorkspaceData).transactions;
}

export async function workspace(page: Page): Promise<WorkspaceData> {
  const response = await page.request.get("/api/workspace");
  expect(response.status()).toBe(200);
  return (await response.json()).workspace as WorkspaceData;
}

export async function chooseBalanceTreatments(
  dialog: Locator,
  treatment: "included" | "excluded" = "included",
) {
  for (const question of await dialog
    .getByRole("combobox", {
      name: /^Does the .+ balance already include this payment\?$/,
    })
    .all())
    await question.selectOption(treatment);
}

export async function chooseBank(dialog: Locator) {
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await chooseBalanceTreatments(dialog);
}

export async function openEditor(page: Page) {
  await page.goto("/transactions");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const dialog = page.locator(".transaction-modal");
  await expect(
    dialog.getByRole("textbox", { name: "Description", exact: true }),
  ).toBeVisible();
  return dialog;
}

export function receipt(dialog: Locator) {
  return dialog.page().locator(".receipt-modal");
}

export async function openScanner(dialog: Locator) {
  if (!(await receipt(dialog).isVisible())) {
    await dialog
      .getByRole("button", { name: "Upload Image", exact: true })
      .click();
  }
  await expect(receipt(dialog)).toBeVisible();
  return receipt(dialog);
}

export async function closeEditor(dialog: Locator) {
  if (await receipt(dialog).isVisible()) {
    await receipt(dialog)
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
}

export async function upload(dialog: Locator, filename = "synthetic-payment.png") {
  await openScanner(dialog);
  await receipt(dialog)
    .getByLabel("Payment screenshot or shopping receipt")
    .setInputFiles({ name: filename, mimeType: "image/png", buffer: png });
}

export async function assertNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 1);
}

export async function mockSettings(
  page: Page,
  configured = true,
  provider: ReceiptProvider = "Vercel AI Gateway",
) {
  await page.route("**/api/ai/settings", async (route) => {
    // Browser mocks never create a real credential or contact a cloud provider.
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        available: true,
        configured,
        ownerManaged: true,
        provider,
        model: syntheticModel(provider),
        requiresRedaction: provider === "Google Gemini",
      },
    });
  });
}

export function scanResult(
  overrides: Partial<ReceiptExtraction> = {},
  provider: ReceiptProvider = "Vercel AI Gateway",
): ReceiptScanResult {
  return {
    extraction: {
      documentType: "payment",
      amount: "125.50",
      currency: "INR",
      occurredOn: "2026-10-09",
      merchant,
      description: receiptDescription,
      kind: "expense",
      category: "Shopping",
      externalReference: reference,
      accountHint: "Synthetic bank ending 1234",
      paymentStatus: "successful",
      confidence: "high",
      warnings: [],
      ...overrides,
    },
    fingerprint,
    provider,
    model: syntheticModel(provider),
  };
}

export function batchScanResult(
  entries: Array<Partial<ReceiptExtraction>>,
  fingerprintPrefix: string,
): ReceiptScanResult {
  const extractions = entries.map(
    (entry, index) =>
      scanResult({
        platform: "Amazon",
        merchant: null,
        description: `Synthetic order ${fingerprintPrefix}-${index + 1}`,
        externalReference: `SYNTHETIC-BATCH-${fingerprintPrefix}-${index + 1}`,
        ...entry,
      }).extraction,
  );
  const fingerprints = extractions.map((_, index) =>
    `${fingerprintPrefix}${index.toString(16)}`.padEnd(64, "0"),
  );
  return {
    ...scanResult(),
    extraction: extractions[0],
    fingerprint: fingerprints[0],
    extractions,
    fingerprints,
  };
}

export async function mockScan(page: Page, response = scanResult()) {
  await page.route("**/api/ai/receipt", async (route) => {
    expect(route.request().method()).toBe("POST");
    const contentType = route.request().headers()["content-type"];
    expect(contentType).toContain("multipart/form-data");
    const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": contentType },
      },
    ).formData();
    const requiresRedaction = response.provider === "Google Gemini";
    expect(form.getAll("consent")).toEqual(["true"]);
    expect(form.getAll("provider")).toEqual([
      requiresRedaction ? "gemini" : "gateway",
    ]);
    expect(form.getAll("model")).toEqual([response.model]);
    expect(form.getAll("redacted")).toEqual(requiresRedaction ? ["true"] : []);
    expect([...form.keys()].sort()).toEqual(
      requiresRedaction
        ? ["consent", "image", "model", "provider", "redacted"]
        : ["consent", "image", "model", "provider"],
    );
    expect(body.includes(profileName)).toBe(false);
    expect(body.toLowerCase().includes(email)).toBe(false);
    expect(body.includes(owner)).toBe(false);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: response,
    });
  });
}

export async function scan(dialog: Locator) {
  await upload(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
}

async function setupReceiptProfile(browser: Browser) {
  testDirectory = guardedTestDirectory();
  expect(privateProfileDirectory()).toBe(testDirectory);
  const { setupToken } = await provisionPrivateProfile(
    syntheticWorkspace(),
    profileName,
  );
  const context = await browser.newContext({ baseURL });
  try {
    const fixturePage = await context.newPage();
    const fixtureDataURL = await fixturePage.evaluate(
      ({ merchantName, paymentReference }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 420;
        const drawing = canvas.getContext("2d");
        if (!drawing) throw new Error("Synthetic receipt canvas unavailable.");
        drawing.fillStyle = "#ffffff";
        drawing.fillRect(0, 0, canvas.width, canvas.height);
        drawing.fillStyle = "#176b42";
        drawing.font = "bold 32px sans-serif";
        drawing.fillText("SYNTHETIC PAYMENT", 32, 56);
        drawing.font = "24px sans-serif";
        drawing.fillText("Payment successful", 32, 100);
        drawing.fillStyle = "#151515";
        drawing.font = "bold 48px sans-serif";
        drawing.fillText("INR 125.50", 32, 172);
        drawing.font = "24px sans-serif";
        drawing.fillText(merchantName, 32, 230);
        drawing.fillText("9 October 2026", 32, 274);
        drawing.font = "18px monospace";
        drawing.fillText(paymentReference, 32, 326);
        drawing.font = "16px sans-serif";
        drawing.fillStyle = "#666666";
        drawing.fillText(
          "Test fixture only - no real payment or account",
          32,
          382,
        );
        return canvas.toDataURL("image/png");
      },
      { merchantName: merchant, paymentReference: imageReference },
    );
    png = Buffer.from(fixtureDataURL.split(",")[1], "base64");
    await fixturePage.close();
    const response = await context.request.post("/api/profile", {
      headers: { Origin: baseURL },
      data: {
        action: "setup",
        token: setupToken,
        displayName: profileName,
        email,
        password,
      },
    });
    expect(response.ok()).toBe(true);
    cookies = await context.cookies(baseURL);
    expect(cookies.some((cookie) => cookie.httpOnly)).toBe(true);
  } finally {
    await context.close();
  }
}

async function prepareReceiptReference(context: BrowserContext) {
  // The suite shares one profile. Independent synthetic scans must not claim
  // that they came from an earlier screenshot or payment reference.
  reference = `SYNTHETIC-PAYMENT-${randomUUID()}`;
  fingerprint = randomBytes(32).toString("hex");
  await context.addCookies(cookies);
}

async function cleanupReceiptProfile() {
  const safeRoot = guardedTestDirectory();
  if (testDirectory && safeRoot === testDirectory)
    await rm(safeRoot, { recursive: true, force: true });
  cookies = [];
}

// Worker scope preserves one shared synthetic profile across every scenario file.
// Automatic fixtures run for every file; setup does not depend on import-time hooks.
export const test = base.extend<
  { _receiptReference: void },
  { _receiptProfile: void }
>({
  _receiptProfile: [
    async ({ browser }, use) => {
      try {
        await setupReceiptProfile(browser);
        await use();
      } finally {
        await cleanupReceiptProfile();
      }
    },
    { scope: "worker", auto: true },
  ],
  _receiptReference: [
    async ({ context }, use) => {
      await prepareReceiptReference(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
