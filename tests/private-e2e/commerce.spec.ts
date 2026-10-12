import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDemoData } from "../../src/lib/seed";
import {
  ledgerBalance,
  monthlySummary,
  subtractMoney,
} from "../../src/lib/finance";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../../src/lib/private-profile-store";
import type { Transaction, WorkspaceData } from "../../src/lib/types";
import type {
  CommerceCommand,
  CommerceData,
  ReviewedOrderDraft,
  RefundDraft,
  ScannedOrderDraft,
} from "../../src/lib/commerce";
import type { OrderScanResult } from "../../src/lib/scan-orders";

const baseURL = "http://127.0.0.1:3004";
const owner = randomUUID();
const bankId = randomUUID();
const otherBankId = randomUUID();
const inactiveBankId = randomUUID();
const bankName = "Synthetic commerce bank";
const profileName = `Synthetic commerce tester ${randomBytes(4).toString("hex")}`;
const email = `commerce.${randomBytes(5).toString("hex")}@example.test`;
const password = randomBytes(18).toString("base64url");
const linkPurchaseId = randomUUID();
const refundPurchaseId = randomUUID();
const matchedCreditPurchaseId = randomUUID();
const manualPurchaseId = randomUUID();
const otherPurchaseId = randomUUID();
const existingCreditId = randomUUID();
const reviewLabel =
  "I reviewed these orders, payment accounts and possible duplicates.";
const model = "synthetic-commerce-model";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
let testDirectory = "";
let png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9sAAAAASUVORK5CYII=",
  "base64",
);

function guardedDirectory() {
  const directory = path.resolve(process.env.FINANCE_PRIVATE_DIR ?? "");
  const relative = path.relative(path.resolve(tmpdir()), directory);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(directory).startsWith("finance-os-private-e2e-")
  ) {
    throw new Error("Commerce tests require an isolated temporary profile.");
  }
  return directory;
}

function original(
  id: string,
  description: string,
  amount: string,
): Transaction {
  return {
    id,
    userId: owner,
    amount,
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-10-02",
    description,
    merchant: description,
    fromAccountId: bankId,
    toAccountId: null,
    category: "Shopping",
  };
}

function workspaceFixture(): WorkspaceData {
  const data = createDemoData();
  for (const rows of Object.values(data)) rows.length = 0;
  for (const [id, name, active] of [
    [bankId, bankName, true],
    [otherBankId, "Synthetic commerce second bank", true],
    [inactiveBankId, "Synthetic inactive commerce bank", false],
  ] as const)
    data.accounts.push({
      id,
      userId: owner,
      name,
      institution: "Fictional bank",
      kind: "bank",
      maskedSuffix: "1234",
      openingBalance: "10000.00",
      openingBalanceDate: "2026-10-01",
      active,
    });
  data.transactions.push(
    original(linkPurchaseId, "Synthetic already paid purchase", "137.25"),
    original(refundPurchaseId, "Synthetic matched refund purchase", "250.00"),
    original(
      matchedCreditPurchaseId,
      "Synthetic credited refund purchase",
      "250.00",
    ),
    original(manualPurchaseId, "Synthetic partial refund purchase", "300.00"),
    original(otherPurchaseId, "Synthetic other refund purchase", "200.00"),
    {
      id: existingCreditId,
      userId: owner,
      amount: "120.00",
      currency: "INR",
      kind: "adjustment",
      status: "posted",
      occurredOn: "2026-10-08",
      description: "Synthetic bank credit awaiting classification",
      fromAccountId: null,
      toAccountId: bankId,
      category: "Other",
    },
  );
  return data;
}

function scanned(
  candidateId: string,
  overrides: Partial<ScannedOrderDraft> = {},
): ScannedOrderDraft {
  return {
    candidateId,
    sourceType: "order_history_multipage",
    platform: "Synthetic Shopping",
    merchant: `Synthetic ${candidateId}`,
    description: `Synthetic ${candidateId}`,
    orderReferenceHash: hash(candidateId),
    orderReferenceMasked: "••TEST",
    occurredOn: "2026-10-04",
    status: "completed",
    amount: "101.23",
    amountRole: "amount_paid",
    currency: "INR",
    paymentStatus: "successful",
    financialEvent: "purchase",
    category: "Shopping",
    items: [],
    sourceImageIndices: [0],
    confidence: "high",
    warnings: [],
    expectedRefundAmount: null,
    expectedRefundBy: null,
    ...overrides,
  };
}

function reviewed(
  candidateId: string,
  overrides: Partial<ReviewedOrderDraft> = {},
): ReviewedOrderDraft {
  return {
    ...scanned(candidateId),
    action: "create",
    confirmed: true,
    fromAccountId: bankId,
    externalPayer: null,
    matchedTransactionId: null,
    confirmedDistinct: false,
    sourceFingerprint: hash(`source:${candidateId}`),
    ...overrides,
  };
}

function refund(
  description: string,
  overrides: Partial<RefundDraft> = {},
): RefundDraft {
  return {
    description,
    orderId: null,
    originalTransactionId: refundPurchaseId,
    expectedAmount: "120.00",
    expectedBy: "2026-10-10",
    cancelledOn: "2026-10-06",
    destinationAccountId: bankId,
    route: "bank",
    itemTitle: null,
    notes: "Synthetic request only",
    status: "expected",
    ...overrides,
  };
}

