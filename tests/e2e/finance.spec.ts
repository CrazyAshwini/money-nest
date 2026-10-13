import { test, expect, type Page } from "@playwright/test";
import Decimal from "decimal.js";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceData } from "../../src/lib/types";

const BANK = "Meridian Everyday";
const BILL_ID = "00000000-0000-4000-8000-000000000201";
const STORAGE_KEY = "finance-os:fictional-demo:v1";
const browserErrors = new WeakMap<Page, string[]>();
const spendingCard = (page: Page) =>
  page
    .locator(".stats-grid .stat")
    .filter({ hasText: "This month's spending" });
async function spending(page: Page): Promise<string> {
  const value = await spendingCard(page).locator(":scope > strong").innerText();
  return new Decimal(value.replace(/[^\d.-]/g, "")).toFixed(2);
}
async function addTransaction(
  page: Page,
  values: {
    description: string;
    amount: string;
    kind?: string;
    to?: string;
    externalLender?: string;
  },
) {
  const transactionKind = values.kind ?? "expense";
  const returnUrl = page.url();
  if (transactionKind === "expense") {
    await page
      .getByRole("button", { name: "Add transaction", exact: true })
      .click();
  } else {
    await page.goto("/transactions");
    await page
      .getByRole("combobox", { name: "New transaction type", exact: true })
      .selectOption(transactionKind);
    await page
      .getByRole("button", {
        name: `Add ${transactionKind.replaceAll("_", " ")}`,
        exact: true,
      })
      .click();
  }
  const dialog = page.locator(".transaction-modal");
  await dialog
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(values.description);
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill(values.amount);
  await dialog.getByLabel("Date", { exact: true }).fill("2026-10-09");
  await dialog
    .getByRole("combobox", {
      name: ["income", "refund"].includes(transactionKind)
        ? "To account"
        : "From account",
      exact: true,
    })
    .selectOption({ label: BANK });
  if (values.to)
    await dialog
      .getByRole("combobox", { name: "To account", exact: true })
      .selectOption({ label: values.to });
  if (values.externalLender) {
    await dialog
      .getByLabel("External lender (for EMI repayment)", { exact: true })
      .fill(values.externalLender);
    await dialog
      .getByRole("checkbox", {
        name: /Confirmed payment to an external lender/,
      })
      .check();
  }
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  if (transactionKind !== "expense") await page.goto(returnUrl);
}
async function navigate(page: Page, label: string, mobile: boolean) {
  if (mobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: label, exact: true })
    .click();
}
async function noPageOverflow(page: Page) {
  const viewportWidth = page.viewportSize()!.width;
  const dimensions = await page.evaluate(() => ({
    inner: innerWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.inner).toBe(viewportWidth);
  expect(dimensions.client).toBe(viewportWidth);
  expect(dimensions.scroll).toBeLessThanOrEqual(viewportWidth + 1);
}
async function settleDashboard(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`Uncaught: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`Console: ${message.text()}`);
  });
  // Explicit synthetic mode keeps these tests independent of private Supabase credentials.
  await page.addInitScript(() =>
    sessionStorage.setItem("finance-os:mode", "demo"),
  );
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-strip")).toContainText("Fictional data");
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("dashboard navigation, dated provenance, and responsive KPI layout", async ({
  page,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".stats-grid .stat")).toHaveCount(4);
  await expect(spendingCard(page)).toContainText("posted expenses");
  await expect(
    page.locator(".stats-grid .stat").filter({ hasText: "Total bank balance" }),
  ).toContainText("Reported");
  await expect(page.locator(".account-breakdown")).toHaveCount(3);
  await expect(page.locator(".account-breakdown[open]")).toHaveCount(0);
  await expect(page.locator(".dashboard-bills .bill-row")).toHaveCount(3);
  await expect(page.locator(".recent-activity-row")).toHaveCount(3);
  await settleDashboard(page);
  await noPageOverflow(page);
  if (isMobile) {
    await page.setViewportSize({ width: 393, height: 851 });
    await settleDashboard(page);
    await noPageOverflow(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await settleDashboard(page);
    const boxes = await page.locator(".stats-grid .stat").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width };
      }),
    );
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(2);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
    expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThan(2);
    await noPageOverflow(page);
  }
  await page.screenshot({
    path: testInfo.outputPath("dashboard.png"),
    fullPage: true,
  });
  await mkdir(path.resolve("artifacts"), { recursive: true });
  const screenshot = await page.screenshot({
    path: path.resolve(
      `artifacts/dashboard-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
  const expectedWidth = await page.evaluate(
    () => document.documentElement.clientWidth * devicePixelRatio,
  );
  expect(screenshot.readUInt32BE(16)).toBe(Math.round(expectedWidth));
  const dashboardDimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: document.documentElement.scrollHeight,
    devicePixelRatio,
  }));
  expect(dashboardDimensions.height).toBeLessThan(isMobile ? 1900 : 1300);
  await testInfo.attach("dashboard-dimensions", {
    body: Buffer.from(JSON.stringify(dashboardDimensions)),
    contentType: "application/json",
  });
  await noPageOverflow(page);
  const recentActivity = page.locator(".recent-activity-row").first();
  const recentDescription = await recentActivity
    .locator(".activity-copy > b")
    .innerText();
  await recentActivity.click();
  const activityDialog = page.getByRole("dialog");
  await expect(
    activityDialog.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue(recentDescription);
  await activityDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(activityDialog).toHaveCount(0);
  await page
    .getByRole("link", { name: "Spending insights", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Spending analytics", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await navigate(page, "Accounts", isMobile);
  await expect(
    page.getByRole("heading", { name: "Accounts", exact: true }),
  ).toBeVisible();
  await page.locator("a.bank-card").filter({ hasText: BANK }).click();
  await expect(
    page.getByRole("heading", { name: BANK, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Calculated ledger balance", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Account name", { exact: true })
    .fill("Meridian Everyday E2E");
  await dialog
    .getByRole("button", { name: "Save account", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Meridian Everyday E2E", exact: true }),
  ).toBeVisible();
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});

test("expense creation/edit persists and increases spending exactly once; transfer does not", async ({
  page,
}) => {
  const baseline = await spending(page);
  const description = "E2E exact-decimal lunch";
  await addTransaction(page, { description, amount: "100.40" });
  const afterAdd = new Decimal(baseline).plus("100.40").toFixed(2);
  await expect.poll(() => spending(page)).toBe(afterAdd);
  await page.reload();
  await expect.poll(() => spending(page)).toBe(afterAdd);
  await page.goto("/transactions");
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill(description);
  await expect(
    page.getByRole("button", { name: description, exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: `Edit ${description}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("125.80");
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/dashboard");
  const afterEdit = new Decimal(baseline).plus("125.80").toFixed(2);
  await expect.poll(() => spending(page)).toBe(afterEdit);
  await addTransaction(page, {
    description: "E2E wallet funding",
    amount: "31.00",
    kind: "transfer",
    to: "Pocket Wallet",
  });
  await expect.poll(() => spending(page)).toBe(afterEdit);
  await page.reload();
  await expect.poll(() => spending(page)).toBe(afterEdit);
  await noPageOverflow(page);
});

test("a posted expense after the reported date updates the bank card and dashboard once", async ({
  page,
}) => {
  const bankId = await page.evaluate(
    ({ storageKey, bankName }) => {
      if (sessionStorage.getItem("finance-os:mode") !== "demo")
        throw new Error("This fixture requires an isolated demo workspace.");
      const workspace = JSON.parse(
        localStorage.getItem(storageKey)!,
      ) as WorkspaceData;
      const bank = workspace.accounts.find(
        (account) => account.name === bankName && account.active,
      );
      const snapshot = workspace.snapshots.find(
        (item) => item.accountId === bank?.id,
      );
      if (!bank || !snapshot)
        throw new Error("The synthetic bank snapshot fixture is required.");
      snapshot.asOf = "2026-10-08T08:00:00Z";
      snapshot.reportedBalance = "1000.00";
      // Seed movements are already included in this fixture's reported balance.
      for (const transaction of workspace.transactions)
        if (
          transaction.occurredOn &&
          (transaction.fromAccountId === bank.id ||
            transaction.toAccountId === bank.id) &&
          transaction.occurredOn > "2026-10-08"
        )
          transaction.occurredOn = "2026-10-08";
      localStorage.setItem(storageKey, JSON.stringify(workspace));
      return bank.id;
    },
    { storageKey: STORAGE_KEY, bankName: BANK },
  );
  const bankTotal = async () => {
    const value = await page
      .locator(".stats-grid .stat")
      .filter({ hasText: "Total bank balance" })
      .locator(":scope > strong")
      .innerText();
    return new Decimal(value.replace(/[^\d.-]/g, "")).toFixed(2);
  };
  const accountCard = () =>
    page.locator("a.bank-card").filter({ hasText: BANK });
  await page.reload();
  const baseline = await bankTotal();
  await page.goto("/accounts");
  await expect(accountCard().locator(":scope > strong")).toHaveText(
    "₹1,000.00",
  );
  await page.goto("/dashboard");
  await addTransaction(page, {
    description: "E2E expense after the reported balance",
    amount: "100.40",
  });
  const expectedTotal = new Decimal(baseline).minus("100.40").toFixed(2);
  await expect.poll(bankTotal).toBe(expectedTotal);
  await page.reload();
  await expect.poll(bankTotal).toBe(expectedTotal);
  await page.goto("/accounts");
  await expect(accountCard().locator(":scope > strong")).toHaveText("₹899.60");
  await accountCard().click();
  await expect(
    page.locator(".info-banner").filter({ hasText: "Updated balance" }),
  ).toContainText("₹899.60");
  await expect(
    page
      .locator(".three-stats .stat")
      .filter({ hasText: "Reported balance / outstanding" })
      .locator(":scope > strong"),
  ).toHaveText("₹1,000.00");

  await page.evaluate(
    ({ storageKey, bankId }) => {
      if (sessionStorage.getItem("finance-os:mode") !== "demo")
        throw new Error("This fixture requires an isolated demo workspace.");
      const workspace = JSON.parse(
        localStorage.getItem(storageKey)!,
      ) as WorkspaceData;
      const template = workspace.transactions.find(
        (transaction) =>
          transaction.description === "E2E expense after the reported balance",
      );
      if (!template || template.fromAccountId !== bankId)
        throw new Error("The synthetic posted expense must be present.");
      workspace.transactions.push(
        {
          ...template,
          id: "00000000-0000-4000-8000-000000009811",
          description: "E2E pending expense does not debit a balance",
          amount: "15.25",
          status: "pending_review",
        },
        {
          ...template,
          id: "00000000-0000-4000-8000-000000009812",
          description: "E2E voided expense does not debit a balance",
          amount: "29.75",
          status: "voided",
        },
      );
      localStorage.setItem(storageKey, JSON.stringify(workspace));
    },
    { storageKey: STORAGE_KEY, bankId },
  );
  await page.reload();
  await expect(
    page.locator(".info-banner").filter({ hasText: "Updated balance" }),
  ).toContainText("₹899.60");
  await page.goto("/accounts");
  await expect(accountCard().locator(":scope > strong")).toHaveText("₹899.60");
  await page.goto("/dashboard");
  await expect.poll(bankTotal).toBe(expectedTotal);
  await noPageOverflow(page);
});

test("manual pending expenses require explicit confirmation and voided edits stay voided", async ({
  page,
}) => {
  const baseline = await spending(page);
  const pendingId = "00000000-0000-4000-8000-000000009801";
  const voidedId = "00000000-0000-4000-8000-000000009802";
  const pendingDescription = "E2E manual pending confirmation";
  const voidedDescription = "E2E preserved voided expense";
  await page.evaluate(
    ({
      storageKey,
      pendingId,
      voidedId,
      pendingDescription,
      voidedDescription,
    }) => {
      if (sessionStorage.getItem("finance-os:mode") !== "demo")
        throw new Error("This fixture requires an isolated demo workspace.");
      const workspace = JSON.parse(
        localStorage.getItem(storageKey)!,
      ) as WorkspaceData;
      const template = workspace.transactions.find(
        (transaction) =>
          transaction.kind === "expense" && transaction.status === "posted",
      );
      const bank = workspace.accounts.find(
        (account) => account.name === "Meridian Everyday" && account.active,
      );
      if (!template || !bank)
        throw new Error("Synthetic expense and bank fixtures are required.");
      const common = {
        ...template,
        kind: "expense" as const,
        category: "Food",
        merchant: "Swiggy",
        fromAccountId: bank.id,
        toAccountId: null,
        externalPayer: null,
        externalReference: null,
        refundOfTransactionId: null,
        receiptDocumentId: null,
        sourceSystem: "manual",
        sourceObjectId: null,
        notes: "Synthetic review fixture",
      };
      workspace.transactions.push(
        {
          ...common,
          id: pendingId,
          description: pendingDescription,
          amount: "15.25",
          status: "pending_review",
          occurredOn: null,
        },
        {
          ...common,
          id: voidedId,
          description: voidedDescription,
          amount: "29.75",
          status: "voided",
          occurredOn: "2026-10-09",
        },
      );
      localStorage.setItem(storageKey, JSON.stringify(workspace));
    },
    {
      storageKey: STORAGE_KEY,
      pendingId,
      voidedId,
      pendingDescription,
      voidedDescription,
    },
  );
  await page.goto("/transactions");
  const storedTransaction = (id: string) =>
    page.evaluate(
      ({ storageKey, id }) =>
        (
          JSON.parse(localStorage.getItem(storageKey)!) as WorkspaceData
        ).transactions.find((transaction) => transaction.id === id),
      { storageKey: STORAGE_KEY, id },
    );
  const edit = async (description: string) => {
    await page
      .getByRole("textbox", { name: "Search transactions", exact: true })
      .fill(description);
    await page
      .getByRole("button", { name: `Edit ${description}`, exact: true })
      .click();
    return page.locator(".transaction-modal");
  };
  let dialog = await edit(pendingDescription);
  await dialog.getByLabel("Date", { exact: true }).fill("2026-10-09");
  await expect(
    dialog.getByRole("checkbox", {
      name: "I confirmed this payment and account",
      exact: true,
    }),
  ).not.toBeChecked();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await storedTransaction(pendingId))?.status)
    .toBe("pending_review");
  await page.goto("/dashboard");
  await expect.poll(() => spending(page)).toBe(baseline);

  await page.goto("/transactions");
  dialog = await edit(pendingDescription);
  await dialog
    .getByRole("checkbox", {
      name: "I confirmed this payment and account",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await storedTransaction(pendingId))?.status)
    .toBe("posted");

  dialog = await edit(voidedDescription);
  await expect(
    dialog.getByRole("checkbox", {
      name: "I confirmed this payment and account",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("32.50");
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await storedTransaction(voidedId))?.status)
    .toBe("voided");
  await expect
    .poll(async () => (await storedTransaction(voidedId))?.amount)
    .toBe("32.50");
  await page.reload();
  await expect
    .poll(async () => (await storedTransaction(pendingId))?.status)
    .toBe("posted");
  await expect
    .poll(async () => (await storedTransaction(voidedId))?.status)
    .toBe("voided");
  await page.goto("/dashboard");
  await expect
    .poll(() => spending(page))
    .toBe(new Decimal(baseline).plus("15.25").toFixed(2));
});

test("statement partial payment uses an existing valid payment and rejects mismatched accounts", async ({
  page,
}) => {
  await page.goto(`/bills/${BILL_ID}`);
  const remaining = () =>
    page
      .locator(".bill-detail-grid > div")
      .filter({ hasText: "Remaining bill" })
      .locator("strong");
  await expect(remaining()).toHaveText("₹8,800.00");
  await page
    .getByRole("button", { name: "Allocate payment", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Existing posted payment")
    .selectOption({ label: "Luma partial repayment · ₹1250.00 · 2026-10-05" });
  await dialog.getByLabel("Amount to apply · ₹").fill("100.00");
  await dialog
    .getByRole("button", { name: "Save payment allocation", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("this bill");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(remaining()).toHaveText("₹8,800.00");
  await addTransaction(page, {
    description: "E2E Aster statement payment",
    amount: "3000.00",
    kind: "bill_payment",
    to: "Aster Platinum",
  });
  await page
    .getByRole("button", { name: "Allocate payment", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Existing posted payment").selectOption({
    label: "E2E Aster statement payment · ₹3000.00 · 2026-10-09",
  });
  await dialog.getByLabel("Amount to apply · ₹").fill("1000.00");
  await dialog
    .getByRole("button", { name: "Save payment allocation", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(remaining()).toHaveText("₹7,800.00");
  await page.reload();
  await expect(remaining()).toHaveText("₹7,800.00");
  await expect(
    page
      .getByRole("heading", { name: "Statement overview" })
      .locator("..")
      .locator(".."),
  ).toContainText("partial");
});

test("filtered CSV export contains the ledger without extra rows", async ({
  page,
}) => {
  await page.goto("/transactions");
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill("Train ticket for a friend");
  await expect(
    page.getByRole("button", {
      name: "Train ticket for a friend",
      exact: true,
    }),
  ).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("transactions-2026-10.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain('"Train ticket for a friend"');
  expect(csv).toContain('"1849.60"');
  expect(csv).not.toContain("Monthly salary");
});

test("EMI schedule shows actual remaining allocations and future installments", async ({
  page,
}) => {
  await page.goto("/emi-calendar");
  await expect(
    page.getByRole("heading", { name: "EMI calendar", exact: true }),
  ).toBeVisible();
  const installment = page
    .locator(".record-row")
    .filter({ hasText: "Personal loan · #2" });
  await expect(installment).toContainText("₹7,300.00");
  await expect(installment).toContainText("partial");
  const future = page
    .locator(".record-row")
    .filter({ hasText: "Personal loan · #3" });
  await expect(future).toContainText("upcoming");
  await expect(future).toContainText("₹9,800.00");
  await noPageOverflow(page);
});

test("a confirmed external lender debit closes an installment without counting as spending", async ({
  page,
}) => {
  const baseline = await spending(page);
  await addTransaction(page, {
    description: "E2E Willow installment remainder",
    amount: "7300.00",
    kind: "bill_payment",
    externalLender: "Willow Finance",
  });
  await expect.poll(() => spending(page)).toBe(baseline);
  await page.goto("/emi-calendar");
  const installment = page
    .locator(".record-row")
    .filter({ hasText: "Personal loan · #2" });
  await installment
    .getByRole("button", { name: "Match payment", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Existing posted payment").selectOption({
    label: "E2E Willow installment remainder · ₹7300.00 · 2026-10-09",
  });
  await dialog.getByLabel("Amount to apply · ₹").fill("7300.00");
  await dialog
    .getByRole("button", { name: "Save payment allocation", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(installment).toContainText("₹0.00");
  await expect(installment.locator(".badge")).toHaveText("paid");
  await page.reload();
  await expect(installment.locator(".badge")).toHaveText("paid");
  await page.goto("/dashboard");
  await expect.poll(() => spending(page)).toBe(baseline);
});

test("CSV sample requires review, commits once, and repeat upload proposes zero new rows", async ({
  page,
}) => {
  const baseline = await spending(page);
  const transactionCount = () =>
    page.evaluate(
      (key) =>
        JSON.parse(localStorage.getItem(key)!).transactions.length as number,
      STORAGE_KEY,
    );
  const beforeCount = await transactionCount();
  await page.goto("/imports");
  await expect(
    page.getByRole("heading", { name: "Statement imports", exact: true }),
  ).toBeVisible();
  const input = page.getByLabel("Upload statement CSV", { exact: true });
  await input.setInputFiles(path.resolve("public/sample-statement.csv"));
  await expect(
    page.getByRole("heading", {
      name: "Review import candidates",
      exact: true,
    }),
  ).toBeVisible();
  const commit = page.getByRole("button", {
    name: "Import 4 selected rows",
    exact: true,
  });
  await expect(commit).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Select import row 2", exact: true }),
  ).toBeChecked();
  await expect.poll(transactionCount).toBe(beforeCount);
  await page
    .getByRole("checkbox", {
      name: "I have reviewed the selected rows and approve these ledger changes.",
      exact: true,
    })
    .check();
  await commit.click();
  await expect(
    page.getByRole("status").filter({ hasText: "4 rows imported." }),
  ).toBeVisible();
  await expect.poll(transactionCount).toBe(beforeCount + 4);
  await input.setInputFiles(path.resolve("public/sample-statement.csv"));
  await expect(
    page.getByText("sample-statement.csv · 4 rows · 4 existing matches", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import 0 selected rows", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Select import row 2", exact: true }),
  ).not.toBeChecked();
  await expect.poll(transactionCount).toBe(beforeCount + 4);
  await noPageOverflow(page);
  await page.goto("/dashboard");
  await expect
    .poll(() => spending(page))
    .toBe(new Decimal(baseline).plus("428.60").toFixed(2));
  await page.reload();
  await expect.poll(transactionCount).toBe(beforeCount + 4);
});

test("PDF uploads show the unsupported-format message without ledger changes", async ({
  page,
}) => {
  await page.goto("/imports");
  await page.getByLabel("Upload statement CSV", { exact: true }).setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nsynthetic fixture"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "PDF and image parsing are not available",
  );
  await expect(
    page.getByRole("heading", {
      name: "Review import candidates",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("in-app reminder toggles persist; external delivery stays disabled", async ({
  page,
}) => {
  await page.goto("/notifications");
  const reminder = page.getByRole("switch", {
    name: "Toggle Willow installment due tomorrow",
    exact: true,
  });
  await expect(reminder).toHaveAttribute("aria-checked", "true");
  await reminder.click();
  await expect(reminder).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(reminder).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByRole("switch", {
      name: "Toggle Aster statement reminder",
      exact: true,
    }),
  ).toBeDisabled();
  await noPageOverflow(page);
});
