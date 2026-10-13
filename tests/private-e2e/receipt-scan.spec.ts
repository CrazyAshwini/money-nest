import {
  test,
  expect,
  type Page,
  type Locator,
  type BrowserContext,
} from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Decimal from "decimal.js";
import { createDemoData } from "../../src/lib/seed";
import { formatMoney } from "../../src/lib/finance";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../../src/lib/private-profile-store";
import type { WorkspaceData } from "../../src/lib/types";
import {
  DEFAULT_RECEIPT_AI_MODEL,
  type ReceiptExtraction,
  type ReceiptScanResult,
} from "../../src/lib/receipt-scan";

const baseURL = "http://127.0.0.1:3002";
const owner = randomUUID();
const profileName = `Synthetic receipt tester ${randomBytes(5).toString("hex")}`;
const email = `receipt.${randomBytes(5).toString("hex")}@example.test`;
const password = randomBytes(18).toString("base64url");
const bankName = "Synthetic receipt bank";
const merchant = "Synthetic Shopping Corner";
const reference = "SYNTHETIC-PAYMENT-RECEIPT-1";
const receiptDescription =
  "Synthetic receipt shopping at Synthetic Shopping Corner";
const fingerprint = "1".repeat(64);
const redactionLabel =
  "I removed personal, banking and other sensitive information from this image";
type ReceiptProvider = "Google Gemini" | "Vercel AI Gateway";
const syntheticModel = (provider: ReceiptProvider) =>
  provider === "Google Gemini"
    ? "synthetic-gemini-model"
    : "synthetic-gateway-model";
const reviewLabel =
  "I checked the extracted details, selected the correct account, and reviewed possible duplicates.";
let png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9sAAAAASUVORK5CYII=",
  "base64",
);
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
let testDirectory = "";

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

async function transactions(page: Page) {
  const response = await page.request.get("/api/workspace");
  expect(response.status()).toBe(200);
  return ((await response.json()).workspace as WorkspaceData).transactions;
}

async function openEditor(page: Page) {
  await page.goto("/transactions");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const dialog = page.locator(".transaction-modal");
  await expect(
    dialog.getByRole("textbox", { name: "Description", exact: true }),
  ).toBeVisible();
  return dialog;
}

function receipt(dialog: Locator) {
  return dialog.page().locator(".receipt-modal");
}

async function openScanner(dialog: Locator) {
  if (!(await receipt(dialog).isVisible())) {
    await dialog
      .getByRole("button", { name: "Upload Image", exact: true })
      .click();
  }
  await expect(receipt(dialog)).toBeVisible();
  return receipt(dialog);
}

