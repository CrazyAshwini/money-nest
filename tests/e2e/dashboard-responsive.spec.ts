import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import type { Account, Transaction, WorkspaceData } from "../../src/lib/types";

const userId = "10000000-0000-4000-8000-000000000001";
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const cards = [
  ["Total bank balance details", "Bank balance details"],
  ["This month's spending details", "Spending details"],
  ["Credit cards details", "Credit card details"],
  ["Pay Later details", "Pay Later details"],
] as const;

type SyntheticFixture = {
  data: WorkspaceData;
  profile: {
    id: string;
    displayName: string;
    currency: string;
    timezone: string;
    createdAt: string;
  };
  unexpectedApis: string[];
};
const fixtures = new WeakMap<Page, SyntheticFixture>();
const browserErrors = new WeakMap<Page, string[]>();

test.use({ timezoneId: "Asia/Kolkata" });

function dashboardFixture(): SyntheticFixture {
  const account = (
    value: number,
    fields: Omit<Account, "id" | "userId" | "active">,
  ): Account => ({
    id: id(value),
    userId,
    active: true,
    ...fields,
  });
  const bank = account(101, {
    name: "Synthetic current account",
    institution: "QA Bank",
    kind: "bank",
    maskedSuffix: "9101",
  });
  const unreported = account(102, {
    name: "Synthetic unreported account",
    institution: "QA Bank",
    kind: "bank",
    maskedSuffix: "9102",
  });
  const credit = account(103, {
    name: "Synthetic secured card",
    institution: "QA Card",
    kind: "credit_card",
    maskedSuffix: "9103",
    creditLimit: "1000.00",
  });
  const unknownCard = account(104, {
    name: "Synthetic unknown card",
    institution: "QA Card",
    kind: "credit_card",
    maskedSuffix: "9104",
    creditLimit: null,
  });
  const payLater = account(105, {
    name: "Synthetic deferred provider",
    institution: "QA Deferred",
    kind: "pay_later",
    maskedSuffix: "9105",
    creditLimit: "500.00",
  });
  const transaction = (
    value: number,
    fields: Partial<Transaction>,
  ): Transaction => ({
    id: id(value),
    userId,
    amount: "100.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-10-05",
    description: "Synthetic posted groceries",
    merchant: "QA Grocer",
    fromAccountId: bank.id,
    toAccountId: null,
    category: "Groceries",
    ...fields,
  });
  const data: WorkspaceData = {
    accounts: [bank, unreported, credit, unknownCard, payLater],
    snapshots: [
      {
        id: id(201),
        userId,
        accountId: bank.id,
        asOf: "2026-10-10",
        reportedBalance: "1000.00",
        source: "user_report",
        verifiedByUser: true,
      },
      {
        id: id(202),
        userId,
        accountId: credit.id,
        asOf: "2026-10-09",
        reportedOutstanding: "600.00",
        reportedUtilized: "600.00",
        nextStatementDate: "2026-10-25",
        source: "user_report",
        verifiedByUser: true,
      },
    ],
    transactions: [
      transaction(301, {}),
      transaction(302, {
        amount: "250.00",
        occurredOn: "2026-10-06",
        description: "Synthetic posted supplies",
        merchant: "QA Supplies",
        category: "Shopping",
        fromAccountId: credit.id,
      }),
      transaction(303, {
        amount: "125.00",
        occurredOn: "2026-09-22",
        description: "Synthetic September food",
        merchant: "QA Cafe",
        category: "Food",
      }),
      transaction(304, {
        amount: "40.00",
        kind: "refund",
        occurredOn: "2026-10-08",
        description: "Synthetic matched refund",
        merchant: null,
        fromAccountId: null,
        toAccountId: bank.id,
        refundOfTransactionId: id(301),
      }),
      transaction(305, {
        amount: "200.00",
        kind: "transfer",
        occurredOn: "2026-10-09",
        description: "Synthetic internal transfer",
        merchant: null,
        toAccountId: unreported.id,
      }),
      transaction(306, {
        amount: "75.00",
        kind: "bill_payment",
        occurredOn: "2026-10-10",
        description: "Synthetic deferred repayment",
        merchant: null,
        toAccountId: payLater.id,
      }),
      transaction(307, {
        amount: "999.00",
        status: "pending_review",
        occurredOn: "2026-10-11",
        description: "Synthetic pending expense",
        merchant: "QA Pending",
      }),
      transaction(308, {
        amount: "400.00",
        status: "voided",
        occurredOn: "2026-10-12",
        description: "Synthetic voided expense",
        merchant: "QA Voided",
      }),
    ],
    bills: [
      {
        id: id(401),
        userId,
        accountId: credit.id,
        statementAmount: "300.00",
        statementDate: "2026-10-01",
        dueDate: "2026-10-20",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      },
      {
        id: id(402),
        userId,
        accountId: payLater.id,
        statementAmount: "75.00",
        statementDate: "2026-10-05",
        dueDate: "2026-10-15",
        periodStart: "2026-10-05",
        periodEnd: "2026-10-05",
      },
    ],
    allocations: [],
    fixedDeposits: [
      {
        id: id(501),
        userId,
        name: "Synthetic collateral deposit",
        institution: "QA Bank",
        maskedSuffix: "9501",
        principal: "5000.00",
        openingDate: "2026-09-01",
        maturityDate: "2027-09-01",
        payoutMethod: "at maturity",
        maturityInstruction: "unconfirmed",
        pledged: true,
        backingAccountId: credit.id,
        payoutAccountId: bank.id,
      },
    ],
    loans: [],
    emis: [],
    emiAllocations: [],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
  };
  return {
    data,
    profile: {
      id: userId,
      displayName: "Alex Synthetic",
      currency: "INR",
      timezone: "Asia/Kolkata",
      createdAt: "2026-10-01T00:00:00Z",
    },
    unexpectedApis: [],
  };
}

