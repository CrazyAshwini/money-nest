import { test, expect, type Locator, type Page } from "@playwright/test";
import { createDemoData, DEMO_USER_ID } from "../../src/lib/seed";
import type {
  Account,
  AccountSnapshot,
  WorkspaceData,
} from "../../src/lib/types";

const STORAGE_KEY = "finance-os:fictional-demo:v1";
const syntheticId = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const browserErrors = new WeakMap<Page, string[]>();

function accountFixture(): WorkspaceData {
  const data = createDemoData();
  const appendAccount = (
    value: number,
    account: Omit<Account, "id" | "userId">,
  ) => {
    const result = { id: syntheticId(value), userId: DEMO_USER_ID, ...account };
    data.accounts.push(result);
    return result;
  };
  const extraBanks = [
    appendAccount(6101, {
      name: "QA Household Savings Account",
      institution: "Synthetic Bank",
      kind: "bank",
      maskedSuffix: "8101",
      openingBalance: "15000.00",
      openingBalanceDate: "2026-10-01",
      active: true,
    }),
    appendAccount(6102, {
      name: "QA International Salary Account",
      institution: "Synthetic Bank",
      kind: "bank",
      maskedSuffix: "8102",
      openingBalance: "17000.00",
      openingBalanceDate: "2026-10-01",
      active: true,
    }),
  ];
  const snapshot = (
    account: Account,
    value: number,
    fields: Partial<AccountSnapshot>,
  ) => {
    data.snapshots.push({
      id: syntheticId(value),
      userId: DEMO_USER_ID,
      accountId: account.id,
      asOf: "2026-10-09",
      source: "user_report",
      verifiedByUser: true,
      ...fields,
    });
  };
  extraBanks.forEach((account, index) =>
    snapshot(account, 7101 + index, {
      reportedBalance: index === 0 ? "15000.00" : "17000.00",
    }),
  );

  const extraCards = [
    appendAccount(6201, {
      name: "QA Over Limit Card",
      institution: "Synthetic Card",
      kind: "credit_card",
      maskedSuffix: "8201",
      creditLimit: "10000.00",
      active: true,
    }),
    appendAccount(6202, {
      name: "QA Missing Limit Card",
      institution: "Synthetic Card",
      kind: "credit_card",
      maskedSuffix: "8202",
      creditLimit: null,
      active: true,
    }),
    appendAccount(6203, {
      name: "QA Unreported Card",
      institution: "Synthetic Card",
      kind: "credit_card",
      maskedSuffix: "8203",
      creditLimit: "10000.00",
      active: true,
    }),
  ];
  const cards = data.accounts.filter(
    (account) => account.kind === "credit_card",
  );
  cards.slice(0, 3).forEach((account) => {
    account.creditLimit = "10000.00";
  });
  data.snapshots = data.snapshots.filter(
    (report) => !cards.some((account) => account.id === report.accountId),
  );
  ["2990.00", "3000.00", "7000.00"].forEach((used, index) =>
    snapshot(cards[index], 7201 + index, {
      reportedUtilized: used,
      reportedOutstanding: used,
    }),
  );
  snapshot(extraCards[0], 7204, {
    reportedUtilized: "12500.00",
    reportedOutstanding: "12500.00",
  });
  snapshot(extraCards[1], 7205, { reportedOutstanding: "2000.00" });

  const originalPayLater = data.accounts.find(
    (account) => account.kind === "pay_later",
  )!;
  originalPayLater.creditLimit = "10000.00";
  data.snapshots = data.snapshots.filter(
    (report) => report.accountId !== originalPayLater.id,
  );
  snapshot(originalPayLater, 7300, {
    reportedUtilized: "3000.00",
    reportedOutstanding: "3000.00",
  });
  const extraPayLater = appendAccount(6301, {
    name: "QA Second Pay Later",
    institution: "Synthetic Pay Later",
    kind: "pay_later",
    maskedSuffix: "8301",
    creditLimit: "10000.00",
    active: true,
  });
  snapshot(extraPayLater, 7301, { reportedOutstanding: "7000.00" });
  appendAccount(6401, {
    name: "QA Inactive Bank",
    institution: "Synthetic Bank",
    kind: "bank",
    maskedSuffix: "8401",
    active: false,
  });
  appendAccount(6402, {
    name: "QA Inactive Card",
    institution: "Synthetic Card",
    kind: "credit_card",
    maskedSuffix: "8402",
    creditLimit: "10000.00",
    active: false,
  });
  return data;
}