async function post(request: APIRequestContext, command: CommerceCommand) {
  return request.post("/api/orders", {
    headers: { Origin: baseURL },
    data: command,
  });
}

async function state(page: Page) {
  const [ordersResponse, workspaceResponse] = await Promise.all([
    page.request.get("/api/orders"),
    page.request.get("/api/workspace"),
  ]);
  expect(ordersResponse.status()).toBe(200);
  expect(workspaceResponse.status()).toBe(200);
  const commerce = (await ordersResponse.json()).commerce as CommerceData;
  const workspace = (await workspaceResponse.json()).workspace as WorkspaceData;
  return {
    commerce,
    workspace,
    cash: ledgerBalance(workspace, bankId, "2026-10-31"),
    spending: monthlySummary(workspace, "2026-10"),
  };
}

async function commit(page: Page, name: string, orders: ReviewedOrderDraft[]) {
  const response = await post(page.request, {
    action: "commit_orders",
    idempotencyKey: hash(name),
    orders,
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function mockSettings(page: Page) {
  await page.route("**/api/ai/settings", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      status: 200,
      json: {
        available: true,
        configured: true,
        ownerManaged: true,
        provider: "Google Gemini",
        model,
        requiresRedaction: true,
      },
    });
  });
}

function scanResult(
  name: string,
  orders: ScannedOrderDraft[],
  sourceType: OrderScanResult["extraction"]["sourceType"] = "order_history_multipage",
): OrderScanResult {
  return {
    extraction: { sourceType, orders, warnings: [] },
    fingerprint: hash(name),
    provider: "Google Gemini",
    model,
  };
}

async function mockScan(page: Page, result: OrderScanResult) {
  await page.route("**/api/ai/orders", async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    const form = await new Response(new Uint8Array(body), {
      headers: { "Content-Type": route.request().headers()["content-type"] },
    }).formData();
    expect(form.getAll("provider")).toEqual(["gemini"]);
    expect(form.getAll("model")).toEqual([model]);
    expect(form.getAll("consent")).toEqual(["true"]);
    expect(form.getAll("redacted")).toEqual(["true"]);
    expect(form.getAll("image").length).toBeGreaterThan(0);
    expect(body.includes(Buffer.from(email))).toBe(false);
    expect(body.includes(Buffer.from(owner))).toBe(false);
    await route.fulfill({ status: 200, json: result });
  });
}

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function scanOrders(page: Page, photoCount = 1) {
  await page
    .getByRole("button", { name: "Scan order history", exact: true })
    .click();
  const scanner = page.locator(".order-scan-modal");
  await expect(scanner).toBeVisible();
  await scanner
    .getByLabel("Order history screenshots", { exact: true })
    .setInputFiles(
      Array.from({ length: photoCount }, (_, index) => ({
        name: `synthetic-history-${index + 1}.png`,
        mimeType: "image/png",
        buffer: png,
      })),
    );
  await scanner
    .getByRole("checkbox", {
      name: /I removed personal, banking and other sensitive information from every selected screenshot/,
    })
    .check();
  await scanner
    .getByRole("button", { name: "Scan orders with AI", exact: true })
    .click();
  await expect(
    scanner.getByRole("button", { name: "Review orders", exact: true }),
  ).toBeVisible();
  await scanner
    .getByRole("button", { name: "Review orders", exact: true })
    .click();
  await expect(scanner).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  testDirectory = guardedDirectory();
  expect(privateProfileDirectory()).toBe(testDirectory);
  const { setupToken } = await provisionPrivateProfile(
    workspaceFixture(),
    profileName,
  );
  const context = await browser.newContext({ baseURL });
  try {
    const fixturePage = await context.newPage();
    const dataURL = await fixturePage.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 1000;
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new Error("Synthetic commerce canvas unavailable.");
      drawing.fillStyle = "#fff";
      drawing.fillRect(0, 0, 720, 1000);
      drawing.fillStyle = "#176b42";
      drawing.font = "bold 34px sans-serif";
      drawing.fillText("SYNTHETIC ORDER HISTORY", 30, 70);
      drawing.font = "26px sans-serif";
      [
        "Order one - Completed - INR 101.23",
        "Order two - Completed - INR 44.50",
        "Order three - Cancelled - INR 88.00",
      ].forEach((line, index) => drawing.fillText(line, 30, 160 + index * 160));
      drawing.font = "20px sans-serif";
      drawing.fillText("Test only - no real account or payment", 30, 920);
      return canvas.toDataURL("image/png");
    });
    png = Buffer.from(dataURL.split(",")[1], "base64");
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
    expect(response.status()).toBe(200);
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
  const safeDirectory = guardedDirectory();
  if (testDirectory && safeDirectory === testDirectory)
    await rm(safeDirectory, { recursive: true, force: true });
  cookies = [];
});