async function mockWorkspace(
  context: BrowserContext,
  baseURL: string,
  fixture: SyntheticFixture,
) {
  const origin = new URL(baseURL).origin;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/workspace" && request.method() === "GET") {
      return route.fulfill({
        status: 200,
        json: {
          configured: true,
          authenticated: true,
          backend: "local",
          userId,
          profile: fixture.profile,
          workspace: fixture.data,
        },
      });
    }
    if (url.pathname.startsWith("/api/")) {
      fixture.unexpectedApis.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 401,
        json: { error: "Only mocked synthetic workspace reads are allowed." },
      });
    }
    return route.continue();
  });
}

async function ready(page: Page) {
  await expect(
    page.getByRole("heading", {
      name: /^Good (morning|afternoon|evening), Alex$/,
      level: 1,
    }),
  ).toBeVisible();
  await page.getByLabel("Selected month", { exact: true }).fill("2026-10");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function noOverflow(page: Page, surface?: Locator) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  if (surface) {
    const geometry = await surface.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  }
}

const numericAmount = (value: string) => Number(value.replace(/[^\d.-]/g, ""));

test.beforeEach(async ({ context, page, baseURL }) => {
  if (!baseURL)
    throw new Error("Dashboard tests need an isolated local baseURL.");
  const fixture = dashboardFixture();
  fixtures.set(page, fixture);
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-14T06:30:00Z") });
  await mockWorkspace(context, baseURL, fixture);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
  expect(fixtures.get(page)!.unexpectedApis).toEqual([]);
});