async function closeEditor(dialog: Locator) {
  if (await receipt(dialog).isVisible()) {
    await receipt(dialog)
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
}

async function upload(dialog: Locator, filename = "synthetic-payment.png") {
  await openScanner(dialog);
  await receipt(dialog)
    .getByLabel("Payment screenshot or shopping receipt")
    .setInputFiles({ name: filename, mimeType: "image/png", buffer: png });
}

async function assertNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function mockSettings(
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

function scanResult(
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

function batchScanResult(
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

async function mockScan(page: Page, response = scanResult()) {
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

async function scan(dialog: Locator) {
  await upload(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
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
      { merchantName: merchant, paymentReference: reference },
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
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test.afterAll(async () => {
  const safeRoot = guardedTestDirectory();
  if (testDirectory && safeRoot === testDirectory)
    await rm(safeRoot, { recursive: true, force: true });
  cookies = [];
});

test("real AI endpoints protect sessions and origins and reject user-owned configuration", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/ai/settings")).status()).toBe(401);
  expect(
    (
      await request.post("/api/ai/settings", {
        headers: { Origin: baseURL },
        data: { action: "remove" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/ai/receipt", { headers: { Origin: baseURL } })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/ai/settings", {
        data: { action: "remove" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/ai/receipt", {
        headers: { Origin: "https://example.invalid" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get("/api/ai/settings", {
        headers: { Host: "example.invalid" },
      })
    ).status(),
  ).toBe(403);
  const status = await page.request.get("/api/ai/settings");
  expect(status.status()).toBe(200);
  expect(status.headers()["cache-control"]).toContain("no-store");
  expect(await status.json()).toMatchObject({
    available: true,
    configured: false,
    ownerManaged: true,
    provider: "Google Gemini",
    requiresRedaction: true,
  });
  const noKey = await page.request.post("/api/ai/receipt", {
    headers: { Origin: baseURL },
    multipart: {
      consent: "true",
      provider: "gemini",
      model: DEFAULT_RECEIPT_AI_MODEL,
      image: { name: "synthetic.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(noKey.status()).toBe(409);
  expect((await noKey.json()).code).toBe("ai_not_configured");
  const envelopeBefore = await readFile(
    path.join(testDirectory, "profile.enc.json"),
    "utf8",
  );
  const key = `rejected-synthetic-key-${randomBytes(24).toString("hex")}`;
  const connected = await page.request.post("/api/ai/settings", {
    headers: { Origin: baseURL },
    data: { action: "connect", apiKey: key, model: DEFAULT_RECEIPT_AI_MODEL },
  });
  expect(connected.status()).toBe(403);
  const rejected = await connected.json();
  expect(rejected.code).toBe("owner_managed");
  expect(rejected).not.toHaveProperty("apiKey");
  expect(JSON.stringify(rejected).includes(key)).toBe(false);
  const removed = await page.request.post("/api/ai/settings", {
    headers: { Origin: baseURL },
    data: { action: "remove" },
  });
  expect(removed.status()).toBe(403);
  expect((await removed.json()).code).toBe("owner_managed");
  const metadata = await page.request.get("/api/ai/settings");
  expect((await metadata.json()).configured).toBe(false);
  const envelopeAfter = await readFile(
    path.join(testDirectory, "profile.enc.json"),
    "utf8",
  );
  expect(envelopeAfter === envelopeBefore).toBe(true);
  expect(envelopeAfter.includes(key)).toBe(false);
  // A user-supplied synthetic credential was rejected. Test environment keys
  // stay empty, so even the real endpoint checks cannot invoke a provider.
});

test("AI settings are read-only and offer no user key controls", async ({
  page,
}) => {
  // This uses the real metadata endpoint with the deliberately empty owner key.
  const settingsMethods: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/settings")
      settingsMethods.push(request.method());
  });
  await page.goto("/settings#ai");
  const panel = page.locator("#ai");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/app owner/).first()).toBeVisible();
  await expect(panel.getByText("Google Gemini", { exact: true })).toBeVisible();
  await expect(panel.getByText(/human reviewers/)).toBeVisible();
  await expect(panel.getByText(/Vercel AI Gateway|OpenAI/)).toHaveCount(0);
  await expect(panel.locator("input, select, textarea")).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: /Save.*(?:key|connection)|Connect AI|Remove.*(?:key|connection)/i,
    }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: /Get.*(?:API )?key|Gateway dashboard/i }),
  ).toHaveCount(0);
  await expect(
    panel.getByText(
      /AI_GATEWAY_API_KEY|AI_GATEWAY_MODEL|GEMINI_API_KEY|RECEIPT_AI_PROVIDER|\.env/,
    ),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await expect(panel.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect.poll(() => settingsMethods.length).toBeGreaterThanOrEqual(2);
  expect(settingsMethods.every((method) => method === "GET")).toBe(true);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await panel.screenshot({
    path: path.resolve("artifacts/receipt-ai-owner-settings.png"),
  });
});

test("unconfigured AI asks the owner to enable scanning without changing manual entries", async ({
  page,
}) => {
  await mockSettings(page, false);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await openScanner(dialog);
  await expect(
    receipt(dialog)
      .getByText(/app owner/)
      .first(),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByText("Connect AI", { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await expect(receipt(dialog).locator('input[type="password"]')).toHaveCount(
    0,
  );
  await upload(dialog);
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await receipt(dialog)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await dialog
    .locator('textarea[name="description"]')
    .fill("Manual synthetic payment");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("21.43");
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 1);
  expect(
    after.find((row) => row.description === "Manual synthetic payment")?.amount,
  ).toBe("21.43");
});

test("expense categories offer matching platforms and custom Stationery saves without extra inputs", async ({
  page,
}) => {
  await mockSettings(page, false);
  await page.setViewportSize({ width: 320, height: 800 });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  const category = dialog.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  const platform = dialog.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(
    category.getByRole("option", { name: "Stationery", exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.locator("summary", { hasText: "More details" }),
  ).toHaveCount(0);
  await category.selectOption("Food");
  for (const source of ["Swiggy", "Zomato", "Domino's", "Other"])
    await expect(
      platform.getByRole("option", { name: source, exact: true }),
    ).toHaveCount(1);
  await platform.selectOption("Swiggy");
  await category.selectOption("Stationery");
  await expect(platform).toHaveValue("");
  await expect(
    platform.getByRole("option", { name: "Swiggy", exact: true }),
  ).toHaveCount(0);
  await expect(
    platform.getByRole("option", {
      name: "Local stationery shop",
      exact: true,
    }),
  ).toHaveCount(1);
  await platform.selectOption("Other");
  const customSource = "Synthetic Paper Shop";
  await dialog
    .getByLabel("Other platform / source", { exact: true })
    .fill(customSource);
  await dialog
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Synthetic stationery expense");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("18.45");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-10-09");
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await assertNoOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await dialog.screenshot({
    path: path.resolve("artifacts/expense-platform-mobile.png"),
  });
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (await transactions(page)).find(
    (row) => row.description === "Synthetic stationery expense",
  );
  expect(await transactions(page)).toHaveLength(before.length + 1);
  expect(saved).toMatchObject({
    category: "Stationery",
    platform: customSource,
    merchant: null,
    amount: "18.45",
    status: "posted",
  });
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill("Synthetic stationery expense");
  await page
    .getByRole("button", {
      name: "Edit Synthetic stationery expense",
      exact: true,
    })
    .click();
  const editDialog = page.locator(".transaction-modal");
  await expect(
    editDialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Stationery");
  await editDialog.getByLabel("Amount · ₹", { exact: true }).fill("19.45");
  await editDialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(editDialog).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved?.id),
  ).toMatchObject({
    category: "Stationery",
    platform: customSource,
    merchant: null,
    amount: "19.45",
  });
});

test("receipt sheet offers camera and upload, and closing it preserves the expense draft", async ({
  page,
}) => {
  await mockSettings(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic camera draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("37.19");
  await dialog.getByRole("button", { name: "Take Photo", exact: true }).click();
  const sheet = receipt(dialog);
  await expect(
    sheet.getByRole("heading", { name: "Scan receipt", exact: true }),
  ).toBeVisible();
  const cameraInput = sheet.getByLabel("Take a receipt photo", { exact: true });
  await expect(cameraInput).toHaveAttribute("capture", "environment");
  await expect(cameraInput).toHaveAttribute(
    "accept",
    "image/png,image/jpeg,image/webp",
  );
  await expect(
    sheet.getByLabel("Payment screenshot or shopping receipt", { exact: true }),
  ).not.toHaveAttribute("capture");
  await expect(
    sheet.getByRole("checkbox", {
      name: "This receipt spans multiple photos (long bill)",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-camera-desktop.png"),
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await assertNoOverflow(page);
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-camera-mobile.png"),
  });
  const fileChooser = page.waitForEvent("filechooser");
  await sheet.getByRole("button", { name: "Camera", exact: true }).click();
  await (
    await fileChooser
  ).setFiles({
    name: "synthetic-camera.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic camera draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "37.19",
  );
  await openScanner(dialog);
  await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("long receipts send up to three ordered photos together and reset privacy acknowledgement when a photo changes", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  const before = await transactions(page);
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": route.request().headers()["content-type"] },
      },
    ).formData();
    const images = form.getAll("image") as File[];
    expect(images.map((image) => image.name)).toEqual([
      "synthetic-primary.png",
      "synthetic-page-2.png",
      "synthetic-page-3.png",
    ]);
    expect(images.map((image) => image.size)).toEqual([
      png.length,
      png.length,
      png.length,
    ]);
    expect(form.getAll("provider")).toEqual(["gemini"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Google Gemini")]);
    expect(form.getAll("redacted")).toEqual(["true"]);
    expect(form.getAll("consent")).toEqual(["true"]);
    expect([...form.keys()].sort()).toEqual([
      "consent",
      "image",
      "image",
      "image",
      "model",
      "provider",
      "redacted",
    ]);
    const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
    expect(body.includes(profileName)).toBe(false);
    expect(body.toLowerCase().includes(email)).toBe(false);
    expect(body.includes(owner)).toBe(false);
    await route.fulfill({
      status: 200,
      json: scanResult(
        { externalReference: null, accountHint: null },
        "Google Gemini",
      ),
    });
  });
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic long receipt draft");
  const sheet = await openScanner(dialog);
  const longBill = sheet.getByRole("checkbox", {
    name: "This receipt spans multiple photos (long bill)",
    exact: true,
  });
  await longBill.check();
  const primary = sheet.getByLabel("Payment screenshot or shopping receipt", {
    exact: true,
  });
  await expect(primary).toHaveAttribute("multiple", "");
  const photos = [
    "synthetic-primary.png",
    "synthetic-page-2.png",
    "synthetic-page-3.png",
  ].map((name) => ({ name, mimeType: "image/png", buffer: png }));
  await primary.setInputFiles(photos);
  const confirmation = sheet.getByRole("checkbox", {
    name: new RegExp(redactionLabel),
  });
  await expect(
    sheet.getByText("Confirm this for every photo.", { exact: true }),
  ).toBeVisible();
  const scanButton = sheet.getByRole("button", {
    name: "Scan with AI",
    exact: true,
  });
  await confirmation.check();
  await expect(scanButton).toBeEnabled();
  await sheet
    .getByLabel("Receipt photo 2", { exact: true })
    .setInputFiles(photos[1]);
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  await confirmation.check();
  await sheet
    .getByRole("button", { name: "Remove photo 3", exact: true })
    .click();
  await expect(confirmation).not.toBeChecked();
  await sheet
    .getByLabel("Receipt photo 3", { exact: true })
    .setInputFiles(photos[2]);
  await confirmation.check();
  await scanButton.click();
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  expect(scanRequests).toBe(1);
  expect((await transactions(page)).length).toBe(before.length);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic long receipt draft",
  );
  await sheet.getByRole("button", { name: "Use details", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "125.50",
  );
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("too many photos or more than five megabytes combined stay local", async ({
  page,
}) => {
  await mockSettings(page);
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected synthetic request." },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic large receipt draft");
  const sheet = await openScanner(dialog);
  await sheet
    .getByRole("checkbox", {
      name: "This receipt spans multiple photos (long bill)",
      exact: true,
    })
    .check();
  const primary = sheet.getByLabel("Payment screenshot or shopping receipt", {
    exact: true,
  });
  await primary.setInputFiles(
    [1, 2, 3, 4].map((pageNumber) => ({
      name: `synthetic-${pageNumber}.png`,
      mimeType: "image/png",
      buffer: png,
    })),
  );
  await expect(sheet.getByRole("alert")).toContainText(/3 photos|three photos/);
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  const paddedImage = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]);
  await primary.setInputFiles(
    [1, 2].map((pageNumber) => ({
      name: `synthetic-large-${pageNumber}.png`,
      mimeType: "image/png",
      buffer: paddedImage,
    })),
  );
  await expect(sheet.getByRole("alert")).toContainText(/5 MB/);
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  expect(scanRequests).toBe(0);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic large receipt draft",
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("Gemini requires redaction confirmation, resets it for a replacement image, and scans only the acknowledged upload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockSettings(page, true, "Google Gemini");
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const contentType = route.request().headers()["content-type"];
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": contentType },
      },
    ).formData();
    expect(form.getAll("consent")).toEqual(["true"]);
    expect(form.getAll("redacted")).toEqual(["true"]);
    expect(form.getAll("provider")).toEqual(["gemini"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Google Gemini")]);
    expect([...form.keys()].sort()).toEqual([
      "consent",
      "image",
      "model",
      "provider",
      "redacted",
    ]);
    await route.fulfill({
      status: 200,
      json: scanResult(
        { externalReference: null, accountHint: null },
        "Google Gemini",
      ),
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic Gemini manual draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("41.28");
  await openScanner(dialog);
  await expect(
    receipt(dialog).getByText(/Google may use uploads and responses/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByText(/human reviewers may review/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByText(/Remove names, addresses, phone\/email/),
  ).toBeVisible();
  await expect(receipt(dialog).getByText(/QR codes\/barcodes/)).toBeVisible();
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway|OpenAI/),
  ).toHaveCount(0);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-reference-desktop.png"),
  });
  await page.setViewportSize({ width: 360, height: 850 });
  await assertNoOverflow(page);
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-reference-mobile.png"),
  });
  await upload(dialog);
  const confirmation = receipt(dialog).getByRole("checkbox", {
    name: redactionLabel,
    exact: true,
  });
  const scanButton = receipt(dialog).getByRole("button", {
    name: "Scan with AI",
    exact: true,
  });
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  expect(scanRequests).toBe(0);
  await confirmation.check();
  await expect(scanButton).toBeEnabled();
  await upload(dialog, "replacement-synthetic-image.png");
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  expect(scanRequests).toBe(0);
  await confirmation.check();
  await assertNoOverflow(page);
  await confirmation.scrollIntoViewIfNeeded();
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-gemini-redaction-mobile.png"),
  });
  await scanButton.click();
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "INR 125.50",
  );
  expect(scanRequests).toBe(1);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic Gemini manual draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "41.28",
  );
  expect((await transactions(page)).length).toBe(before.length);
  await receipt(dialog)
    .getByRole("button", { name: "Remove image", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await upload(dialog, "new-synthetic-image.png");
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("provider changes clear Gemini acknowledgement and Gateway keeps its original scan flow", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  const dialog = await openEditor(page);
  await upload(dialog);
  await receipt(dialog)
    .getByRole("checkbox", { name: redactionLabel, exact: true })
    .check();
  await receipt(dialog)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.unroute("**/api/ai/settings");
  await mockSettings(page);
  await mockScan(page);
  await openScanner(dialog);
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway and OpenAI/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeEnabled();
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  await receipt(dialog)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.unroute("**/api/ai/settings");
  await mockSettings(page, true, "Google Gemini");
  await openScanner(dialog);
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toHaveCount(0);
  await closeEditor(dialog);
});

test("stale provider rejection preserves the draft and requires fresh provider acknowledgement", async ({
  page,
}) => {
  let switchedProvider = false;
  await page.route("**/api/ai/settings", async (route) => {
    const provider: ReceiptProvider = switchedProvider
      ? "Google Gemini"
      : "Vercel AI Gateway";
    await route.fulfill({
      status: 200,
      json: {
        configured: true,
        provider,
        model: syntheticModel(provider),
        requiresRedaction: switchedProvider,
      },
    });
  });
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": route.request().headers()["content-type"] },
      },
    ).formData();
    expect(form.getAll("provider")).toEqual(["gateway"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Vercel AI Gateway")]);
    switchedProvider = true;
    await route.fulfill({
      status: 409,
      json: {
        code: "provider_changed",
        error:
          "Receipt AI settings changed. Refresh availability and try again.",
      },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic stale provider draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("61.82");
  await upload(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI settings changed. Refresh availability and try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic stale provider draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "61.82",
  );
  expect(scanRequests).toBe(1);
  expect((await transactions(page)).length).toBe(before.length);
  await receipt(dialog)
    .getByRole("button", { name: "Retry receipt AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(/Google may use uploads and responses/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await closeEditor(dialog);
});

test("unknown or incomplete provider metadata fails closed without a misleading disclosure", async ({
  page,
}) => {
  let metadataState: "incomplete" | "unknown" | "valid" = "incomplete";
  await page.route("**/api/ai/settings", async (route) => {
    await route.fulfill({
      status: 200,
      json:
        metadataState === "valid"
          ? {
              configured: true,
              provider: "Google Gemini",
              model: "synthetic-gemini-model",
              requiresRedaction: true,
            }
          : metadataState === "unknown"
            ? {
                configured: true,
                provider: "Unknown synthetic provider",
                model: "synthetic-model",
                requiresRedaction: false,
              }
            : {
                configured: true,
                provider: "Google Gemini",
                model: "synthetic-gemini-model",
              },
    });
  });
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected synthetic request." },
    });
  });
  const dialog = await openEditor(page);
  await upload(dialog);
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway|OpenAI|Google may use/),
  ).toHaveCount(0);
  expect(scanRequests).toBe(0);
  await upload(dialog, "synthetic-metadata-replacement.png");
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await receipt(dialog)
    .getByRole("button", { name: "Remove image", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await upload(dialog, "synthetic-metadata-new.png");
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  metadataState = "unknown";
  await receipt(dialog)
    .getByRole("button", { name: "Retry receipt AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway|OpenAI|Google may use/),
  ).toHaveCount(0);
  expect(scanRequests).toBe(0);
  metadataState = "valid";
  await receipt(dialog)
    .getByRole("button", { name: "Retry receipt AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await closeEditor(dialog);
});

test("invalid or oversized images stay local and preserve manual form values", async ({
  page,
}) => {
  await mockSettings(page);
  let providerRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    providerRequests++;
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected synthetic request." },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Manual draft stays intact");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("81.27");
  await openScanner(dialog);
  const fileInput = receipt(dialog).getByLabel(
    "Payment screenshot or shopping receipt",
    { exact: false },
  );
  await fileInput.setInputFiles({
    name: "synthetic-receipt.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await expect(
    receipt(dialog).getByText("Choose a PNG, JPG, or WebP image.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await fileInput.setInputFiles({
    name: "oversized-synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(6 * 1024 * 1024),
  });
  await expect(receipt(dialog).getByText(/5 MB/).last()).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Manual draft stays intact",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "81.27",
  );
  expect(providerRequests).toBe(0);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("AI scan fills a reviewed draft only, then a chosen account saves to the real synthetic ledger", async ({
  page,
}) => {
  await mockSettings(page);
  await mockScan(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "INR 125.50",
  );
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    merchant,
  );
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    reference,
  );
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-review-desktop.png"),
  });
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue("");
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "",
  );
  expect((await transactions(page)).length).toBe(before.length);

  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    receiptDescription,
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "125.50",
  );
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-10-09",
  );
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.locator("summary", { hasText: "More details" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Bank reference", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Choose an account or name the external payer.", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await transactions(page)).length).toBe(before.length);
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  // Editing fields after confirmation requires another deliberate review.
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 1);
  const saved = after.find((row) => row.description === receiptDescription);
  expect(saved).toMatchObject({
    amount: "125.50",
    merchant,
    platform: null,
    occurredOn: "2026-10-09",
    currency: "INR",
    externalReference: reference,
    status: "posted",
    sourceSystem: "receipt_ai",
    sourceObjectId: fingerprint,
  });
  expect(Boolean(saved?.fromAccountId)).toBe(true);
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill(receiptDescription);
  await expect(
    page.getByRole("button", { name: receiptDescription, exact: true }),
  ).toHaveCount(1);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage.includes(receiptDescription)).toBe(false);
  expect(storage.includes(reference)).toBe(false);
  await page
    .getByRole("button", { name: `Edit ${receiptDescription}`, exact: true })
    .click();
  const editDialog = page.locator(".transaction-modal");
  await expect(
    editDialog.getByRole("button", { name: "Upload Image", exact: true }),
  ).toHaveCount(0);
  await expect(
    editDialog.getByRole("button", { name: "Take Photo", exact: true }),
  ).toHaveCount(0);
  await expect(
    editDialog.getByLabel("Amount · ₹", { exact: true }),
  ).toHaveValue("125.50");
  await editDialog.getByLabel("Amount · ₹", { exact: true }).fill("126.75");
  await editDialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(editDialog).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved?.id),
  ).toMatchObject({
    amount: "126.75",
    merchant,
    platform: null,
    externalReference: reference,
    status: "posted",
    sourceSystem: "receipt_ai",
    sourceObjectId: fingerprint,
  });
});

test("two receipt transactions require separate reviews and a lost save response retries the same ID", async ({
  page,
}) => {
  await mockSettings(page);
  const result = batchScanResult(
    [
      { amount: "1084.00", occurredOn: "2026-10-11" },
      { amount: "178.00", occurredOn: "2026-10-11" },
    ],
    "c",
  );
  await mockScan(page, result);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await upload(dialog);
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  for (const index of [1, 2])
    await expect(
      sheet.getByRole("checkbox", {
        name: `Select transaction ${index}`,
        exact: true,
      }),
    ).toBeChecked();
  await expect(sheet.getByLabel("AI receipt review")).toContainText(
    "INR 1084.00",
  );
  await expect(sheet.getByLabel("AI receipt review")).toContainText(
    "INR 178.00",
  );
  expect((await transactions(page)).length).toBe(before.length);
  await sheet.getByRole("button", { name: /^Use / }).click();
  await expect(
    dialog.getByText("Transaction 1 of 2", { exact: true }),
  ).toBeVisible();
  const saveAndNext = dialog.getByRole("button", {
    name: "Save and next",
    exact: true,
  });
  const confirmation = dialog.getByRole("checkbox", {
    name: reviewLabel,
    exact: true,
  });
  const fromAccount = dialog.getByRole("combobox", {
    name: "From account",
    exact: true,
  });
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "1084.00",
  );
  await expect(fromAccount).toHaveValue("");
  await expect(confirmation).not.toBeChecked();
  await expect(saveAndNext).toBeDisabled();
  await confirmation.check();
  await saveAndNext.click();
  await expect(dialog.getByRole("alert")).toContainText("Choose an account");
  expect((await transactions(page)).length).toBe(before.length);
  await fromAccount.selectOption({ label: bankName });
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();

  const submittedIds: string[] = [];
  let loseFirstResponse = true;
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as {
      collection: string;
      record: WorkspaceData["transactions"][number];
    };
    if (
      body.collection !== "transactions" ||
      !result.fingerprints?.includes(body.record.sourceObjectId ?? "")
    ) {
      await route.continue();
      return;
    }
    submittedIds.push(body.record.id);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      // The server committed; only its browser response is lost.
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic response lost after saving." },
      });
      return;
    }
    await route.continue();
  });
  await saveAndNext.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic response lost after saving.",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "1084.00",
  );
  expect((await transactions(page)).length).toBe(before.length + 1);
  await saveAndNext.click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "178.00",
  );
  await expect(
    dialog.getByText("Transaction 2 of 2", { exact: true }),
  ).toBeVisible();
  await expect(fromAccount).toHaveValue("");
  await expect(confirmation).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await fromAccount.selectOption({ label: bankName });
  await confirmation.check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 2);
  const saved = result.fingerprints!.map((sourceObjectId) => {
    const matches = after.filter(
      (row) => row.sourceObjectId === sourceObjectId,
    );
    expect(matches).toHaveLength(1);
    return matches[0];
  });
  expect(saved[0]).toMatchObject({
    amount: "1084.00",
    status: "posted",
    platform: "Amazon",
  });
  expect(saved[1]).toMatchObject({
    amount: "178.00",
    status: "posted",
    platform: "Amazon",
  });
  expect(saved[0].id).not.toBe(saved[1].id);
  expect(submittedIds).toEqual([saved[0].id, saved[0].id, saved[1].id]);
  await page.reload();
  expect(
    (await transactions(page)).filter((row) =>
      result.fingerprints!.includes(row.sourceObjectId ?? ""),
    ),
  ).toHaveLength(2);
});