const kpi = (page: Page, title: string) =>
  page.locator(".stats-grid .stat").filter({ hasText: title });
const accountRow = (card: Locator, name: string) =>
  card.locator(".stat-account-row").filter({ hasText: name });

async function settleDashboard(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function expandAccounts(card: Locator) {
  const breakdown = card.locator(".account-breakdown");
  await expect(breakdown).not.toHaveAttribute("open", "");
  await breakdown.locator(":scope > summary").click();
  await expect(breakdown).toHaveAttribute("open", "");
}

async function expandAllAccounts(page: Page) {
  for (const title of [
    "Total bank balance",
    "Credit card usage",
    "Pay Later usage",
  ]) {
    await expandAccounts(kpi(page, title));
  }
}

async function noPageOverflow(page: Page) {
  const expectedWidth = page.viewportSize()!.width;
  const dimensions = await page.evaluate(() => ({
    inner: innerWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.inner).toBe(expectedWidth);
  expect(dimensions.client).toBe(expectedWidth);
  expect(dimensions.scroll).toBeLessThanOrEqual(expectedWidth + 1);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`Uncaught: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`Console: ${message.text()}`);
  });
  await page.addInitScript(
    ({ data, storageKey }) => {
      sessionStorage.setItem("finance-os:mode", "demo");
      // Each context receives only synthetic records, independently of user data.
      if (!localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, JSON.stringify(data));
      }
    },
    { data: accountFixture(), storageKey: STORAGE_KEY },
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

test("compact summary hides account details until expanded and retains every active account", async ({
  page,
  isMobile,
}) => {
  await settleDashboard(page);
  await expect(page.locator(".stats-grid .stat")).toHaveCount(4);
  await expect(page.locator(".account-breakdown")).toHaveCount(3);
  await expect(page.locator(".account-breakdown[open]")).toHaveCount(0);
  await expect(page.locator(".stat-account-row").first()).not.toBeVisible();
  for (const title of ["Credit card usage", "Pay Later usage"]) {
    const card = kpi(page, title);
    await expect(card.locator(".stat-limit-total")).toBeVisible();
    await expect(
      card.locator(".stat-credit-summary > .usage-level"),
    ).toBeVisible();
    await expect(
      card.locator(".stat-credit-summary > .usage-meter"),
    ).toBeVisible();
  }
  await expect(page.locator(".dashboard-bank-grid, .credit-grid")).toHaveCount(
    0,
  );
  await expect(page.locator(".recharts-surface")).toHaveCount(0);
  const pageHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  expect(pageHeight).toBeLessThan(isMobile ? 1900 : 1300);
  await noPageOverflow(page);
  const data = accountFixture();
  const sections = [
    { card: kpi(page, "Total bank balance"), kind: "bank" },
    { card: kpi(page, "Credit card usage"), kind: "credit_card" },
    { card: kpi(page, "Pay Later usage"), kind: "pay_later" },
  ];
  for (const { card, kind } of sections) {
    await expandAccounts(card);
    const accounts = data.accounts.filter(
      (account) => account.active && account.kind === kind,
    );
    await expect(card.locator(".stat-account-row")).toHaveCount(
      accounts.length,
    );
    for (const account of accounts) {
      const row = accountRow(card, account.name);
      await expect(row).toBeVisible();
      await expect(row).toContainText(account.maskedSuffix);
      await expect(row).toHaveAttribute("href", `/accounts/${account.id}`);
    }
  }
  await expect(page.getByText("QA Inactive Bank", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("QA Inactive Card", { exact: true })).toHaveCount(
    0,
  );

  await accountRow(
    kpi(page, "Total bank balance"),
    "QA International Salary Account",
  ).click();
  await expect(
    page.getByRole("heading", {
      name: "QA International Salary Account",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/accounts");
  await expect(
    page.getByRole("heading", { name: "Accounts", exact: true }),
  ).toBeVisible();
  for (const account of data.accounts.filter((item) => item.active)) {
    await expect(
      page.locator(".account-page-grid a").filter({ hasText: account.name }),
    ).toBeVisible();
  }
});

test("credit and Pay Later percentages use the correct bands and preserve unknown coverage", async ({
  page,
}) => {
  await expandAllAccounts(page);
  const credit = kpi(page, "Credit card usage");
  const samples = [
    {
      name: "Aster Platinum",
      percentage: /29\.9%/,
      band: "smart",
      label: "Smart use",
    },
    {
      name: "Grove Rewards",
      percentage: /30(?:\.0)?%/,
      band: "medium",
      label: "Medium use",
    },
    {
      name: "Harbor Secured",
      percentage: /70(?:\.0)?%/,
      band: "high",
      label: "High use",
    },
    {
      name: "QA Over Limit Card",
      percentage: /125(?:\.0)?%/,
      band: "high",
      label: "High use",
    },
  ];
  for (const sample of samples) {
    const row = accountRow(credit, sample.name);
    await expect(row).toContainText(sample.percentage);
    await expect(row).toContainText(/₹10,000(?:\.00)?/);
    await expect(row.locator(".usage-status")).toHaveAttribute(
      "data-band",
      sample.band,
    );
    await expect(row.locator(".usage-status")).toContainText(sample.label);
    await expect(row.locator(".usage-meter")).toHaveAttribute(
      "data-band",
      sample.band,
    );
  }
  const actualColors = await Promise.all(
    samples.slice(0, 3).map((sample) =>
      accountRow(credit, sample.name)
        .locator(".usage-status")
        .evaluate((badge) => getComputedStyle(badge).color),
    ),
  );
  expect(new Set(actualColors).size).toBe(3);
  for (const sample of samples.slice(0, 3)) {
    const row = accountRow(credit, sample.name);
    const badgeColor = await row
      .locator(".usage-status")
      .evaluate((badge) => getComputedStyle(badge).color);
    const barColor = await row
      .locator(".usage-meter > span")
      .evaluate((bar) => getComputedStyle(bar).backgroundColor);
    expect(barColor).toBe(badgeColor);
  }
  const overLimitMeter = accountRow(credit, "QA Over Limit Card").locator(
    ".usage-meter > span",
  );
  await expect(overLimitMeter).toHaveAttribute("style", /width:\s*100%/);
  await expect(
    accountRow(credit, "QA Over Limit Card").getByRole("meter"),
  ).toHaveAttribute("aria-valuetext", /125% used/);
  for (const name of ["QA Missing Limit Card", "QA Unreported Card"]) {
    const row = accountRow(credit, name);
    await expect(row.locator(".usage-status")).toHaveAttribute(
      "data-band",
      "unknown",
    );
    await expect(row).not.toContainText(/\b0(?:\.0)?%/);
  }
  await expect(accountRow(credit, "QA Missing Limit Card")).toContainText(
    /limit (?:unknown|not set)/i,
  );
  await expect(accountRow(credit, "QA Unreported Card")).toContainText(
    /₹10,000(?:\.00)?/,
  );
  await expect(credit.locator(".usage-status").first()).toHaveAttribute(
    "data-band",
    "unknown",
  );
  const payLaterCard = kpi(page, "Pay Later usage");
  await expect(payLaterCard.locator(":scope > strong")).toHaveText(
    "₹10,000.00",
  );
  await expect(payLaterCard.locator(".stat-limit-total")).toContainText(
    "₹20,000",
  );
  await expect(
    payLaterCard.locator(".stat-credit-summary > .usage-level"),
  ).toContainText("50% used");
  await expect(payLaterCard.locator(".usage-status").first()).toHaveAttribute(
    "data-band",
    "medium",
  );
  const payLater = accountRow(payLaterCard, "QA Second Pay Later");
  await expect(payLater).toContainText(/70(?:\.0)?%/);
  await expect(payLater).toContainText(/₹10,000(?:\.00)?/);
  await expect(payLater.locator(".usage-status")).toHaveAttribute(
    "data-band",
    "high",
  );
});

test("all account rows remain usable without page overflow on desktop and narrow mobile", async ({
  page,
  isMobile,
}, testInfo) => {
  await settleDashboard(page);
  await noPageOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("dashboard-compact.png"),
    fullPage: true,
  });
  await expandAllAccounts(page);
  await noPageOverflow(page);
  if (isMobile) {
    for (const width of [393, 360]) {
      await page.setViewportSize({ width, height: 851 });
      await settleDashboard(page);
      await noPageOverflow(page);
      await expect(
        accountRow(
          kpi(page, "Total bank balance"),
          "QA International Salary Account",
        ),
      ).toBeVisible();
      await expect(
        accountRow(kpi(page, "Credit card usage"), "QA Unreported Card"),
      ).toBeVisible();
      await expect(
        accountRow(kpi(page, "Pay Later usage"), "QA Second Pay Later"),
      ).toBeVisible();
    }
  }
  await page.screenshot({
    path: testInfo.outputPath("account-summary-expanded.png"),
    fullPage: true,
  });
  await noPageOverflow(page);
});