for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
  test(`${width}px dashboard keeps summaries and navigation responsive`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width <= 760 ? 844 : 1000 });
    await page.goto("/dashboard");
    await ready(page);
    await noOverflow(page);
    const overviewHeading = (await page
      .locator(".dashboard-overview-heading")
      .boundingBox())!;
    const monthPicker = (await page
      .locator(".dashboard-overview-heading .month-picker")
      .boundingBox())!;
    expect(
      Math.abs(
        monthPicker.x +
          monthPicker.width -
          overviewHeading.x -
          overviewHeading.width,
      ),
    ).toBeLessThan(2);
    await expect(page.locator(".financial-summary-card")).toHaveCount(4);
    await expect(page.locator(".dashboard-card-bank > strong")).toHaveText(
      "₹1,000.00",
    );
    await expect(page.locator(".dashboard-card-spending > strong")).toHaveText(
      "₹350.00",
    );
    await expect(page.locator(".dashboard-card-spending")).toContainText(
      "2 posted expenses",
    );
    await expect(page.locator(".dashboard-card-bank")).toContainText(
      "1/2 balances known",
    );
    await expect(page.locator(".dashboard-card-credit")).toContainText(
      "Overall usage unknown",
    );
    await expect(page.locator(".dashboard-card-paylater")).toContainText(
      "At least ₹75.00",
    );
    await expect(page.locator(".quick-actions-bar")).toHaveCount(0);
    await expect(page.locator(".dashboard-topbar .avatar")).toHaveCount(0);
    await expect(page.locator(".dashboard-topbar .mobile-menu")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Welcome back/, { exact: false })).toHaveCount(
      0,
    );
    await expect(
      page
        .locator(".dashboard-topbar")
        .getByRole("link", { name: "Search transactions", exact: true }),
    ).toHaveAttribute("href", "/transactions");
    await expect(
      page
        .locator(".dashboard-topbar")
        .getByRole("link", { name: "Notifications", exact: true }),
    ).toHaveAttribute("href", "/notifications");
    const bot = page.getByRole("button", { name: "Open NestBot", exact: true });
    const botBox = (await bot.boundingBox())!;
    expect(botBox.width).toBeGreaterThanOrEqual(44);
    expect(botBox.height).toBeGreaterThanOrEqual(44);
    const navigation = page.getByRole("navigation", {
      name: "Mobile navigation",
      exact: true,
    });
    if (width <= 760) {
      await expect(navigation).toBeVisible();
      await expect(navigation.locator(".bottom-bar-item")).toHaveText([
        "Home",
        "Accounts",
        "Add",
        "Analytics",
        "Profile",
      ]);
      await expect(page.locator(".dashboard-header-add")).toBeHidden();
      await expect(page.locator(".dashboard-mobile-brand")).toBeVisible();
      const positions = await navigation
        .locator(".bottom-bar-item")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              width: rect.width,
              center: rect.x + rect.width / 2,
            };
          }),
        );
      expect(
        Math.max(...positions.map((position) => position.width)) -
          Math.min(...positions.map((position) => position.width)),
      ).toBeLessThan(2);
      expect(Math.abs(positions[2].center - width / 2)).toBeLessThan(2);
      for (const item of await navigation.locator(".bottom-bar-item").all()) {
        expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.locator(".page-footer").scrollIntoViewIfNeeded();
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const footer = (await page.locator(".page-footer").boundingBox())!;
      const bar = (await navigation.boundingBox())!;
      expect(footer.y + footer.height).toBeLessThanOrEqual(bar.y + 1);
    } else {
      await expect(navigation).toBeHidden();
      await expect(page.locator(".dashboard-header-add")).toBeVisible();
      await expect(page.locator(".desktop-sidebar")).toBeVisible();
      await expect(
        page
          .locator(".desktop-sidebar")
          .getByRole("link", { name: "Transactions", exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("heading", { name: "Financial overview", exact: true })
      .click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${width}px-viewport.png`),
    });
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${width}px.png`),
      fullPage: true,
    });
  });
}

