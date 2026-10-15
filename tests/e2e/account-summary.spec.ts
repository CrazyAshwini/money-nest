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
  // Radix hides background cards from the accessibility tree while details are open.
  page.getByRole("button", {
    name: `${title} details`,
    exact: true,
    includeHidden: true,
  });
const accountRow = (dialog: Locator, name: string) =>
  dialog.locator(".financial-details-record").filter({ hasText: name });
const valueFor = (container: Locator, label: string) =>
  container
    .locator(".financial-details-values > div")
    .filter({ has: container.page().getByText(label, { exact: true }) })
    .locator("dd");

async function settleDashboard(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function openDetails(page: Page, title: string, dialogTitle: string) {
  const card = kpi(page, title);
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await card.click();
  const dialog = page.getByRole("dialog", { name: dialogTitle, exact: true });
  await expect(dialog).toBeVisible();
  await expect(card).toHaveAttribute("aria-expanded", "true");
  return dialog;
}

async function closeDetails(page: Page, dialog: Locator, title: string) {
  await dialog.getByRole("button", { name: "Close financial details" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(kpi(page, title)).toBeFocused();
  await expect(kpi(page, title)).toHaveAttribute("aria-expanded", "false");
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
    page.getByRole("heading", { name: "Financial overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-strip")).toContainText("Fictional data");
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("compact cards open details for every active account and retain account navigation", async ({
  page,
  isMobile,
}) => {
  await settleDashboard(page);
  await expect(page.locator(".financial-summary-card")).toHaveCount(4);
  await expect(page.locator(".account-breakdown")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".financial-details-record")).toHaveCount(0);
  for (const title of ["Credit cards", "Pay Later"]) {
    await expect(
      kpi(page, title).locator(".financial-usage-label"),
    ).toBeVisible();
    await expect(kpi(page, title).locator(".usage-meter")).toBeVisible();
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
    {
      title: "Total bank balance",
      heading: "Bank balance details",
      kind: "bank",
    },
    {
      title: "Credit cards",
      heading: "Credit card details",
      kind: "credit_card",
    },
    { title: "Pay Later", heading: "Pay Later details", kind: "pay_later" },
  ];
  for (const { title, heading, kind } of sections) {
    const dialog = await openDetails(page, title, heading);
    const accounts = data.accounts.filter(
      (account) => account.active && account.kind === kind,
    );
    await expect(dialog.locator(".financial-details-record")).toHaveCount(
      accounts.length,
    );
    for (const account of accounts) {
      const row = accountRow(dialog, account.name);
      await expect(row).toBeVisible();
      await expect(row).toContainText(`••${account.maskedSuffix}`);
      await expect(
        row.getByRole("link", {
          name: kind === "bank" ? "View account" : "Reconcile account",
          exact: true,
        }),
      ).toHaveAttribute("href", `/accounts/${account.id}`);
    }
    await expect(
      dialog.getByText("QA Inactive Bank", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("QA Inactive Card", { exact: true }),
    ).toHaveCount(0);
    await closeDetails(page, dialog, title);
  }

  const bank = await openDetails(
    page,
    "Total bank balance",
    "Bank balance details",
  );
  await accountRow(bank, "QA International Salary Account")
    .getByRole("link", { name: "View account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "QA International Salary Account",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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

test("credit and Pay Later percentages retain bands, capped meters and unknown coverage", async ({
  page,
}) => {
  const creditCard = kpi(page, "Credit cards");
  await expect(creditCard.locator(".usage-meter")).toHaveAttribute(
    "data-band",
    "unknown",
  );
  await expect(creditCard).toContainText("Overall usage unknown");
  const credit = await openDetails(page, "Credit cards", "Credit card details");
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
    await expect(valueFor(row, "Utilization")).toHaveText(sample.percentage);
    await expect(valueFor(row, "Credit limit")).toHaveText("₹10,000.00");
    await expect(row.locator(".usage-meter")).toHaveAttribute(
      "data-band",
      sample.band,
    );
    await expect(row.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      new RegExp(sample.label),
    );
  }
  const actualColors = await Promise.all(
    samples.slice(0, 3).map((sample) =>
      accountRow(credit, sample.name)
        .locator(".usage-meter > span")
        .evaluate((bar) => getComputedStyle(bar).backgroundColor),
    ),
  );
  expect(new Set(actualColors).size).toBe(3);
  const overLimitMeter = accountRow(credit, "QA Over Limit Card").getByRole(
    "meter",
  );
  await expect(overLimitMeter.locator("span")).toHaveAttribute(
    "style",
    /width:\s*100%/,
  );
  await expect(overLimitMeter).toHaveAttribute("aria-valuenow", "100");
  await expect(overLimitMeter).toHaveAttribute("aria-valuetext", /125% used/);
  for (const name of ["QA Missing Limit Card", "QA Unreported Card"]) {
    const row = accountRow(credit, name);
    await expect(row.locator(".usage-meter")).toHaveCount(0);
    await expect(row.getByRole("meter")).toHaveCount(0);
    await expect(valueFor(row, "Utilization")).toHaveText("Unknown");
    await expect(row).not.toContainText(/\b0(?:\.0)?%/);
  }
  await expect(
    valueFor(accountRow(credit, "QA Missing Limit Card"), "Credit limit"),
  ).toHaveText("Not set");
  await expect(
    valueFor(accountRow(credit, "QA Unreported Card"), "Credit limit"),
  ).toHaveText("₹10,000.00");
  await expect(valueFor(credit, "Overall utilization")).toHaveText("Unknown");
  await expect(valueFor(credit, "Available limit from known usage")).toHaveText(
    "Not available",
  );
  await closeDetails(page, credit, "Credit cards");

  const payLaterCard = kpi(page, "Pay Later");
  await expect(payLaterCard.locator(":scope > strong")).toHaveText(
    "₹10,000.00",
  );
  await expect(
    payLaterCard.locator(".financial-usage-label > span").first(),
  ).toHaveText("50% used");
  await expect(payLaterCard.locator(".usage-meter")).toHaveAttribute(
    "data-band",
    "medium",
  );
  const payLater = await openDetails(page, "Pay Later", "Pay Later details");
  await expect(valueFor(payLater, "Total credit limit")).toContainText(
    "₹20,000.00",
  );
  await expect(
    valueFor(payLater, "Available limit from known usage"),
  ).toHaveText("₹10,000.00");
  const provider = accountRow(payLater, "QA Second Pay Later");
  await expect(valueFor(provider, "Utilization")).toHaveText(/70(?:\.0)?%/);
  await expect(valueFor(provider, "Credit limit")).toHaveText("₹10,000.00");
  await expect(provider.locator(".usage-meter")).toHaveAttribute(
    "data-band",
    "high",
  );
  await closeDetails(page, payLater, "Pay Later");
});

test("all detail rows scroll into view without horizontal overflow on desktop and narrow mobile", async ({
  page,
  isMobile,
}, testInfo) => {
  await settleDashboard(page);
  await noPageOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("dashboard-compact.png"),
    fullPage: true,
  });
  const widths = isMobile ? [393, 360] : [page.viewportSize()!.width];
  const sections = [
    {
      title: "Total bank balance",
      heading: "Bank balance details",
      kind: "bank",
    },
    {
      title: "Credit cards",
      heading: "Credit card details",
      kind: "credit_card",
    },
    { title: "Pay Later", heading: "Pay Later details", kind: "pay_later" },
  ];
  for (const width of widths) {
    if (isMobile) await page.setViewportSize({ width, height: 851 });
    await settleDashboard(page);
    await noPageOverflow(page);
    for (const { title, heading, kind } of sections) {
      const dialog = await openDetails(page, title, heading);
      for (const account of accountFixture().accounts.filter(
        (account) => account.active && account.kind === kind,
      )) {
        const link = accountRow(dialog, account.name).getByRole("link", {
          name: kind === "bank" ? "View account" : "Reconcile account",
          exact: true,
        });
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport();
      }
      const dimensions = await dialog.evaluate((node) => ({
        client: node.clientWidth,
        scroll: node.scrollWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      await page.screenshot({
        path: testInfo.outputPath(`${kind}-details-${width}.png`),
      });
      await noPageOverflow(page);
      await closeDetails(page, dialog, title);
    }
  }
});
