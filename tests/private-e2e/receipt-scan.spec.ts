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
import { createDemoData } from "../../src/lib/seed";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../../src/lib/private-profile-store";
import type { WorkspaceData } from "../../src/lib/types";
import {
  DEFAULT_RECEIPT_AI_MODEL,
  RECEIPT_AI_MODELS,
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
const receiptDescription = "Synthetic receipt shopping";
const fingerprint = "1".repeat(64);
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
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Add from a receipt", exact: true })
    .click();
  return dialog;
}

async function upload(dialog: Locator, filename = "synthetic-payment.png") {
  await dialog
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

async function mockSettings(page: Page, configured = true) {
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
        provider: "Vercel AI Gateway",
        model: DEFAULT_RECEIPT_AI_MODEL,
        models: RECEIPT_AI_MODELS,
      },
    });
  });
}

function scanResult(
  overrides: Partial<ReceiptExtraction> = {},
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
    provider: "Vercel AI Gateway",
    model: DEFAULT_RECEIPT_AI_MODEL,
  };
}

async function mockScan(page: Page, response = scanResult()) {
  await page.route("**/api/ai/receipt", async (route) => {
    expect(route.request().method()).toBe("POST");
    const contentType = route.request().headers()["content-type"];
    expect(contentType).toContain("multipart/form-data");
    const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
    expect(body.includes('name="consent"')).toBe(true);
    expect(body.includes("true")).toBe(true);
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
  await dialog
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Use details", exact: true }),
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
  });
  const noKey = await page.request.post("/api/ai/receipt", {
    headers: { Origin: baseURL },
    multipart: {
      consent: "true",
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
    panel.getByText(/AI_GATEWAY_API_KEY|AI_GATEWAY_MODEL|\.env/),
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
  await expect(dialog.getByText(/app owner/).first()).toBeVisible();
  await expect(dialog.getByText("Connect AI", { exact: true })).toHaveCount(0);
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await upload(dialog);
  await expect(
    dialog.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Description", { exact: true })
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
    .getByLabel("Description", { exact: true })
    .fill("Manual draft stays intact");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("81.27");
  const fileInput = dialog.getByLabel(
    "Payment screenshot or shopping receipt",
    { exact: false },
  );
  await fileInput.setInputFiles({
    name: "synthetic-receipt.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await expect(
    dialog.getByText("Choose a PNG, JPG, or WebP image.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await fileInput.setInputFiles({
    name: "oversized-synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(6 * 1024 * 1024),
  });
  await expect(dialog.getByText(/5 MB/).last()).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "Manual draft stays intact",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "81.27",
  );
  expect(providerRequests).toBe(0);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
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
  await expect(dialog.getByLabel("AI receipt review")).toContainText(
    "INR 125.50",
  );
  await expect(dialog.getByLabel("AI receipt review")).toContainText(merchant);
  await expect(dialog.getByLabel("AI receipt review")).toContainText(reference);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-review-desktop.png"),
  });
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "",
  );
  expect((await transactions(page)).length).toBe(before.length);

  await dialog
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    receiptDescription,
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "125.50",
  );
  await expect(
    dialog.getByLabel("Purchase / movement date", { exact: true }),
  ).toHaveValue("2026-10-09");
  await expect(
    dialog.getByLabel("Merchant (optional)", { exact: true }),
  ).toHaveValue(merchant);
  await expect(
    dialog.getByLabel("Bank reference", { exact: true }),
  ).toHaveValue(reference);
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
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("posted");
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
  const editDialog = page.getByRole("dialog");
  await expect(
    editDialog.getByRole("button", { name: "Add from a receipt", exact: true }),
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
    (await transactions(page)).find((row) => row.id === saved?.id)?.amount,
  ).toBe("126.75");
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
    dialog.getByText("Possible duplicate transactions", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("AI receipt review")).toContainText(
    receiptDescription,
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  expect((await transactions(page)).length).toBe(before.length);
});

test("foreign currency stays in review and cannot populate the INR form", async ({
  page,
}) => {
  await mockSettings(page);
  await mockScan(page, scanResult({ currency: "USD", amount: "9.95" }));
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Manual INR draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("77.89");
  await upload(dialog);
  await dialog
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(dialog.getByLabel("AI receipt review")).toContainText(
    "USD 9.95",
  );
  await expect(
    dialog.getByRole("button", { name: "Use details", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(/these details cannot be applied/),
  ).toBeVisible();
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "Manual INR draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "77.89",
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  expect((await transactions(page)).length).toBe(before.length);
});

test("failed payment remains Needs review even when Posted is selected", async ({
  page,
}) => {
  const description = "Synthetic failed payment";
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
  await expect(dialog.getByLabel("AI receipt review")).toContainText("failed");
  await dialog
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("pending_review");
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("posted");
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.description === description)
      ?.status,
  ).toBe("pending_review");
});

test("unknown date stays empty instead of becoming today and saves to Needs review", async ({
  page,
}) => {
  const description = "Synthetic undated shopping";
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
  await dialog
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Purchase / movement date", { exact: true }),
  ).toHaveValue("");
  await dialog
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption({ label: bankName });
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("posted");
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
    .getByLabel("Description", { exact: true })
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
    await dialog
      .getByRole("button", { name: "Scan with AI", exact: true })
      .click();
    await requestStarted;
    await expect(
      dialog.getByRole("button", { name: "Cancel scan", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: buttonName, exact: true }).click();
    release();
    await expect.poll(() => handled).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      dialog.getByRole("button", { name: "Use details", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
      "Synthetic untouched draft",
    );
    await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
      "42.81",
    );
    await page.unroute("**/api/ai/receipt");
  }
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  expect((await transactions(page)).length).toBe(before.length);
});

test("provider failure can be retried without overwriting a manual draft", async ({
  page,
}) => {
  await mockSettings(page);
  await page.route("**/api/ai/receipt", async (route) => {
    await route.fulfill({
      status: 503,
      json: { error: "Receipt scanning is temporarily unavailable." },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Synthetic draft before outage");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("33.21");
  await upload(dialog);
  await dialog
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    dialog.getByText("Receipt scanning is temporarily unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Use details", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "Synthetic draft before outage",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "33.21",
  );
  await page.unroute("**/api/ai/receipt");
  await mockScan(page);
  await dialog
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
    "Synthetic draft before outage",
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
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
  await dialog.getByLabel("AI receipt review").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.resolve("artifacts/receipt-review-mobile.png"),
  });
  await dialog
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
  await assertNoOverflow(page);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  expect((await transactions(page)).length).toBe(before.length);
});