for (const width of [320, 1440]) {
  test(`${width}px all card surfaces and keyboard open accessible details`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width <= 760 ? 844 : 1000 });
    await page.goto("/dashboard");
    await ready(page);
    for (const [buttonName, dialogName] of cards) {
      const card = page.getByRole("button", {
        name: buttonName,
        exact: true,
        includeHidden: true,
      });
      await expect(card).toHaveAttribute("aria-haspopup", "dialog");
      await expect(card).toHaveAttribute("aria-expanded", "false");
      const cardAmount = numericAmount(
        await card.locator(":scope > strong").innerText(),
      );
      await card.click({ position: { x: 12, y: 12 } });
      const dialog = page.getByRole("dialog", {
        name: dialogName,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(card).toHaveAttribute("aria-expanded", "true");
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(
        numericAmount(
          await dialog.locator(".financial-details-total > strong").innerText(),
        ),
      ).toBe(cardAmount);
      await noOverflow(page, dialog);
      const dialogBox = (await dialog.boundingBox())!;
      expect(dialogBox.x).toBeGreaterThanOrEqual(-1);
      expect(dialogBox.y).toBeGreaterThanOrEqual(-1);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 1);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(
        page.viewportSize()!.height + 1,
      );
      if (width <= 760) {
        expect(Math.abs(dialogBox.y + dialogBox.height - 844)).toBeLessThan(2);
      } else {
        expect(
          Math.abs(dialogBox.x + dialogBox.width / 2 - width / 2),
        ).toBeLessThan(2);
      }
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      await page.keyboard.press("Shift+Tab");
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
      await dialog
        .getByRole("button", { name: "Close financial details", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(card).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(card).toBeFocused();
      await expect(card).toHaveAttribute("aria-expanded", "false");
    }
  });

  test(`${width}px spending preserves gross totals and selected period through View all`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width <= 760 ? 844 : 1000 });
    await page.goto("/dashboard");
    await ready(page);
    const spending = page.getByRole("button", {
      name: "This month's spending details",
      exact: true,
    });
    await spending.click();
    const dialog = page.getByRole("dialog", {
      name: "Spending details",
      exact: true,
    });
    await expect(
      dialog.locator(".financial-details-total > strong"),
    ).toHaveText("₹350.00");
    await expect(dialog.locator(".financial-details-total")).toContainText(
      "2 posted expenses",
    );
    await expect(
      dialog.locator(".financial-details-transactions > li"),
    ).toHaveCount(2);
    await expect(dialog.locator(".financial-details-refunds")).toContainText(
      "₹40.00",
    );
    await expect(dialog.locator(".financial-details-refunds")).toContainText(
      "₹310.00",
    );
    await expect(
      dialog.locator(".financial-details-transactions"),
    ).not.toContainText(/pending|voided|repayment|transfer|September/i);
    const categories = dialog.locator(".financial-details-categories > li");
    await expect(categories).toHaveCount(2);
    await expect(categories.first()).toContainText("Shopping");
    await page.keyboard.press("Escape");
    await page.getByLabel("Selected month", { exact: true }).fill("2026-09");
    await expect(page.locator(".dashboard-card-spending > strong")).toHaveText(
      "₹125.00",
    );
    await expect(page.locator(".dashboard-card-spending")).toContainText(
      "September 2026",
    );
    await expect(page.locator(".dashboard-card-bank > strong")).toHaveText(
      "₹1,000.00",
    );
    await spending.click();
    await expect(
      dialog.locator(".financial-details-total > strong"),
    ).toHaveText("₹125.00");
    await expect(
      dialog.locator(".financial-details-transactions > li"),
    ).toHaveCount(1);
    await expect(dialog).toContainText("Synthetic September food");
    await dialog
      .getByRole("link", { name: "View all transactions", exact: true })
      .click();
    await expect(page).toHaveURL(/\/transactions\?kind=expense$/);
    await expect(
      page.getByLabel("Selected month", { exact: true }),
    ).toHaveValue("2026-09");
    await expect(
      page.getByLabel("Transaction type", { exact: true }),
    ).toHaveValue("expense");
    await expect(page.locator(".filter-row > span")).toHaveText(
      "1 transactions",
    );
    await expect(
      page.getByText("Synthetic September food", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic posted groceries", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`${width}px primary Add and truthful NestBot use established dialogs`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width <= 760 ? 844 : 1000 });
    await page.goto("/dashboard");
    await ready(page);
    const add =
      width <= 760
        ? page
            .getByRole("navigation", { name: "Mobile navigation", exact: true })
            .getByRole("button", { name: "Add transaction", exact: true })
        : page.locator(".dashboard-header-add");
    await add.click();
    const expense = page.getByRole("dialog", {
      name: "Add New Expense",
      exact: true,
    });
    await expect(expense).toBeVisible();
    await expect(
      expense.getByLabel("Amount · ₹", { exact: true }),
    ).toBeVisible();
    await expect(
      expense.getByRole("button", { name: "Save transaction", exact: true }),
    ).toBeVisible();
    await expense.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(expense).toHaveCount(0);
    const bot = page.getByRole("button", { name: "Open NestBot", exact: true });
    await bot.click();
    const assistant = page.getByRole("dialog", {
      name: "NestBot",
      exact: true,
    });
    await expect(assistant).toBeVisible();
    await expect(assistant).toContainText("Assistant unavailable");
    await expect(assistant).toContainText(
      "does not currently have a connected chat assistant",
    );
    await expect(assistant.getByRole("textbox")).toHaveCount(0);
    await noOverflow(page, assistant);
    await page.keyboard.press("Tab");
    expect(
      await assistant.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(assistant).toHaveCount(0);
    await expect(bot).toBeFocused();
  });
}