test("more than two extracted transactions can exclude one and keep an uncertain payment in review", async ({
  page,
}) => {
  await mockSettings(page);
  await page.setViewportSize({ width: 360, height: 800 });
  const result = batchScanResult(
    [
      { amount: "40.25" },
      { amount: "55.50" },
      { amount: "61.25" },
      { amount: "96.75", paymentStatus: "failed" },
    ],
    "d",
  );
  await mockScan(page, result);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await upload(dialog);
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  for (const index of [1, 2, 3, 4])
    await expect(
      sheet.getByRole("checkbox", {
        name: `Select transaction ${index}`,
        exact: true,
      }),
    ).toBeChecked();
  for (const amount of ["40.25", "55.50", "61.25", "96.75"])
    await expect(sheet.getByLabel("AI receipt review")).toContainText(
      `INR ${amount}`,
    );
  await sheet
    .getByRole("checkbox", { name: "Select transaction 2", exact: true })
    .uncheck();
  await assertNoOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-batch-review-mobile.png"),
  });
  expect((await transactions(page)).length).toBe(before.length);
  await sheet.getByRole("button", { name: /^Use / }).click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "40.25",
  );
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "61.25",
  );
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("");
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "96.75",
  );
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByText(/This transaction will stay in Needs review/),
  ).toBeVisible();
  await assertNoOverflow(page);
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 3);
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![0]),
  ).toMatchObject({ amount: "40.25", status: "posted" });
  expect(
    after.some((row) => row.sourceObjectId === result.fingerprints![1]),
  ).toBe(false);
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![2]),
  ).toMatchObject({ amount: "61.25", status: "posted" });
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![3]),
  ).toMatchObject({ amount: "96.75", status: "pending_review" });
});

