import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Transaction } from "../../src/lib/types";
import {
  fixture,
  mockWorkspace,
  noOverflow,
  openEditor,
  OWNER,
  TODAY,
} from "./fixture";

async function picker(page: Page, editor: Locator, label: string) {
  await editor.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: `Choose ${label.toLowerCase()}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function choose(
  page: Page,
  editor: Locator,
  label: string,
  option: string | RegExp,
) {
  const dialog = await picker(page, editor, label);
  await dialog
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function expandSearch(dialog: Locator, label: string) {
  await dialog
    .getByRole("button", { name: `Search ${label.toLowerCase()}`, exact: true })
    .click();
  const input = dialog.getByRole("searchbox", {
    name: `Search ${label.toLowerCase()}`,
    exact: true,
  });
  await expect(input).toBeFocused();
  return input;
}

const save = (editor: Locator, kind = "expense") =>
  editor.getByRole("button", { name: `Save ${kind}`, exact: true });

async function fillExpense(
  page: Page,
  editor: Locator,
  accountName = /QA Everyday Savings/,
) {
  await editor.locator('input[name="amount"]').fill("50.00");
  await editor.locator('textarea[name="description"]').fill("QA compact lunch");
  await choose(page, editor, "Paid from", accountName);
}

async function assertControlsFit(page: Page, editor: Locator) {
  await noOverflow(page);
  const width = page.viewportSize()!.width;
  for (const field of await editor
    .locator(
      "input:visible, select:visible, textarea:visible, .transaction-picker-trigger:visible",
    )
    .all()) {
    const box = await field.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
}

async function applyMockReceipt(
  context: BrowserContext,
  page: Page,
  editor: Locator,
  fields: Record<string, unknown> = {},
) {
  await context.route("**/api/ai/settings", (route) =>
    route.fulfill({
      status: 200,
      json: {
        available: true,
        configured: true,
        ownerManaged: true,
        provider: "Vercel AI Gateway",
        model: "synthetic-test-model",
        requiresRedaction: false,
      },
    }),
  );
  await context.route("**/api/ai/receipt", (route) =>
    route.fulfill({
      status: 200,
      json: {
        provider: "Vercel AI Gateway",
        model: "synthetic-test-model",
        fingerprint: "d".repeat(64),
        extraction: {
          documentType: "payment",
          amount: "45.00",
          currency: "INR",
          occurredOn: TODAY,
          merchant: "QA Receipt Seller",
          description: "QA reviewed payment",
          platform: "Swiggy",
          kind: "expense",
          category: "Food",
          externalReference: "QA-RECEIPT-GUARD-001",
          accountHint: "QA Bank",
          paymentStatus: "successful",
          confidence: "high",
          warnings: [],
          ...fields,
        },
      },
    }),
  );
  await editor
    .getByRole("button", { name: "Scan receipt", exact: true })
    .click();
  const scanner = page.locator(".receipt-modal");
  await scanner
    .getByLabel("Payment screenshot or shopping receipt")
    .setInputFiles({
      name: "synthetic-guard-receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await scanner
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(scanner.getByLabel("AI receipt review")).toContainText(
    "INR 45.00",
  );
  await scanner
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(scanner).toHaveCount(0);
}

for (const width of [320, 360, 375, 390, 412, 430, 768, 1024, 1440]) {
  test(`compact editor and pickers fit ${width}px without page overflow`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = fixture();
    const state = await mockWorkspace(context, page, baseURL!, f.data);
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    const editor = await openEditor(page);
    await expect(
      editor.getByRole("heading", { name: "Add expense", exact: true }),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Scan receipt", exact: true }),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Take Photo", exact: true }),
    ).toHaveCount(0);
    await expect(
      editor.getByLabel("External payer", { exact: true }),
    ).toHaveCount(0);
    await expect(editor.locator('input[name="occurredOn"]')).toHaveValue(TODAY);
    await expect(
      editor.getByRole("button", { name: "Paid from", exact: true }),
    ).toContainText("Choose account");
    await editor.locator('input[name="amount"]').fill("50.00");
    await assertControlsFit(page, editor);
    await expect(save(editor)).toBeInViewport();
    const category = await picker(page, editor, "Category");
    await expect(category.getByRole("searchbox")).toHaveCount(0);
    await expect(
      category.getByRole("option", { selected: true }),
    ).toBeFocused();
    await noOverflow(page);
    const categoryBox = (await category.boundingBox())!;
    expect(categoryBox.x).toBeGreaterThanOrEqual(-1);
    expect(categoryBox.x + categoryBox.width).toBeLessThanOrEqual(width + 1);
    await category.getByRole("option", { name: "Food", exact: true }).click();
    await expect(
      editor.getByRole("button", { name: "Category", exact: true }),
    ).toBeFocused();
    await editor.locator("summary").filter({ hasText: "More details" }).click();
    await editor
      .getByLabel("Bank reference", { exact: true })
      .fill("QA-COMPACT-REFERENCE");
    await save(editor).scrollIntoViewIfNeeded();
    await expect(save(editor)).toBeInViewport();
    await assertControlsFit(page, editor);
    if ([320, 390, 1440].includes(width)) {
      const dir = `artifacts/compact-expense/after/${width}px`;
      await mkdir(dir, { recursive: true });
      await editor
        .locator("summary")
        .filter({ hasText: "More details" })
        .click();
      await editor.locator('input[name="amount"]').focus();
      await page.screenshot({ path: `${dir}/add-expense.png` });
      const account = await picker(page, editor, "Paid from");
      await page.screenshot({ path: `${dir}/account-picker.png` });
      await account
        .getByRole("button", { name: "Close paid from picker", exact: true })
        .click();
    }
    state.unchanged();
  });
}

test("account picker groups active accounts, searches and masks identifiers", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  f.bank.maskedSuffix = "1234567890120425";
  f.data.accounts.push({
    ...f.bank,
    id: "00000000-0000-4000-8000-000000099991",
    userId: "20000000-0000-4000-8000-000000000001",
    name: "QA Other User Account Must Stay Hidden",
  });
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  const editor = await openEditor(page);
  const account = await picker(page, editor, "Paid from");
  for (const name of [/Bank/, /Credit/, /Pay Later/, /Wallet/])
    await expect(account.getByRole("group", { name })).toBeVisible();
  await expect(account).not.toContainText("QA Archived Account");
  await expect(account).not.toContainText(
    "QA Other User Account Must Stay Hidden",
  );
  await expect(account).not.toContainText("1234567890120425");
  await expect(
    account.getByRole("option", { name: /QA Everyday Savings/ }),
  ).toContainText("0425");
  await (await expandSearch(account, "Paid from")).fill("rewards");
  await expect(account.getByRole("option")).toHaveCount(1);
  await account.getByRole("option", { name: /QA Rewards Card/ }).click();
  await expect(
    editor.getByRole("button", { name: "Paid from", exact: true }),
  ).toContainText("QA Rewards Card");
  await expect(
    editor.getByRole("button", { name: "Paid from", exact: true }),
  ).toBeFocused();
  state.unchanged();
});

test("category and platform keep suggestions, custom entry and incompatible reset", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  const editor = await openEditor(page);
  const category = await picker(page, editor, "Category");
  await (await expandSearch(category, "Category")).fill("shop");
  await expect(category.getByRole("option")).toHaveCount(1);
  await category.getByRole("option", { name: "Shopping", exact: true }).click();
  await choose(page, editor, "Platform", "Amazon");
  await choose(page, editor, "Category", "Food");
  await expect(
    editor.getByRole("button", { name: "Platform", exact: true }),
  ).not.toContainText("Amazon");
  const platform = await picker(page, editor, "Platform");
  await expect(
    platform.getByRole("option", { name: "Swiggy", exact: true }),
  ).toBeVisible();
  await expect(
    platform.getByRole("option", { name: "Amazon", exact: true }),
  ).toHaveCount(0);
  await platform.getByRole("option", { name: /^Other(s)?$/ }).click();
  const custom = editor.getByLabel(/Other platform/i);
  await custom.fill("QA Local Food App");
  await choose(page, editor, "Category", "Groceries");
  await expect(custom).toHaveValue("QA Local Food App");
  state.unchanged();
});

test("picker supports search, arrow keys, Home/End, Escape and focus restoration", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  const editor = await openEditor(page);
  let category = await picker(page, editor, "Category");
  const search = await expandSearch(category, "Category");
  await search.fill("no matching category xyz");
  await expect(category.getByRole("status")).toContainText(
    "No matching options",
  );
  await search.fill("Food");
  await search.press("ArrowDown");
  await expect(
    category.getByRole("option", { name: "Food", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    editor.getByRole("button", { name: "Category", exact: true }),
  ).toContainText("Food");
  await expect(
    editor.getByRole("button", { name: "Category", exact: true }),
  ).toBeFocused();
  category = await picker(page, editor, "Category");
  await expect(category.getByRole("searchbox")).toHaveCount(0);
  await expect(category.getByRole("option", { selected: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(category.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(category.getByRole("option").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(category).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Category", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add transaction", exact: true }),
  ).toBeFocused();
  state.unchanged();
});

for (const width of [320, 1440]) {
  for (const [label, query] of [
    ["Category", "Food"],
    ["Platform", "Swiggy"],
    ["Paid from", "Rewards"],
  ]) {
    test(`${label} search opens only on request and resets at ${width}px`, async ({
      context,
      page,
      baseURL,
    }) => {
      const f = fixture();
      const state = await mockWorkspace(context, page, baseURL!, f.data);
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      const editor = await openEditor(page);
      if (label === "Platform") await choose(page, editor, "Category", "Food");
      let dialog = await picker(page, editor, label);
      const options = dialog.getByRole("option");
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThan(1);
      await expect(dialog.getByRole("searchbox")).toHaveCount(0);
      await expect(
        dialog.getByRole("option", { selected: true }),
      ).toBeFocused();
      let toggle = dialog.getByRole("button", {
        name: `Search ${label.toLowerCase()}`,
        exact: true,
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toHaveAttribute("aria-controls", /.+/);
      const toggleBox = (await toggle.boundingBox())!;
      expect(toggleBox.height).toBeGreaterThanOrEqual(44);
      expect(toggleBox.width).toBeGreaterThanOrEqual(44);
      const dir = `artifacts/picker-search-on-demand/${width}px`;
      const name = label.toLowerCase().replaceAll(" ", "-");
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${name}-collapsed.png` });
      if (width === 320) await toggle.click();
      else {
        await toggle.focus();
        await toggle.press("Enter");
      }
      let input = dialog.getByRole("searchbox", {
        name: `Search ${label.toLowerCase()}`,
        exact: true,
      });
      await expect(input).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await input.fill(query);
      await expect(options).toHaveCount(1);
      await noOverflow(page);
      await page.screenshot({ path: `${dir}/${name}-expanded.png` });
      await dialog
        .getByRole("button", {
          name: `Close ${label.toLowerCase()} search`,
          exact: true,
        })
        .click();
      await expect(dialog.getByRole("searchbox")).toHaveCount(0);
      await expect(options).toHaveCount(optionCount);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toBeFocused();
      input = await expandSearch(dialog, label);
      await expect(input).toHaveValue("");
      await input.fill("nothing matches this QA search");
      await expect(dialog.getByRole("status")).toContainText(
        "No matching options",
      );
      await dialog
        .getByRole("button", {
          name: `Close ${label.toLowerCase()} picker`,
          exact: true,
        })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        editor.getByRole("button", { name: label, exact: true }),
      ).toBeFocused();
      dialog = await picker(page, editor, label);
      await expect(dialog.getByRole("searchbox")).toHaveCount(0);
      await expect(dialog.getByRole("option")).toHaveCount(optionCount);
      toggle = dialog.getByRole("button", {
        name: `Search ${label.toLowerCase()}`,
        exact: true,
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      input = await expandSearch(dialog, label);
      await expect(input).toHaveValue("");
      await input.fill(query);
      await expect(dialog.getByRole("option")).toHaveCount(1);
      const selectedLabel = await dialog.getByRole("option").innerText();
      await dialog.getByRole("option").click();
      await expect(dialog).toHaveCount(0);
      dialog = await picker(page, editor, label);
      await expect(dialog.getByRole("searchbox")).toHaveCount(0);
      await expect(
        dialog.getByRole("option", { selected: true }),
      ).toContainText(selectedLabel, { useInnerText: true });
      await expect(
        dialog.getByRole("option", { selected: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(editor).toBeVisible();
      state.unchanged();
    });
  }
}

test("transaction type picker keeps direct keyboard selection without a search control", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  const editor = await openEditor(page);
  const dialog = await picker(page, editor, "Transaction type");
  await expect(dialog.getByRole("searchbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Search / })).toHaveCount(0);
  await expect(
    dialog.getByRole("option", { name: "Expense", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    dialog.getByRole("option", { name: "Income", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Transaction type", exact: true }),
  ).toContainText("Income");
  state.unchanged();
});

test("someone else paid explicitly reveals payer and saves without inventing an account", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  const editor = await openEditor(page);
  await expect(
    editor.getByLabel("External payer", { exact: true }),
  ).toHaveCount(0);
  await choose(page, editor, "Paid from", /Someone else paid/);
  await editor.getByLabel("External payer", { exact: true }).fill("QA Friend");
  await editor.locator('input[name="amount"]').fill("25.00");
  await editor
    .locator('textarea[name="description"]')
    .fill("QA externally paid lunch");
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    amount: "25.00",
    description: "QA externally paid lunch",
    userId: OWNER,
    kind: "expense",
    status: "posted",
    fromAccountId: null,
    toAccountId: null,
    externalPayer: "QA Friend",
    sourceSystem: "manual",
    occurredOn: TODAY,
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("manual expense requires description and account and saves only once with optional metadata", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  const editor = await openEditor(page);
  await editor.locator('input[name="amount"]').fill("50.00");
  await save(editor).click();
  expect(state.writes).toEqual([]);
  await expect(editor.locator('textarea[name="description"]')).toBeFocused();
  await editor.locator('textarea[name="description"]').fill("QA compact lunch");
  await save(editor).click();
  await expect(editor.getByRole("alert")).toContainText(
    /Choose an account|source account/i,
  );
  expect(state.writes).toEqual([]);
  await choose(page, editor, "Paid from", /QA Everyday Savings/);
  await choose(page, editor, "Category", "Food");
  await choose(page, editor, "Platform", "Swiggy");
  await editor.locator("summary").filter({ hasText: "More details" }).click();
  await editor
    .getByLabel("Bank reference", { exact: true })
    .fill("QA-MANUAL-001");
  await editor
    .getByLabel("Merchant (optional)", { exact: true })
    .fill("QA Cafe");
  await editor.getByLabel("Notes", { exact: true }).fill("QA optional note");
  await editor.locator("summary").filter({ hasText: "More details" }).click();
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    amount: "50.00",
    description: "QA compact lunch",
    userId: OWNER,
    kind: "expense",
    status: "posted",
    fromAccountId: f.bank.id,
    toAccountId: null,
    externalPayer: null,
    externalReference: "QA-MANUAL-001",
    category: "Food",
    platform: "Swiggy",
    merchant: "QA Cafe",
    notes: "QA optional note",
    occurredOn: TODAY,
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("transaction type changes show the correct accounts and preserve financial type semantics", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  const editor = await openEditor(page);
  await choose(page, editor, "Transaction type", "Transfer");
  await expect(
    editor.getByRole("heading", { name: "Add transfer", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "From account", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "To account", exact: true }),
  ).toBeVisible();
  await editor.locator('input[name="amount"]').fill("30.00");
  await editor
    .locator('textarea[name="description"]')
    .fill("QA wallet movement");
  await choose(page, editor, "From account", /QA Everyday Savings/);
  await choose(page, editor, "To account", /QA Daily Wallet/);
  await save(editor, "transfer").click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    amount: "30.00",
    kind: "transfer",
    status: "posted",
    fromAccountId: f.bank.id,
    toAccountId: f.wallet.id,
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("same-day reported balance confirmation remains visible outside optional details", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  f.data.snapshots.push({
    id: "00000000-0000-4000-8000-000000098001",
    userId: OWNER,
    accountId: f.bank.id,
    asOf: `${TODAY}T08:00:00+05:30`,
    source: "user_report",
    verifiedByUser: true,
    reportedBalance: "900.00",
  });
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  const editor = await openEditor(page);
  await fillExpense(page, editor);
  const confirmation = editor.getByRole("combobox", {
    name: `Does the ${f.bank.name} balance already include this payment?`,
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await expect(editor.locator("details")).not.toHaveAttribute("open");
  await save(editor).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Choose whether the reported account balance already includes this payment",
  );
  expect(state.writes).toEqual([]);
  await confirmation.selectOption("excluded");
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    fromBalanceSnapshotId: f.data.snapshots[0].id,
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("compact receipt action opens the existing scanner and restores parent focus", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  const editor = await openEditor(page);
  const trigger = editor.getByRole("button", {
    name: "Scan receipt",
    exact: true,
  });
  await trigger.click();
  const scanner = page.locator(".receipt-modal");
  await expect(scanner).toBeVisible();
  await expect(
    scanner.getByRole("button", { name: "Camera", exact: true }),
  ).toBeVisible();
  await expect(
    scanner.getByRole("button", { name: "Upload", exact: true }),
  ).toBeVisible();
  await scanner
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(scanner).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(scanner).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(scanner).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(trigger).toBeFocused();
  state.unchanged();
});

test("receipt autofill retains explicit review before saving a confirmed payment", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  let scans = 0;
  await context.route("**/api/ai/settings", (route) =>
    route.fulfill({
      status: 200,
      json: {
        available: true,
        configured: true,
        ownerManaged: true,
        provider: "Vercel AI Gateway",
        model: "synthetic-test-model",
        requiresRedaction: false,
      },
    }),
  );
  await context.route("**/api/ai/receipt", (route) => {
    scans++;
    return route.fulfill({
      status: 200,
      json: {
        provider: "Vercel AI Gateway",
        model: "synthetic-test-model",
        fingerprint: "c".repeat(64),
        extraction: {
          documentType: "payment",
          amount: "45.00",
          currency: "INR",
          occurredOn: TODAY,
          merchant: "QA Receipt Seller",
          description: "QA scanned lunch",
          platform: "Swiggy",
          kind: "expense",
          category: "Food",
          externalReference: "QA-RECEIPT-001",
          accountHint: "QA Bank",
          paymentStatus: "successful",
          confidence: "high",
          warnings: [],
        },
      },
    });
  });
  const editor = await openEditor(page);
  await editor
    .getByRole("button", { name: "Scan receipt", exact: true })
    .click();
  const scanner = page.locator(".receipt-modal");
  await scanner
    .getByLabel("Payment screenshot or shopping receipt")
    .setInputFiles({
      name: "synthetic-receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await scanner
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(scanner.getByLabel("AI receipt review")).toContainText(
    "INR 45.00",
  );
  await scanner
    .getByRole("button", { name: /Use (these |selected )?details/i })
    .click();
  await expect(scanner).toHaveCount(0);
  await expect(editor.locator('input[name="amount"]')).toHaveValue("45.00");
  await expect(save(editor)).toBeDisabled();
  await expect(editor.getByText(/reviewed possible duplicates/)).toBeVisible();
  expect(state.writes).toEqual([]);
  await choose(page, editor, "Paid from", /QA Everyday Savings/);
  await editor
    .getByRole("checkbox", { name: /I checked the extracted details/ })
    .check();
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(scans).toBe(1);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    amount: "45.00",
    kind: "expense",
    status: "posted",
    fromAccountId: f.bank.id,
    sourceSystem: "receipt_ai",
    sourceObjectId: "c".repeat(64),
    externalReference: "QA-RECEIPT-001",
  } satisfies Partial<Transaction>);
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("changing from external payer to an account clears stale payer metadata", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  const editor = await openEditor(page);
  await choose(page, editor, "Paid from", /Someone else paid/);
  await editor
    .getByLabel("External payer", { exact: true })
    .fill("QA Former Payer");
  await fillExpense(page, editor);
  await expect(
    editor.getByLabel("External payer", { exact: true }),
  ).toHaveCount(0);
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    fromAccountId: f.bank.id,
    externalPayer: null,
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("missing date stays Needs review and does not invent a date", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  const editor = await openEditor(page);
  await fillExpense(page, editor);
  await editor.locator('input[name="occurredOn"]').fill("");
  await expect(
    editor.getByText(
      "Missing dates or incomplete transfers stay in Needs review.",
      { exact: true },
    ),
  ).toBeVisible();
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    occurredOn: null,
    status: "pending_review",
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("editing retains saved custom category, platform, source, archived account and hidden metadata", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const original: Transaction = {
    id: "00000000-0000-4000-8000-000000098301",
    userId: OWNER,
    amount: "21.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: TODAY,
    description: "QA archived custom purchase",
    fromAccountId: f.archived.id,
    toAccountId: null,
    category: "QA Custom Category",
    platform: "QA Custom Platform",
    merchant: "QA Original Merchant",
    externalReference: "QA-OLD-REF",
    notes: "QA Original Note",
    sourceSystem: "notion",
    sourceObjectId: "qa-source-identity",
    receiptDocumentId: null,
  };
  f.data.transactions.push(original);
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  await page.goto("/transactions");
  await page
    .getByRole("button", {
      name: `View transaction: ${original.description}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Edit transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Category", exact: true }),
  ).toContainText("QA Custom Category");
  await expect(
    editor.getByRole("button", { name: "Platform", exact: true }),
  ).toContainText("QA Custom Platform");
  await expect(
    editor.getByRole("button", { name: "Paid from", exact: true }),
  ).toContainText("QA Archived Account");
  const account = await picker(page, editor, "Paid from");
  await expect(
    account.getByRole("option", { name: /QA Archived Account/ }),
  ).toContainText("Archived account");
  await account
    .getByRole("button", { name: "Close paid from picker", exact: true })
    .click();
  await editor
    .locator('textarea[name="description"]')
    .fill("QA edited description only");
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    ...original,
    description: "QA edited description only",
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("editing a pending payment retains pending status until explicit confirmation", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const original: Transaction = {
    id: "00000000-0000-4000-8000-000000098302",
    userId: OWNER,
    amount: "22.00",
    currency: "INR",
    kind: "expense",
    status: "pending_review",
    occurredOn: TODAY,
    description: "QA awaiting payment confirmation",
    fromAccountId: f.bank.id,
    toAccountId: null,
    category: "Food",
    platform: "Swiggy",
    sourceSystem: "receipt_ai",
    sourceObjectId: "a".repeat(64),
  };
  f.data.transactions.push(original);
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  await page.goto("/transactions");
  await page
    .getByRole("button", {
      name: `View transaction: ${original.description}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Edit transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await expect(
    editor.getByRole("checkbox", {
      name: "I confirmed this payment and account",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    editor.getByText(/Needs review payments do not change balances/),
  ).toBeVisible();
  await editor
    .locator('textarea[name="description"]')
    .fill("QA pending description corrected");
  await save(editor).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    id: original.id,
    status: "pending_review",
    sourceObjectId: original.sourceObjectId,
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

for (const paymentStatus of ["pending", "failed"]) {
  for (const completed of [false, true]) {
    test(`${paymentStatus} scanned payment ${completed ? "posts only after explicit completion confirmation" : "stays pending without completion confirmation"}`, async ({
      context,
      page,
      baseURL,
    }) => {
      const f = fixture();
      const state = await mockWorkspace(context, page, baseURL!, f.data, true);
      const editor = await openEditor(page);
      await applyMockReceipt(context, page, editor, { paymentStatus });
      await choose(page, editor, "Paid from", /QA Everyday Savings/);
      const confirmation = editor.getByRole("checkbox", {
        name: "I confirmed that this payment was completed.",
        exact: true,
      });
      await expect(confirmation).not.toBeChecked();
      if (completed) await confirmation.check();
      await editor
        .getByRole("checkbox", { name: /I checked the extracted details/ })
        .check();
      await save(editor).click();
      await expect(editor).toHaveCount(0);
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0].record).toMatchObject({
        status: completed ? "posted" : "pending_review",
        amount: "45.00",
        fromAccountId: f.bank.id,
      });
      expect(state.errors).toEqual([]);
      expect(state.unexpectedApis).toEqual([]);
    });
  }
}

test("correcting a scanned transaction type clears account/refund links and requires review again", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const original: Transaction = {
    id: "00000000-0000-4000-8000-000000098303",
    userId: OWNER,
    amount: "45.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: TODAY,
    description: "QA original purchase for refund",
    fromAccountId: f.bank.id,
    toAccountId: null,
    category: "Food",
    platform: "Swiggy",
  };
  f.data.transactions.push(original);
  const state = await mockWorkspace(context, page, baseURL!, f.data, true);
  const editor = await openEditor(page);
  await applyMockReceipt(context, page, editor, {
    kind: "refund",
    description: "QA reviewed refund",
  });
  await choose(page, editor, "To account", /QA Everyday Savings/);
  await editor
    .locator('select[name="refundOfTransactionId"]')
    .selectOption(original.id);
  await editor
    .getByRole("checkbox", { name: /I checked the extracted details/ })
    .check();
  await expect(save(editor, "refund")).toBeEnabled();
  await choose(page, editor, "Transaction type", "Expense");
  await expect(
    editor.getByRole("button", { name: "Paid from", exact: true }),
  ).toContainText("Choose account");
  await expect(
    editor.getByRole("checkbox", { name: /I checked the extracted details/ }),
  ).not.toBeChecked();
  await expect(save(editor)).toBeDisabled();
  await choose(page, editor, "Transaction type", "Refund");
  await expect(
    editor.getByRole("button", { name: "To account", exact: true }),
  ).toContainText("Choose account");
  await expect(
    editor.locator('select[name="refundOfTransactionId"]'),
  ).toHaveValue("");
  await choose(page, editor, "To account", /QA Everyday Savings/);
  await editor
    .getByRole("checkbox", { name: /I checked the extracted details/ })
    .check();
  await save(editor, "refund").click();
  await expect(editor).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].record).toMatchObject({
    kind: "refund",
    toAccountId: f.bank.id,
    fromAccountId: null,
    refundOfTransactionId: null,
  });
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});