test("details distinguish unavailable balances, partial debt exposure and stored timestamps", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await ready(page);
  await page
    .getByRole("button", { name: "Total bank balance details", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Bank balance details",
    exact: true,
  });
  await expect(dialog.locator(".financial-details-record")).toHaveCount(2);
  await expect(dialog).toContainText("The total excludes unreported accounts");
  await expect(dialog).toContainText(
    "This is not a month-end balance for October 2026",
  );
  const unknownBank = dialog
    .locator(".financial-details-record")
    .filter({ hasText: "Synthetic unreported account" });
  await expect(unknownBank).toContainText("Not reported");
  await expect(unknownBank).toContainText("Not available");
  await expect(
    dialog
      .locator(".financial-details-record")
      .filter({ hasText: "Synthetic current account" }),
  ).toContainText("10 Oct 2026");
  await expect(
    dialog.getByText("Synthetic collateral deposit", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Credit cards details", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Credit card details",
    exact: true,
  });
  await expect(dialog).toContainText("Known usage · partial coverage");
  await expect(dialog).toContainText(
    "FD backed · Synthetic collateral deposit",
  );
  await expect(
    dialog
      .locator(".financial-details-record")
      .filter({ hasText: "Synthetic unknown card" }),
  ).toContainText("Usage unknown");
  await expect(
    dialog
      .locator(".financial-details-record")
      .filter({ hasText: "Synthetic unknown card" }),
  ).toContainText("Not set");
  await expect(dialog.locator(".financial-details-aggregate")).toContainText(
    "Not available",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Pay Later details", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Pay Later details", exact: true });
  await expect(dialog.locator(".financial-details-total > strong")).toHaveText(
    "At least ₹75.00",
  );
  await expect(dialog).toContainText("Known unpaid bills only");
  await expect(dialog.locator(".financial-details-record")).toContainText(
    "Not available",
  );
  await expect(dialog).toContainText("Synthetic deferred repayment");
  await expect(
    dialog.getByRole("link", {
      name: "View bills & payment history",
      exact: true,
    }),
  ).toHaveAttribute("href", "/bills");
});