test("batch duplicate and foreign-currency warnings leave an independent INR transaction usable", async ({
  page,
}) => {
  await mockSettings(page);
  const result = batchScanResult(
    [
      { amount: "32.20" },
      { amount: "9.95", currency: "USD" },
      { amount: "68.40" },
    ],
    "e",
  );
  const template = (await transactions(page)).find(
    (row) =>
      row.kind === "expense" && row.status === "posted" && row.fromAccountId,
  );
  expect(template).toBeTruthy();
  const existing = {
    ...template!,
    id: randomUUID(),
    description: result.extractions![0].description!,
    amount: "32.20",
    occurredOn: "2026-10-09",
    externalReference: result.extractions![0].externalReference,
    sourceSystem: "receipt_ai",
    sourceObjectId: result.fingerprints![0],
  };
  const seedResponse = await page.request.post("/api/workspace", {
    headers: { Origin: baseURL },
    data: { collection: "transactions", record: existing },
  });
  expect(seedResponse.ok()).toBe(true);
  await mockScan(page, result);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await upload(dialog);
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 1", exact: true }),
  ).not.toBeChecked();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 2", exact: true }),
  ).toBeDisabled();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 3", exact: true }),
  ).toBeChecked();
  await expect(
    sheet.getByText("Possible duplicate transactions", { exact: true }),
  ).toBeVisible();
  await sheet
    .getByRole("button", { name: "Review transaction 2", exact: true })
    .click();
  await expect(
    sheet.getByText(/these details cannot be applied/),
  ).toBeVisible();
  expect((await transactions(page)).length).toBe(before.length);
  const apply = sheet.getByRole("button", { name: /^Use / });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "68.40",
  );
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 1);
  expect(
    after.filter((row) => row.sourceObjectId === result.fingerprints![0]),
  ).toHaveLength(1);
  expect(
    after.some((row) => row.sourceObjectId === result.fingerprints![1]),
  ).toBe(false);
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![2]),
  ).toMatchObject({ amount: "68.40", status: "posted" });
});