test("commerce APIs require session and origin and reject a foreign or inactive account atomically", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/orders")).status()).toBe(401);
  expect(
    (
      await request.post("/api/orders", {
        headers: { Origin: baseURL },
        data: {},
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/ai/orders", { headers: { Origin: baseURL } })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/orders", {
        headers: { Origin: "https://example.invalid" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get("/api/orders", {
        headers: { Host: "example.invalid" },
      })
    ).status(),
  ).toBe(403);
  const response = await page.request.get("/api/orders");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const before = await state(page);
  for (const wrongAccount of [randomUUID(), inactiveBankId]) {
    const failed = await post(page.request, {
      action: "commit_orders",
      idempotencyKey: hash(`bad-account:${wrongAccount}`),
      orders: [
        reviewed(`valid-${wrongAccount}`),
        reviewed(`invalid-${wrongAccount}`, { fromAccountId: wrongAccount }),
      ],
    });
    expect(failed.status()).toBe(400);
    expect((await failed.json()).error).toMatch(/account|profile/i);
  }
  const after = await state(page);
  expect(after.workspace.transactions).toEqual(before.workspace.transactions);
  expect(after.commerce).toEqual(before.commerce);
  expect(after.cash).toBe(before.cash);
});

test("unknown money and dates remain pending while nonpurchase documents never post an expense", async ({
  page,
}) => {
  const before = await state(page);
  await commit(page, "pending-and-nonpurchase", [
    reviewed("unknown-everything", {
      action: "pending",
      amount: null,
      occurredOn: null,
      fromAccountId: null,
      paymentStatus: "unknown",
      amountRole: "unknown",
    }),
    reviewed("known-amount-unknown-date", {
      action: "pending",
      amount: "19.75",
      occurredOn: null,
      fromAccountId: null,
      paymentStatus: "unknown",
    }),
    reviewed("statement-only", {
      sourceType: "bank_statement",
      financialEvent: "account_snapshot",
      action: "history",
      fromAccountId: null,
    }),
    reviewed("reference-only", {
      sourceType: "design_reference_only",
      financialEvent: "reference_only",
      action: "history",
      fromAccountId: null,
    }),
  ]);
  const after = await state(page);
  expect(after.cash).toBe(before.cash);
  expect(after.spending).toEqual(before.spending);
  expect(after.workspace.transactions.length).toBe(
    before.workspace.transactions.length + 1,
  );
  const pending = after.workspace.transactions.find(
    (row) => row.description === "Synthetic known-amount-unknown-date",
  );
  expect(pending).toMatchObject({
    amount: "19.75",
    occurredOn: null,
    fromAccountId: null,
    status: "pending_review",
  });
  expect(
    after.commerce.orders.find(
      (row) => row.candidateId === "unknown-everything",
    ),
  ).toMatchObject({
    amount: null,
    occurredOn: null,
    payments: [],
    reviewStatus: "pending",
  });
  const rejected = await post(page.request, {
    action: "commit_orders",
    idempotencyKey: hash("forbidden-statement-expense"),
    orders: [
      reviewed("forbidden-statement-expense", {
        sourceType: "bank_statement",
        financialEvent: "account_snapshot",
      }),
    ],
  });
  expect(rejected.status()).toBe(400);
  expect((await state(page)).workspace.transactions).toEqual(
    after.workspace.transactions,
  );
});

test("pending item refund and a repeated request retain one expectation and leave cash unchanged", async ({
  page,
}) => {
  const draft = reviewed("item-cancellation", {
    amount: "250.00",
    occurredOn: "2026-10-02",
    merchant: "Synthetic matched refund purchase",
    description: "Synthetic matched refund purchase",
    action: "link",
    matchedTransactionId: refundPurchaseId,
    items: [
      {
        title: "Synthetic cancelled item",
        quantity: "1",
        amount: "120.00",
        status: "cancelled",
      },
      {
        title: "Synthetic retained item",
        quantity: "1",
        amount: "130.00",
        status: "delivered",
      },
    ],
    status: "partial_cancelled",
  });
  await commit(page, "item-cancellation", [draft]);
  const before = await state(page);
  const order = before.commerce.orders.find(
    (row) => row.candidateId === draft.candidateId,
  )!;
  const request = refund("Synthetic cancelled item refund", {
    orderId: order.id,
    itemTitle: "Synthetic cancelled item",
  });
  const first = await post(page.request, {
    action: "save_refund",
    refund: request,
  });
  expect(first.status()).toBe(200);
  const repeated = await post(page.request, {
    action: "save_refund",
    refund: request,
  });
  expect(repeated.status()).toBe(200);
  expect((await repeated.json()).result.duplicate).toBe(true);
  const after = await state(page);
  expect(
    after.commerce.refunds.filter(
      (row) => row.description === request.description,
    ),
  ).toHaveLength(1);
  const saved = after.commerce.refunds.find(
    (row) => row.description === request.description,
  )!;
  expect(saved).toMatchObject({
    itemTitle: "Synthetic cancelled item",
    expectedAmount: "120.00",
    status: "expected",
    creditMatches: [],
  });
  expect(after.cash).toBe(before.cash);
  expect(after.spending).toEqual(before.spending);
  expect(after.workspace.transactions).toEqual(before.workspace.transactions);
  expect(
    after.commerce.orders
      .find((row) => row.id === order.id)
      ?.items.map((item) => item.status),
  ).toEqual(["cancelled", "delivered"]);
});

test("matching an existing bank credit reduces net spending once and rejects credit reuse", async ({
  page,
}) => {
  const request = refund("Synthetic existing credit refund", {
    originalTransactionId: matchedCreditPurchaseId,
  });
  expect(
    (
      await post(page.request, { action: "save_refund", refund: request })
    ).status(),
  ).toBe(200);
  const before = await state(page);
  const tracked = before.commerce.refunds.find(
    (row) => row.description === request.description,
  )!;
  const command: CommerceCommand = {
    action: "verify_refund",
    refundId: tracked.id,
    transactionId: existingCreditId,
    amount: "120.00",
  };
  const first = await post(page.request, command);
  expect(first.status()).toBe(200);
  const after = await state(page);
  expect(after.workspace.transactions.length).toBe(
    before.workspace.transactions.length,
  );
  expect(after.cash).toBe(before.cash);
  expect(subtractMoney(before.spending.net, after.spending.net)).toBe("120.00");
  expect(
    after.workspace.transactions.find((row) => row.id === existingCreditId),
  ).toMatchObject({
    kind: "refund",
    refundOfTransactionId: matchedCreditPurchaseId,
  });
  expect(
    after.commerce.refunds.find((row) => row.id === tracked.id),
  ).toMatchObject({
    status: "confirmed",
    creditMatches: [
      {
        transactionId: existingCreditId,
        amount: "120.00",
        verification: "matched_credit",
      },
    ],
  });
  const repeated = await post(page.request, command);
  expect(repeated.status()).toBe(200);
  expect((await repeated.json()).result.duplicate).toBe(true);
  const other = refund("Synthetic attempted credit reuse", {
    originalTransactionId: otherPurchaseId,
    expectedAmount: "120.00",
  });
  expect(
    (
      await post(page.request, { action: "save_refund", refund: other })
    ).status(),
  ).toBe(200);
  const otherId = (await state(page)).commerce.refunds.find(
    (row) => row.description === other.description,
  )!.id;
  const reused = await post(page.request, { ...command, refundId: otherId });
  expect(reused.status()).toBe(400);
  expect((await reused.json()).error).toMatch(/linked|used|another/i);
  const changed = await page.request.post("/api/workspace", {
    headers: { Origin: baseURL },
    data: {
      collection: "transactions",
      record: {
        ...after.workspace.transactions.find(
          (row) => row.id === existingCreditId,
        ),
        amount: "121.00",
      },
    },
  });
  expect(changed.status()).toBe(400);
  expect((await state(page)).workspace.transactions).toEqual(
    after.workspace.transactions,
  );
});

test("manual partial credits require bank verification and cannot exceed the expected or original purchase", async ({
  page,
}) => {
  const request = refund("Synthetic manual partial refund", {
    originalTransactionId: manualPurchaseId,
    expectedAmount: "100.00",
    itemTitle: "Synthetic item A",
  });
  expect(
    (
      await post(page.request, { action: "save_refund", refund: request })
    ).status(),
  ).toBe(200);
  const before = await state(page);
  const tracked = before.commerce.refunds.find(
    (row) => row.description === request.description,
  )!;
  const command = {
    action: "verify_refund",
    refundId: tracked.id,
    amount: "40.00",
    receivedOn: "2026-10-07",
    destinationAccountId: bankId,
    bankHistoryConfirmed: true,
  } as const;
  const unverified = await page.request.post("/api/orders", {
    headers: { Origin: baseURL },
    data: { ...command, bankHistoryConfirmed: false },
  });
  expect(unverified.status()).toBe(400);
  expect((await state(page)).workspace.transactions).toEqual(
    before.workspace.transactions,
  );
  expect((await post(page.request, command)).status()).toBe(200);
  const partial = await state(page);
  expect(
    partial.commerce.refunds.find((row) => row.id === tracked.id)?.status,
  ).toBe("partial");
  expect(subtractMoney(partial.cash!, before.cash!)).toBe("40.00");
  expect(subtractMoney(before.spending.net, partial.spending.net)).toBe(
    "40.00",
  );
  const excessive = await post(page.request, {
    ...command,
    amount: "61.00",
    receivedOn: "2026-10-09",
  });
  expect(excessive.status()).toBe(400);
  expect((await state(page)).workspace.transactions).toEqual(
    partial.workspace.transactions,
  );
  const duplicatePartial = await post(page.request, command);
  expect([200, 400]).toContain(duplicatePartial.status());
  expect((await state(page)).workspace.transactions).toEqual(
    partial.workspace.transactions,
  );
  expect(
    (
      await post(page.request, {
        ...command,
        amount: "60.00",
        receivedOn: "2026-10-09",
      })
    ).status(),
  ).toBe(200);
  const confirmed = await state(page);
  expect(
    confirmed.commerce.refunds.find((row) => row.id === tracked.id)?.status,
  ).toBe("confirmed");
  expect(confirmed.workspace.transactions.length).toBe(
    before.workspace.transactions.length + 2,
  );
  expect(subtractMoney(confirmed.cash!, before.cash!)).toBe("100.00");
  expect(subtractMoney(before.spending.net, confirmed.spending.net)).toBe(
    "100.00",
  );
  const tooManyExpected = await post(page.request, {
    action: "save_refund",
    refund: refund("Synthetic excessive second request", {
      originalTransactionId: manualPurchaseId,
      expectedAmount: "250.00",
      itemTitle: "Synthetic item B",
    }),
  });
  expect(tooManyExpected.status()).toBe(400);
  expect((await state(page)).workspace.transactions).toEqual(
    confirmed.workspace.transactions,
  );
});

test("store credit stays separate from bank cash and confirmed refund spending", async ({
  page,
}) => {
  const before = await state(page);
  const request = refund("Synthetic store credit", {
    originalTransactionId: otherPurchaseId,
    expectedAmount: "20.00",
    route: "store_credit",
    destinationAccountId: null,
    status: "store_credit",
  });
  expect(
    (
      await post(page.request, { action: "save_refund", refund: request })
    ).status(),
  ).toBe(200);
  const after = await state(page);
  const tracked = after.commerce.refunds.find(
    (row) => row.description === request.description,
  )!;
  expect(tracked.status).toBe("store_credit");
  expect(after.workspace.transactions).toEqual(before.workspace.transactions);
  expect(after.cash).toBe(before.cash);
  expect(after.spending).toEqual(before.spending);
  const rejected = await post(page.request, {
    action: "verify_refund",
    refundId: tracked.id,
    amount: "20.00",
    receivedOn: "2026-10-09",
    destinationAccountId: bankId,
    bankHistoryConfirmed: true,
  });
  expect(rejected.status()).toBe(400);
  expect((await state(page)).workspace.transactions).toEqual(
    before.workspace.transactions,
  );
});

test("order history scan reviews overlapping screenshots and retries a lost save response without duplicate expenses", async ({
  page,
}) => {
  await mockSettings(page);
  const result = scanResult("synthetic-overlapping-history", [
    scanned("overlap-completed-one", { sourceImageIndices: [0, 1] }),
    scanned("overlap-completed-two", {
      amount: "44.50",
      occurredOn: "2026-10-05",
      sourceImageIndices: [1],
    }),
    scanned("overlap-cancelled", {
      amount: "88.00",
      status: "cancelled",
      paymentStatus: "unknown",
      sourceImageIndices: [0, 1],
    }),
  ]);
  await mockScan(page, result);
  const before = await state(page);
  await page.goto("/orders");
  await scanOrders(page, 2);
  const drafts = page.locator(".commerce-draft");
  await expect(drafts).toHaveCount(3);
  for (const index of [0, 1]) {
    await drafts
      .nth(index)
      .getByLabel("Save as", { exact: true })
      .selectOption("create");
    await drafts
      .nth(index)
      .getByLabel("Paid from", { exact: true })
      .selectOption(bankId);
    await expect(
      drafts
        .nth(index)
        .getByLabel("Paid from", { exact: true })
        .locator(`option[value="${inactiveBankId}"]`),
    ).toHaveCount(0);
  }
  await expect(
    drafts.nth(2).getByLabel("Save as", { exact: true }),
  ).toHaveValue("history");
  await expect(
    drafts
      .nth(2)
      .getByLabel("Save as", { exact: true })
      .locator('option[value="create"]'),
  ).toHaveCount(0);
  const keys: string[] = [];
  let firstCommit: CommerceCommand | undefined;
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const command = route.request().postDataJSON() as CommerceCommand;
    expect(command.action).toBe("commit_orders");
    if (command.action !== "commit_orders")
      throw new Error("Unexpected synthetic command.");
    keys.push(command.idempotencyKey);
    firstCommit ??= command;
    if (keys.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      // The real server committed atomically; simulate a connection failure before the client receives its response.
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await page
    .getByRole("button", { name: "Save reviewed orders", exact: true })
    .click();
  await expect(page.locator(".commerce-page > .error")).toBeVisible();
  await expect(drafts).toHaveCount(3);
  const savedAfterLoss = await state(page);
  expect(savedAfterLoss.workspace.transactions.length).toBe(
    before.workspace.transactions.length + 2,
  );
  expect(subtractMoney(before.cash!, savedAfterLoss.cash!)).toBe("145.73");
  expect(
    subtractMoney(savedAfterLoss.spending.gross, before.spending.gross),
  ).toBe("145.73");
  await page
    .getByRole("button", { name: "Save reviewed orders", exact: true })
    .click();
  await expect(drafts).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const afterRetry = await state(page);
  expect(afterRetry.workspace.transactions).toEqual(
    savedAfterLoss.workspace.transactions,
  );
  expect(
    afterRetry.commerce.orders.filter(
      (row) => row.sourceFingerprint === result.fingerprint,
    ),
  ).toHaveLength(3);
  expect(
    afterRetry.commerce.orders.find(
      (row) => row.candidateId === "overlap-cancelled",
    ),
  ).toMatchObject({ payments: [], reviewStatus: "history" });
  const replay = await post(page.request, firstCommit!);
  expect(replay.status()).toBe(200);
  expect((await replay.json()).result.duplicate).toBe(true);
  expect((await state(page)).workspace.transactions).toEqual(
    savedAfterLoss.workspace.transactions,
  );
  await page.reload();
  await expect(
    page
      .locator(".commerce-order")
      .filter({ hasText: "Synthetic overlap-completed-one" }),
  ).toBeVisible();
  await noOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/orders-history-desktop.png"),
  });
});

test("mobile manual orders offer category-specific platforms and keep each draft independent without cash movement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/orders");
  const before = await state(page);
  await page.getByRole("button", { name: "Add order", exact: true }).click();
  const drafts = page.locator(".commerce-draft");
  const stationery = drafts.nth(0);
  const category = stationery.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  const platform = stationery.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(platform).toBeVisible();
  await stationery
    .getByLabel("Description", { exact: true })
    .fill("Synthetic stationery history order");
  await stationery.getByLabel("Amount · ₹", { exact: true }).fill("26.80");
  await stationery
    .getByLabel("Save as", { exact: true })
    .selectOption("history");
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
  const customPlatform = "Synthetic Stationery Counter";
  await stationery
    .getByLabel("Other platform / source", { exact: true })
    .fill(customPlatform);
  await page.getByRole("button", { name: "Add order", exact: true }).click();
  await expect(drafts).toHaveCount(2);
  const food = drafts.nth(1);
  await food
    .getByLabel("Description", { exact: true })
    .fill("Synthetic food history order");
  await food.getByLabel("Amount · ₹", { exact: true }).fill("8.50");
  await food.getByLabel("Save as", { exact: true }).selectOption("history");
  await food
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Food");
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await food
    .getByRole("combobox", { name: "Platform / Source", exact: true })
    .selectOption("Zomato");
  await expect(
    page.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await expect(category).toHaveValue("Stationery");
  await expect(
    stationery.getByLabel("Other platform / source", { exact: true }),
  ).toHaveValue(customPlatform);
  await noOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await stationery.scrollIntoViewIfNeeded();
  await stationery.screenshot({
    path: path.resolve("artifacts/orders-platform-mobile.png"),
  });
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await page
    .getByRole("button", { name: "Save reviewed orders", exact: true })
    .click();
  await expect(drafts).toHaveCount(0);
  const after = await state(page);
  expect(after.workspace.transactions).toEqual(before.workspace.transactions);
  expect(after.cash).toBe(before.cash);
  expect(after.spending).toEqual(before.spending);
  expect(
    after.commerce.orders.find(
      (row) => row.description === "Synthetic stationery history order",
    ),
  ).toMatchObject({
    category: "Stationery",
    platform: customPlatform,
    reviewStatus: "history",
    payments: [],
  });
  expect(
    after.commerce.orders.find(
      (row) => row.description === "Synthetic food history order",
    ),
  ).toMatchObject({
    category: "Food",
    platform: "Zomato",
    reviewStatus: "history",
    payments: [],
  });
});

test("editing a manual pending order after a lost save response keeps one updated ledger draft", async ({
  page,
}) => {
  await page.goto("/orders");
  const before = await state(page);
  await page.getByRole("button", { name: "Add order", exact: true }).click();
  const draft = page.locator(".commerce-draft");
  await draft
    .getByLabel("Description", { exact: true })
    .fill("Synthetic manual retry draft");
  await draft.getByLabel("Amount · ₹", { exact: true }).fill("40.00");
  const keys: string[] = [];
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const command = route.request().postDataJSON() as CommerceCommand;
    if (command.action !== "commit_orders")
      throw new Error("Unexpected synthetic command.");
    keys.push(command.idempotencyKey);
    if (keys.length === 1) {
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  const save = page.getByRole("button", {
    name: "Save reviewed orders",
    exact: true,
  });
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await save.click();
  await expect(page.locator(".commerce-page > .error")).toBeVisible();
  await draft
    .getByLabel("Description", { exact: true })
    .fill("Synthetic corrected manual draft");
  await draft.getByLabel("Amount · ₹", { exact: true }).fill("43.21");
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await save.click();
  await expect(draft).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
  const after = await state(page);
  expect(after.workspace.transactions).toHaveLength(
    before.workspace.transactions.length + 1,
  );
  expect(
    after.workspace.transactions.find(
      (row) => row.description === "Synthetic corrected manual draft",
    ),
  ).toMatchObject({
    amount: "43.21",
    status: "pending_review",
    occurredOn: null,
  });
  expect(after.cash).toBe(before.cash);
  expect(after.spending).toEqual(before.spending);
});

test("existing purchase links once and scanned statements and design references route to their finance pages", async ({
  page,
}) => {
  const before = await state(page);
  await mockSettings(page);
  await page.goto("/orders");
  await page.getByRole("button", { name: "Add order", exact: true }).click();
  const draft = page.locator(".commerce-draft");
  await draft
    .getByLabel("Description", { exact: true })
    .fill("Synthetic already paid purchase");
  await draft.getByLabel("Amount · ₹", { exact: true }).fill("137.25");
  await draft.getByLabel("Purchase date", { exact: true }).fill("2026-10-02");
  await expect(draft.getByRole("status")).toContainText(
    "Similar payments exist",
  );
  await draft.getByLabel("Save as", { exact: true }).selectOption("link");
  await draft
    .getByLabel("Existing payment", { exact: true })
    .selectOption(linkPurchaseId);
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await page
    .getByRole("button", { name: "Save reviewed orders", exact: true })
    .click();
  await expect(draft).toHaveCount(0);
  const linked = await state(page);
  expect(linked.workspace.transactions).toEqual(before.workspace.transactions);
  expect(linked.cash).toBe(before.cash);
  expect(linked.spending).toEqual(before.spending);
  expect(
    linked.commerce.orders.filter((row) =>
      row.payments.some((payment) => payment.transactionId === linkPurchaseId),
    ),
  ).toHaveLength(1);
  await mockScan(
    page,
    scanResult(
      "synthetic-nonpurchase-documents",
      [
        scanned("ui-statement", {
          sourceType: "bank_statement",
          financialEvent: "account_snapshot",
          sourceImageIndices: [0],
        }),
        scanned("ui-paylater-snapshot", {
          sourceType: "paylater_snapshot",
          financialEvent: "account_snapshot",
          sourceImageIndices: [0],
        }),
        scanned("ui-design-reference", {
          sourceType: "design_reference_only",
          financialEvent: "reference_only",
          sourceImageIndices: [0],
        }),
      ],
      "bank_statement",
    ),
  );
  await scanOrders(page);
  const documents = page.locator(".commerce-draft");
  await expect(documents).toHaveCount(3);
  await expect(
    documents
      .nth(0)
      .getByRole("link", { name: "Open its finance page", exact: true }),
  ).toHaveAttribute("href", "/imports");
  await expect(
    documents
      .nth(1)
      .getByRole("link", { name: "Open its finance page", exact: true }),
  ).toHaveAttribute("href", "/accounts");
  for (const index of [0, 1, 2]) {
    await expect(
      documents.nth(index).getByLabel("Save as", { exact: true }),
    ).toHaveValue("history");
    await expect(
      documents
        .nth(index)
        .getByLabel("Save as", { exact: true })
        .locator("option"),
    ).toHaveCount(1);
  }
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await page
    .getByRole("button", { name: "Save reviewed orders", exact: true })
    .click();
  await expect(documents).toHaveCount(0);
  expect((await state(page)).workspace.transactions).toEqual(
    before.workspace.transactions,
  );
});

test("removing or discarding a scanned order resets Other platform mode before rescanning", async ({
  page,
}) => {
  await mockSettings(page);
  await mockScan(
    page,
    scanResult("synthetic-platform-reset", [
      scanned("platform-reset", { category: "Food", platform: "Swiggy" }),
    ]),
  );
  const before = await state(page);
  await page.goto("/orders");
  await scanOrders(page);
  const draft = page.locator(".commerce-draft");
  const platform = draft.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  const customPlatform = draft.getByLabel("Other platform / source", {
    exact: true,
  });
  await expect(platform).toHaveValue("Swiggy");
  await platform.selectOption("Other");
  await customPlatform.fill("Synthetic removed custom platform");
  await draft
    .getByRole("button", { name: "Remove draft", exact: true })
    .click();
  await expect(draft).toHaveCount(0);
  await scanOrders(page);
  await expect(draft).toHaveCount(1);
  await expect(platform).toHaveValue("Swiggy");
  await expect(customPlatform).toHaveCount(0);
  await platform.selectOption("Other");
  await customPlatform.fill("Synthetic discarded custom platform");
  await page
    .getByRole("button", { name: "Discard drafts", exact: true })
    .click();
  await expect(draft).toHaveCount(0);
  await scanOrders(page);
  await expect(draft).toHaveCount(1);
  await expect(platform).toHaveValue("Swiggy");
  await expect(customPlatform).toHaveCount(0);
  const after = await state(page);
  expect(after.commerce).toEqual(before.commerce);
  expect(after.workspace.transactions).toEqual(before.workspace.transactions);
  expect(after.cash).toBe(before.cash);
});

test("mobile order review preserves manual edits through a repeated scan and saves an undated pending draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSettings(page);
  const result = scanResult("synthetic-mobile-undated", [
    scanned("mobile-undated", {
      amount: null,
      occurredOn: null,
      currency: "INR",
      paymentStatus: "unknown",
      amountRole: "order_total",
      confidence: "low",
      warnings: ["Confirm purchase date and actual amount paid."],
    }),
  ]);
  await mockScan(page, result);
  const before = await state(page);
  await page.goto("/orders");
  await scanOrders(page);
  const draft = page.locator(".commerce-draft");
  const platform = draft.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(platform).toBeVisible();
  await expect(platform).toHaveValue("Synthetic Shopping");
  await expect(draft.getByLabel("Amount · ₹", { exact: true })).toHaveValue("");
  await expect(draft.getByLabel("Purchase date", { exact: true })).toHaveValue(
    "",
  );
  await draft
    .getByLabel("Description", { exact: true })
    .fill("Synthetic reviewed mobile order");
  await draft.getByLabel("Amount · ₹", { exact: true }).fill("39.99");
  await draft.getByLabel("Category", { exact: true }).selectOption("Groceries");
  await expect(platform).toHaveValue("Synthetic Shopping");
  await expect(
    platform.getByRole("option", { name: "Synthetic Shopping", exact: true }),
  ).toHaveCount(1);
  await scanOrders(page);
  await expect(draft).toHaveCount(1);
  await expect(draft.getByLabel("Description", { exact: true })).toHaveValue(
    "Synthetic reviewed mobile order",
  );
  await expect(draft.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "39.99",
  );
  await expect(draft.getByLabel("Category", { exact: true })).toHaveValue(
    "Groceries",
  );
  await expect(platform).toHaveValue("Synthetic Shopping");
  await expect(draft.getByLabel("Purchase date", { exact: true })).toHaveValue(
    "",
  );
  await expect(draft.getByLabel("Paid from", { exact: true })).toHaveValue("");
  await expect(draft.getByLabel("Save as", { exact: true })).toHaveValue(
    "pending",
  );
  await noOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await draft.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.resolve("artifacts/orders-review-mobile.png"),
  });
  await page.getByRole("checkbox", { name: reviewLabel, exact: true }).check();
  await page
    .getByRole("button", { name: "Save reviewed orders", exact: true })
    .click();
  await expect(draft).toHaveCount(0);
  const after = await state(page);
  expect(after.cash).toBe(before.cash);
  expect(after.spending).toEqual(before.spending);
  expect(
    after.commerce.orders.find(
      (row) => row.description === "Synthetic reviewed mobile order",
    ),
  ).toMatchObject({
    category: "Groceries",
    platform: "Synthetic Shopping",
  });
  expect(
    after.workspace.transactions.find(
      (row) => row.description === "Synthetic reviewed mobile order",
    ),
  ).toMatchObject({
    amount: "39.99",
    occurredOn: null,
    fromAccountId: null,
    status: "pending_review",
    category: "Groceries",
  });
  await page.reload();
  await expect(
    page
      .locator(".commerce-order")
      .filter({ hasText: "Synthetic reviewed mobile order" }),
  ).toContainText("Date unknown");
  await noOverflow(page);
});