test("greeting prefers account time zone, refreshes at boundaries and falls back safely", async ({
  page,
}) => {
  const fixture = fixtures.get(page)!;
  fixture.profile.timezone = "Pacific/Honolulu";
  await page.goto("/dashboard");
  const greeting = page.getByRole("heading", { level: 1 });
  await expect(greeting).toHaveText("Good evening, Alex");
  fixture.profile.timezone = "UTC";
  await page.reload();
  await expect(greeting).toHaveText("Good morning, Alex");
  await page.clock.setSystemTime(new Date("2026-10-14T11:59:59Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(greeting).toHaveText("Good morning, Alex");
  await page.clock.runFor(1000);
  await expect(greeting).toHaveText("Good afternoon, Alex");
  await page.clock.setSystemTime(new Date("2026-10-14T16:59:59Z"));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(greeting).toHaveText("Good afternoon, Alex");
  await page.clock.runFor(1000);
  await expect(greeting).toHaveText("Good evening, Alex");
  fixture.profile.timezone = "Invalid/Zone";
  fixture.profile.displayName = " ";
  await page.clock.setSystemTime(new Date("2026-10-14T06:30:00Z"));
  await page.reload();
  await expect(greeting).toHaveText("Good afternoon, there");
});

for (const width of [320, 1440]) {
  test(`${width}px backdrop dismisses details and restores background scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await ready(page);
    const initialOverflow = await page.evaluate(
      () => document.body.style.overflow,
    );
    const card = page.getByRole("button", {
      name: "This month's spending details",
      exact: true,
    });
    await card.click();
    const dialog = page.getByRole("dialog", {
      name: "Spending details",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .toBe("hidden");
    await page
      .locator(".financial-details-overlay")
      .click({ position: { x: 4, y: 4 } });
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe(initialOverflow);
  });
}

test("empty workspace keeps unknown balances explicit and one primary Add action", async ({
  page,
}) => {
  const fixture = fixtures.get(page)!;
  for (const key of Object.keys(fixture.data) as (keyof WorkspaceData)[])
    fixture.data[key] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await ready(page);
  for (const section of ["bank", "credit", "paylater"]) {
    await expect(
      page.locator(`.dashboard-card-${section} > strong`),
    ).toHaveText("Not reported");
  }
  await expect(page.locator(".dashboard-card-spending > strong")).toHaveText(
    "₹0.00",
  );
  await expect(
    page.getByRole("button", { name: "Add transaction", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Add your first record", exact: true }),
  ).toHaveCount(0);
  for (const [buttonName, dialogName] of cards) {
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/No (active|posted)/);
    await page.keyboard.press("Escape");
  }
});

test("mixed bank reports use the calculation cutoff and announce partial coverage", async ({
  page,
}) => {
  const fixture = fixtures.get(page)!;
  fixture.data.accounts.push({
    ...fixture.data.accounts[1],
    id: id(999),
    name: "Synthetic missing third bank",
  });
  fixture.data.snapshots.push({
    id: id(998),
    userId,
    accountId: id(102),
    asOf: "2026-10-12",
    reportedBalance: "200.00",
    source: "user_report",
    verifiedByUser: true,
  });
  fixture.data.transactions.push({
    ...fixture.data.transactions[0],
    id: id(997),
    fromAccountId: id(102),
    occurredOn: "2026-10-13",
    amount: "25.00",
    description: "Synthetic movement after report",
  });
  await page.goto("/dashboard");
  await ready(page);
  const bank = page.getByRole("button", {
    name: "Total bank balance details",
    exact: true,
  });
  await expect(bank).toHaveAccessibleDescription(
    /2\/3 balances known · Partial coverage · Calculated through 14 Oct/,
  );
  await expect(bank.locator(":scope > strong")).toHaveText("₹1,175.00");
  await bank.click();
  const dialog = page.getByRole("dialog", {
    name: "Bank balance details",
    exact: true,
  });
  await expect(dialog).toContainText("10 Oct 2026");
  await expect(dialog).toContainText("14 Oct 2026");
});