test("unconfirmed orders debit a bank only after explicit payment confirmation and each draft resets it", async ({
  page,
}) => {
  await mockSettings(page);
  const result = batchScanResult(
    [{ amount: "11.25" }, { amount: "12.50" }, { amount: "13.75" }].map(
      (entry) => ({
        ...entry,
        documentType: "receipt" as const,
        paymentStatus: "unknown" as const,
        occurredOn: "2026-10-11",
      }),
    ),
    "f",
  );
  await mockScan(page, result);
  await page.goto("/accounts");
  const balance = page
    .locator("a.bank-card")
    .filter({ hasText: bankName })
    .locator(":scope > strong");
  const baselineText = await balance.innerText();
  const baseline = new Decimal(baselineText.replace(/[^\d.-]/g, ""));
  const before = await transactions(page);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const dialog = page.locator(".transaction-modal");
  await upload(dialog);
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 3", exact: true }),
  ).toBeChecked();
  await sheet.getByRole("button", { name: /^Use / }).click();
  const paid = dialog.getByRole("checkbox", {
    name: "I confirmed that this payment was completed.",
    exact: true,
  });
  const review = dialog.getByRole("checkbox", {
    name: reviewLabel,
    exact: true,
  });
  const account = dialog.getByRole("combobox", {
    name: "From account",
    exact: true,
  });
  await expect(paid).not.toBeChecked();
  await account.selectOption({ label: bankName });
  await review.check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "12.50",
  );
  await expect(balance).toHaveText(baselineText);
  expect(
    (await transactions(page)).find(
      (row) => row.sourceObjectId === result.fingerprints![0],
    )?.status,
  ).toBe("pending_review");
  await expect(paid).not.toBeChecked();
  await account.selectOption({ label: bankName });
  await review.check();
  await paid.check();
  await expect(review).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save and next", exact: true }),
  ).toBeDisabled();
  await review.check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "13.75",
  );
  await expect(paid).not.toBeChecked();
  await expect(review).not.toBeChecked();
  await expect(account).toHaveValue("");
  await expect(balance).toHaveText(
    formatMoney(baseline.minus("12.50").toFixed(2)),
  );
  await account.selectOption({ label: bankName });
  await review.check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 3);
  expect(
    result.fingerprints!.map(
      (sourceObjectId) =>
        after.find((row) => row.sourceObjectId === sourceObjectId)?.status,
    ),
  ).toEqual(["pending_review", "posted", "pending_review"]);
  await expect(balance).toHaveText(
    formatMoney(baseline.minus("12.50").toFixed(2)),
  );
  await page.reload();
  await expect(balance).toHaveText(
    formatMoney(baseline.minus("12.50").toFixed(2)),
  );
});