test("refund review stays pending until an explicitly verified bank credit and mobile controls remain usable", async ({
  page,
}) => {
  await page.goto("/orders");
  const before = await state(page);
  await page
    .getByRole("button", { name: "Track refund", exact: true })
    .first()
    .click();
  const modal = page.locator(".commerce-modal");
  await expect(
    modal.getByRole("heading", {
      name: "Track cancellation or refund",
      exact: true,
    }),
  ).toBeVisible();
  await modal
    .getByLabel("Original purchase", { exact: true })
    .selectOption(otherPurchaseId);
  await modal
    .getByLabel("Description", { exact: true })
    .fill("Synthetic refund from UI");
  await modal.getByLabel("Expected refund · ₹", { exact: true }).fill("30.00");
  await modal.getByLabel("Refund method", { exact: true }).selectOption("bank");
  await modal
    .getByLabel("Refund destination", { exact: true })
    .selectOption(bankId);
  await expect(
    modal
      .getByLabel("Refund destination", { exact: true })
      .locator(`option[value="${inactiveBankId}"]`),
  ).toHaveCount(0);
  const save = modal.getByRole("button", {
    name: "Save refund request",
    exact: true,
  });
  await expect(save).toBeDisabled();
  await modal
    .getByRole("checkbox", {
      name: "I reviewed this refund request. This saves a pending record, not a bank credit.",
      exact: true,
    })
    .check();
  await save.click();
  await expect(modal).toHaveCount(0);
  const pending = await state(page);
  expect(pending.cash).toBe(before.cash);
  expect(pending.spending).toEqual(before.spending);
  expect(pending.workspace.transactions).toEqual(before.workspace.transactions);
  const card = page
    .locator(".commerce-refund")
    .filter({ hasText: "Synthetic refund from UI" });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Confirm credit", exact: true })
    .click();
  await expect(
    modal.getByRole("heading", { name: "Confirm refund credit", exact: true }),
  ).toBeVisible();
  await modal
    .getByLabel("Verify using", { exact: true })
    .selectOption("manual");
  await expect(modal.getByLabel("Credit date", { exact: true })).toHaveValue(
    "",
  );
  await modal.getByLabel("Received in", { exact: true }).selectOption(bankId);
  await modal.getByLabel("Credit date", { exact: true }).fill("2026-10-11");
  await modal.getByLabel("Received amount · ₹", { exact: true }).fill("30.00");
  const confirm = modal.getByRole("button", {
    name: "Confirm credit",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/refund-confirm-mobile.png"),
  });
  await modal
    .getByRole("checkbox", {
      name: "I checked this credit in my bank or payment provider history.",
      exact: true,
    })
    .check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(modal).toHaveCount(0);
  const after = await state(page);
  expect(subtractMoney(after.cash!, before.cash!)).toBe("30.00");
  expect(subtractMoney(before.spending.net, after.spending.net)).toBe("30.00");
  expect(after.workspace.transactions.length).toBe(
    before.workspace.transactions.length + 1,
  );
  await page.reload();
  await expect(card).toContainText("confirmed");
  await noOverflow(page);
});