test("possible duplicates warn before review and cancellation adds nothing", async ({
  page,
}) => {
  await mockSettings(page);
  await mockScan(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await expect(
    receipt(dialog).getByText("Possible duplicate transactions", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    receiptDescription,
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("foreign currency stays in review and cannot populate the INR form", async ({
  page,
}) => {
  await mockSettings(page);
  await mockScan(page, scanResult({ currency: "USD", amount: "9.95" }));
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog.locator('textarea[name="description"]').fill("Manual INR draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("77.89");
  await upload(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "USD 9.95",
  );
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByText(/these details cannot be applied/),
  ).toBeVisible();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Manual INR draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "77.89",
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("receipt scanning keeps the seller in Description and Swiggy in Platform through saving and editing", async ({
  page,
}) => {
  const seller = "Bikkgane Biryani";
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSettings(page);
  await mockScan(page, {
    ...scanResult({
      merchant: seller,
      platform: "Swiggy",
      description: "Lunch",
      category: "Food",
      amount: "28.00",
      externalReference: "SYNTHETIC-SELLER-PLATFORM-1",
    }),
    fingerprint: "b".repeat(64),
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  const platform = dialog.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(platform).toHaveValue("Swiggy");
  await expect(
    platform.getByRole("option", { name: seller, exact: true }),
  ).toHaveCount(0);
  const description = dialog.getByRole("textbox", {
    name: "Description",
    exact: true,
  });
  await expect(description).toHaveValue(/Bikkgane Biryani/);
  await expect(description).toHaveValue(/Lunch/);
  await assertNoOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await dialog.screenshot({
    path: path.resolve("artifacts/receipt-seller-platform-mobile.png"),
  });
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after).toHaveLength(before.length + 1);
  const saved = after.find((row) => row.sourceObjectId === "b".repeat(64));
  expect(saved).toMatchObject({
    merchant: seller,
    platform: "Swiggy",
    amount: "28.00",
    category: "Food",
    status: "posted",
  });
  expect(saved?.description).toContain(seller);
  if (!saved)
    throw new Error("Synthetic seller/platform receipt was not saved.");
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill(saved.description);
  await page
    .getByRole("button", { name: `Edit ${saved.description}`, exact: true })
    .click();
  const edit = page.locator(".transaction-modal");
  await expect(
    edit.getByRole("combobox", { name: "Platform / Source", exact: true }),
  ).toHaveValue("Swiggy");
  await expect(
    edit.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue(saved.description);
  await edit.getByLabel("Amount · ₹", { exact: true }).fill("29.00");
  await edit
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(edit).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved.id),
  ).toMatchObject({
    merchant: seller,
    platform: "Swiggy",
    description: saved.description,
    amount: "29.00",
  });
});

test("a receipt seller alone never infers a delivery platform", async ({
  page,
}) => {
  const seller = "Bikkgane Biryani";
  await mockSettings(page);
  await mockScan(
    page,
    scanResult({
      merchant: seller,
      platform: null,
      description: "Lunch",
      category: "Food",
    }),
  );
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  const platform = dialog.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(platform).toHaveValue("");
  await expect(
    platform.getByRole("option", { name: seller, exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue(/Bikkgane Biryani/);
  await closeEditor(dialog);
  expect(await transactions(page)).toEqual(before);
});

test("receipt autofill preserves the chosen expense type when AI suggests income", async ({
  page,
}) => {
  const description =
    "Synthetic mismatched receipt type at Synthetic Shopping Corner";
  await mockSettings(page);
  await mockScan(
    page,
    scanResult({
      kind: "income",
      description,
      amount: "42.17",
      externalReference: "SYNTHETIC-MISMATCHED-TYPE-1",
    }),
  );
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Add New Expense", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/receipt suggests.*income/i)).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "To account", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after).toHaveLength(before.length + 1);
  expect(after.find((row) => row.description === description)).toMatchObject({
    kind: "expense",
    amount: "42.17",
    status: "pending_review",
    sourceSystem: "receipt_ai",
    toAccountId: null,
  });
});

test("failed payment remains Needs review without an expense status control", async ({
  page,
}) => {
  const description = "Synthetic failed payment at Synthetic Shopping Corner";
  await mockSettings(page);
  await mockScan(
    page,
    scanResult({
      description,
      paymentStatus: "failed",
      externalReference: "SYNTHETIC-FAILED-1",
    }),
  );
  const dialog = await openEditor(page);
  await scan(dialog);
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "failed",
  );
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (await transactions(page)).find(
    (row) => row.description === description,
  );
  expect(saved?.status).toBe("pending_review");
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill(description);
  await page
    .getByRole("button", { name: `Edit ${description}`, exact: true })
    .click();
  const editDialog = page.locator(".transaction-modal");
  await expect(
    editDialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await editDialog.getByLabel("Amount · ₹", { exact: true }).fill("126.25");
  await editDialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(editDialog).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved?.id),
  ).toMatchObject({ amount: "126.25", status: "pending_review" });
});

test("unknown date stays empty instead of becoming today and saves to Needs review", async ({
  page,
}) => {
  const description = "Synthetic undated shopping at Synthetic Shopping Corner";
  await mockSettings(page);
  await mockScan(
    page,
    scanResult({
      description,
      occurredOn: null,
      externalReference: null,
      documentType: "receipt",
      paymentStatus: "unknown",
    }),
  );
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue("");
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (await transactions(page)).find(
    (row) => row.description === description,
  );
  expect(saved?.occurredOn).toBeNull();
  expect(saved?.status).toBe("pending_review");
});

test("removing the image or cancelling ignores a late AI result and preserves manual fields", async ({
  page,
}) => {
  await mockSettings(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic untouched draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("42.81");

  for (const buttonName of ["Remove image", "Cancel scan"]) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let handled = false;
    await page.route("**/api/ai/receipt", async (route) => {
      await gate;
      // The browser abort is expected. Either fulfillment or an aborted-request
      // error finishes this mock without retrying or invoking a real provider.
      await route.fulfill({ status: 200, json: scanResult() }).catch(() => {});
      handled = true;
    });
    await upload(dialog);
    const requestStarted = page.waitForRequest("**/api/ai/receipt");
    await receipt(dialog)
      .getByRole("button", { name: "Scan with AI", exact: true })
      .click();
    await requestStarted;
    await expect(
      receipt(dialog).getByRole("button", { name: "Cancel scan", exact: true }),
    ).toBeVisible();
    await receipt(dialog)
      .getByRole("button", { name: buttonName, exact: true })
      .click();
    release();
    await expect.poll(() => handled).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
      "Synthetic untouched draft",
    );
    await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
      "42.81",
    );
    await page.unroute("**/api/ai/receipt");
  }
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("provider failure can be retried without overwriting a manual draft", async ({
  page,
}) => {
  await mockSettings(page);
  const failures = [
    {
      status: 422,
      code: "unreadable_receipt",
      error:
        "The receipt could not be interpreted. Try a clearer image or enter the transaction manually.",
    },
    {
      status: 503,
      code: "scan_unavailable",
      error: "Receipt scanning is temporarily unavailable.",
    },
  ];
  let failureIndex = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    const failure = failures[Math.min(failureIndex++, failures.length - 1)];
    await route.fulfill({
      status: failure.status,
      json: { error: failure.error, code: failure.code },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic draft before outage");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("33.21");
  await upload(dialog);
  for (const failure of failures) {
    await receipt(dialog)
      .getByRole("button", { name: "Scan with AI", exact: true })
      .click();
    await expect(
      receipt(dialog).getByText(failure.error, { exact: true }),
    ).toBeVisible();
    await expect(
      receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
    ).toHaveCount(0);
    await expect(
      receipt(dialog).getByText(failure.code, { exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
      "Synthetic draft before outage",
    );
    await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
      "33.21",
    );
    expect((await transactions(page)).length).toBe(before.length);
  }
  await page.unroute("**/api/ai/receipt");
  await mockScan(page);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic draft before outage",
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("receipt review fits a 360px screen and editing resets confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSettings(page);
  await mockScan(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await assertNoOverflow(page);
  await receipt(dialog)
    .getByLabel("AI receipt review")
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.resolve("artifacts/receipt-review-mobile.png"),
  });
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeEnabled();
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("128.49");
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Stationery");
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("combobox", { name: "Platform / Source", exact: true })
    .selectOption("Amazon");
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await assertNoOverflow(page);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("uploaded receipt preview zooms locally and returns focus without changing the scan draft", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  await mockScan(
    page,
    scanResult({ accountHint: null, externalReference: null }, "Google Gemini"),
  );
  let scanRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/receipt") scanRequests++;
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic preview draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("42.81");
  const filename = "synthetic-preview-receipt.png";
  await upload(dialog, filename);
  const sheet = receipt(dialog);
  const image = sheet.locator(".receipt-preview");
  const originalURL = await image.getAttribute("src");
  expect(originalURL).toMatch(/^blob:/);
  const thumbnail = sheet.getByRole("button", {
    name: `Preview uploaded photo 1: ${filename}`,
    exact: true,
  });
  await expect(thumbnail).toHaveAttribute("type", "button");
  await thumbnail.click();
  const viewer = page.locator(".uploaded-image-modal");
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute("role", "dialog");
  await expect(viewer.getByText("Photo 1 of 1", { exact: true })).toBeVisible();
  await expect(
    viewer.getByRole("heading", { name: `Preview: ${filename}`, exact: true }),
  ).toBeVisible();
  await expect(viewer.locator(".uploaded-image-full")).toHaveAttribute(
    "src",
    originalURL!,
  );
  await expect
    .poll(() =>
      viewer
        .locator(".uploaded-image-full")
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(640);
  const originalWidth = await viewer
    .locator(".uploaded-image-full")
    .evaluate((node) => node.getBoundingClientRect().width);
  await expect(viewer.getByText("100%", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(viewer.getByText("200%", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      viewer
        .locator(".uploaded-image-full")
        .evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBeGreaterThan(originalWidth * 1.9);
  await viewer.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(viewer.getByText("150%", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect(viewer.getByText("100%", { exact: true })).toBeVisible();
  expect(scanRequests).toBe(0);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-preview-desktop.png"),
  });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(thumbnail).toBeFocused();
  await expect(image).toHaveAttribute("src", originalURL!);
  expect(
    await page.evaluate(async (url) => (await fetch(url!)).ok, originalURL),
  ).toBe(true);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic preview draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "42.81",
  );
  await sheet
    .getByRole("checkbox", { name: redactionLabel, exact: true })
    .check();
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  const useDetails = sheet.getByRole("button", {
    name: "Use details",
    exact: true,
  });
  await expect(useDetails).toBeVisible();
  expect(scanRequests).toBe(1);
  const textOpener = sheet.getByRole("button", {
    name: "Preview image 1",
    exact: true,
  });
  await textOpener.click();
  await expect(viewer).toBeVisible();
  await viewer
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(viewer).toHaveCount(0);
  await expect(textOpener).toBeFocused();
  await expect(useDetails).toBeEnabled();
  await thumbnail.click();
  await expect(viewer).toBeVisible();
  await page
    .locator(".uploaded-image-overlay")
    .click({ position: { x: 5, y: 5 } });
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  await expect(useDetails).toBeEnabled();
  expect(scanRequests).toBe(1);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("uploaded receipt preview cycles three photos while retaining upload order and separate removal", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  const filenames = [
    "synthetic-preview-primary.png",
    "synthetic-preview-page-2.png",
    "synthetic-preview-page-3.png",
  ];
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": route.request().headers()["content-type"] },
      },
    ).formData();
    const images = form.getAll("image") as File[];
    expect(images.map((image) => image.name)).toEqual(filenames);
    for (const image of images)
      expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    expect(form.getAll("provider")).toEqual(["gemini"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Google Gemini")]);
    expect(form.getAll("redacted")).toEqual(["true"]);
    expect(form.getAll("consent")).toEqual(["true"]);
    await route.fulfill({
      status: 200,
      json: scanResult(
        { accountHint: null, externalReference: null },
        "Google Gemini",
      ),
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  const sheet = await openScanner(dialog);
  await sheet
    .getByRole("checkbox", {
      name: "This receipt spans multiple photos (long bill)",
      exact: true,
    })
    .check();
  await sheet
    .getByLabel("Payment screenshot or shopping receipt", { exact: true })
    .setInputFiles(
      filenames.map((name) => ({ name, mimeType: "image/png", buffer: png })),
    );
  const images = sheet.locator(".receipt-preview");
  const originalURLs = await images.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("src")),
  );
  expect(originalURLs).toHaveLength(3);
  expect(originalURLs.every((url) => url?.startsWith("blob:"))).toBe(true);
  const confirmation = sheet.getByRole("checkbox", {
    name: new RegExp(redactionLabel),
  });
  await confirmation.check();
  const opener = sheet.getByRole("button", {
    name: `Preview uploaded photo 2: ${filenames[1]}`,
    exact: true,
  });
  await opener.click();
  const viewer = page.locator(".uploaded-image-modal");
  await expect(viewer.getByText("Photo 2 of 3", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Next photo", exact: true }).click();
  await expect(
    viewer.getByRole("heading", {
      name: `Preview: ${filenames[2]}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("Photo 1 of 3", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByText("Photo 3 of 3", { exact: true })).toBeVisible();
  await viewer
    .getByRole("button", { name: "Previous photo", exact: true })
    .click();
  await expect(viewer.locator(".uploaded-image-full")).toHaveAttribute(
    "src",
    originalURLs[1]!,
  );
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(confirmation).toBeChecked();
  expect(
    await images.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("src")),
    ),
  ).toEqual(originalURLs);
  expect(scanRequests).toBe(0);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  expect(scanRequests).toBe(1);
  await opener.click();
  await expect(viewer).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toBeEnabled();
  await sheet
    .getByRole("button", { name: "Remove photo 2", exact: true })
    .click();
  expect(
    await images.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("src")),
    ),
  ).toEqual([originalURLs[0], originalURLs[2]]);
  await expect(sheet.getByText(filenames[1], { exact: true })).toHaveCount(0);
  await expect(confirmation).not.toBeChecked();
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(async (url) => {
      try {
        return (await fetch(url!)).ok;
      } catch {
        return false;
      }
    }, originalURLs[1]),
  ).toBe(false);
  const remainingOpener = sheet.getByRole("button", {
    name: `Preview uploaded photo 2: ${filenames[2]}`,
    exact: true,
  });
  await remainingOpener.click();
  await expect(viewer.getByText("Photo 2 of 2", { exact: true })).toBeVisible();
  await expect(viewer.locator(".uploaded-image-full")).toHaveAttribute(
    "src",
    originalURLs[2]!,
  );
  await page.keyboard.press("Escape");
  await expect(remainingOpener).toBeFocused();
  expect(scanRequests).toBe(1);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("uploaded receipt preview fits mobile and permits scrolling a portrait image at 300 percent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSettings(page, true, "Google Gemini");
  let scanRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/receipt") scanRequests++;
  });
  const before = await transactions(page);
  const portraitDataURL = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1800;
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("Synthetic portrait canvas unavailable.");
    drawing.fillStyle = "#ffffff";
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.fillStyle = "#176b42";
    drawing.font = "bold 40px sans-serif";
    drawing.fillText("SYNTHETIC LONG RECEIPT", 30, 80);
    drawing.font = "28px sans-serif";
    for (let index = 0; index < 22; index++) {
      drawing.fillText(
        `Fictional item ${index + 1} - INR 10.00`,
        30,
        160 + index * 64,
      );
    }
    drawing.fillText("Test only - no real payment", 30, 1700);
    return canvas.toDataURL("image/png");
  });
  const dialog = await openEditor(page);
  const sheet = await openScanner(dialog);
  const filename = "synthetic-long-preview.png";
  await sheet
    .getByLabel("Payment screenshot or shopping receipt", { exact: true })
    .setInputFiles({
      name: filename,
      mimeType: "image/png",
      buffer: Buffer.from(portraitDataURL.split(",")[1], "base64"),
    });
  const opener = sheet.getByRole("button", {
    name: `Preview uploaded photo 1: ${filename}`,
    exact: true,
  });
  await opener.click();
  const viewer = page.locator(".uploaded-image-modal");
  const viewport = viewer.locator(".uploaded-image-viewport");
  const fullImage = viewer.locator(".uploaded-image-full");
  await expect(viewer).toBeVisible();
  await expect(fullImage).toBeVisible();
  await expect
    .poll(() =>
      fullImage.evaluate((node) => (node as HTMLImageElement).naturalHeight),
    )
    .toBe(1800);
  const fit = await viewport.evaluate((node) => {
    const image = node.querySelector("img")!.getBoundingClientRect();
    return {
      width: node.clientWidth,
      height: node.clientHeight,
      imageWidth: image.width,
      imageHeight: image.height,
    };
  });
  expect(fit.imageWidth).toBeLessThanOrEqual(fit.width + 1);
  expect(fit.imageHeight).toBeLessThanOrEqual(fit.height + 1);
  await assertNoOverflow(page);
  for (let index = 0; index < 4; index++)
    await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(viewer.getByText("300%", { exact: true })).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      viewport.evaluate((node) => node.scrollHeight - node.clientHeight),
    )
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      viewport.evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBeGreaterThan(100);
  await viewport.evaluate((node) => node.scrollTo({ top: 100, left: 100 }));
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  for (const name of ["Zoom out", "Reset zoom", "Close dialog"]) {
    const bounds = await viewer
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(361);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(801);
  }
  await assertNoOverflow(page);
  await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect(viewer.getByText("100%", { exact: true })).toBeVisible();
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-preview-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(opener).toBeFocused();
  expect(scanRequests).toBe(0);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});
