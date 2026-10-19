import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  ids,
  mockWorkspace,
  syntheticId,
  transactionsFixture,
} from "./fixture";

const month = (page: Page) =>
  page.getByRole("combobox", { name: "Transaction month", exact: true });
const category = (page: Page) =>
  page.getByRole("combobox", { name: "Category", exact: true });
const platform = (page: Page) =>
  page.getByRole("combobox", { name: "Platform", exact: true });
const summary = (page: Page) =>
  page.getByRole("region", {
    name: "Transaction activity summary",
    exact: true,
  });
const history = (page: Page) =>
  page.getByRole("region", { name: "Transaction history", exact: true });
const rows = (page: Page) =>
  history(page).locator("[data-transaction-id]:visible");
const row = (page: Page, id: string) =>
  history(page).locator(`[data-transaction-id="${id}"]:visible`);
const tabs = (page: Page) =>
  page.getByRole("group", { name: "Transaction type", exact: true });

async function open(page: Page, path = "/transactions") {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(summary(page)).toBeVisible();
}

async function noOverflow(page: Page, controls?: Locator) {
  const width = page.viewportSize()!.width;
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width + 1);
  for (const control of await (
    controls ??
    page.locator(
      ".transactions-workspace select:visible, .transactions-workspace input:visible",
    )
  ).all()) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
}

test("normal entry uses this calendar month, approved tab order and a compact action-free header", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await open(page);
  await expect(month(page)).toHaveValue("2026-10");
  await expect(tabs(page).getByRole("button")).toHaveText([
    "All",
    "Expenses",
    "Transfer",
    "Income",
  ]);
  await expect(
    tabs(page).getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("searchbox", { name: "Search transactions", exact: true }),
  ).toHaveCount(0);
  await expect(platform(page)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: /account|credit card/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".transactions-workspace")
      .getByRole("button", { name: /Add transaction|Import/i }),
  ).toHaveCount(0);
  await expect(rows(page)).toHaveCount(19);
  await expect(history(page)).not.toContainText(
    /FOREIGN FINANCIAL|September meal|Undated expense/,
  );
  const headingBox = (await page
    .getByRole("heading", { name: "Transactions", exact: true })
    .boundingBox())!;
  const monthBox = (await month(page).boundingBox())!;
  expect(monthBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
  expect(Math.abs(monthBox.y - headingBox.y)).toBeLessThan(20);
  expect(f.writes).toEqual([]);
  expect(f.unexpectedApis).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("tabs preserve month and use model-defined expenses, transfer movements and recognized income", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await open(page);
  await month(page).selectOption("2026-09");
  for (const label of ["Expenses", "Transfer", "Income", "All"]) {
    await tabs(page).getByRole("button", { name: label, exact: true }).click();
    await expect(month(page)).toHaveValue("2026-09");
    await expect(rows(page)).toHaveCount(
      label === "Expenses" || label === "All" ? 1 : 0,
    );
  }
  await month(page).selectOption("2026-10");
  await tabs(page)
    .getByRole("button", { name: "Expenses", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(14);
  await expect(history(page)).not.toContainText(
    /repayment|Wallet transfer|Salary receipt|Lunch refund/,
  );
  await expect(summary(page)).toContainText("₹865.00");
  await expect(summary(page)).toContainText("12 posted expenses");
  await tabs(page)
    .getByRole("button", { name: "Transfer", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(2);
  await expect(summary(page)).toContainText("₹550.00");
  await expect(row(page, ids.transfer)).toContainText("↔ ₹300.00");
  await expect(row(page, ids.repayment)).toContainText("↔ ₹250.00");
  await expect(history(page)).toContainText("QA Card repayment");
  await expect(history(page)).not.toContainText("QA Balance correction");
  await expect(category(page)).toHaveCount(0);
  await expect(platform(page)).toHaveCount(0);
  await tabs(page).getByRole("button", { name: "Income", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(summary(page)).toContainText("₹1,000.00");
  await expect(category(page)).toHaveCount(0);
  await expect(platform(page)).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test("Category then Platform works on All and Expenses, including multi-category Blinkit and saved labels", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await open(page);
  for (const tab of ["All", "Expenses"]) {
    await tabs(page).getByRole("button", { name: tab, exact: true }).click();
    for (const [label, service, expected, total] of [
      ["Food", "Blinkit", "QA Food delivery", "₹50.00"],
      ["Shopping", "Blinkit", "QA Shopping delivery", "₹75.00"],
      ["Groceries", "Blinkit", "QA Grocery delivery", "₹60.00"],
      ["Stationery Items", "Blinkit", "QA Stationery delivery", "₹40.00"],
      ["Stationery Items", "Amazon", "QA Notebook order", "₹90.00"],
      ["Shopping", "Amazon", "QA Shopping purchase", "₹200.00"],
      ["Transport", "IRCTC", "QA Rail ticket", "₹120.00"],
    ]) {
      await category(page).selectOption({ label });
      await platform(page).selectOption({ label: service });
      await expect(rows(page)).toHaveCount(1);
      await expect(history(page)).toContainText(expected);
      await expect(summary(page)).toContainText(total);
      if (tab === "Expenses")
        await expect(summary(page)).toContainText(
          `${label} spending via ${service}`,
        );
    }
    await category(page).selectOption({ label: "Education" });
    await expect(platform(page)).toHaveValue("");
    await expect(history(page)).toContainText("QA Legacy course");
    await category(page).selectOption({ label: "QA Donations" });
    await expect(history(page)).toContainText("QA Custom category record");
    await category(page).selectOption({ label: "All categories" });
    await expect(platform(page)).toHaveCount(0);
  }
  expect(
    f.data.transactions.find((t) => t.description === "QA Legacy course")
      ?.category,
  ).toBe("Education");
  expect(f.writes).toEqual([]);
  expect(f.unexpectedApis).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("changing categories resets only Platform and Others filters custom/unassigned history without entry fields", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await tabs(page)
    .getByRole("button", { name: "Expenses", exact: true })
    .click();
  await category(page).selectOption({ label: "Food" });
  const platformLabels = await platform(page)
    .locator("option")
    .allTextContents();
  expect(
    platformLabels.filter((label) => label.trim().toLowerCase() === "blinkit"),
  ).toHaveLength(1);
  expect(platformLabels).toContain("QA Local Kitchen");
  await platform(page).selectOption({ label: "Others" });
  await expect(rows(page)).toHaveCount(2);
  await expect(history(page)).toContainText("QA Local food order");
  await expect(history(page)).toContainText("QA Unassigned food");
  await expect(summary(page)).toContainText("Food spending via Others");
  await expect(summary(page)).toContainText("₹50.00");
  await expect(
    page.locator(
      ".transactions-workspace input, .transactions-workspace textarea",
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await category(page).selectOption({ label: "Transport" });
  await expect(platform(page)).toHaveValue("");
  await expect(
    tabs(page).getByRole("button", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(month(page)).toHaveValue("2026-10");
  await expect(history(page)).toContainText("QA Rail ticket");
  expect(f.writes).toEqual([]);
});

test("expandable search focuses, searches saved metadata and clears only its query on Escape or close", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await category(page).selectOption({ label: "Food" });
  await platform(page).selectOption({ label: "Swiggy" });
  await page
    .getByRole("button", { name: "Search transactions", exact: true })
    .click();
  const input = page.getByRole("searchbox", {
    name: "Search transactions",
    exact: true,
  });
  await expect(input).toBeFocused();
  await expect(category(page)).toHaveCount(0);
  await expect(platform(page)).toHaveCount(0);
  for (const query of ["Orchard", "QA-FOOD-REF-001", "lunch meeting note"]) {
    await input.fill(query);
    await expect(rows(page)).toHaveCount(1);
    await expect(history(page)).toContainText("QA Orchard Kitchen");
    await expect(summary(page)).toContainText("₹100.00");
  }
  await tabs(page)
    .getByRole("button", { name: "Expenses", exact: true })
    .click();
  await expect(input).toHaveValue("lunch meeting note");
  await month(page).selectOption("2026-09");
  await expect(input).toHaveValue("lunch meeting note");
  await expect(rows(page)).toHaveCount(0);
  await month(page).selectOption("2026-10");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(category(page)).toHaveValue("Food");
  await expect(platform(page)).toHaveValue("Swiggy");
  await expect(month(page)).toHaveValue("2026-10");
  await expect(
    page.getByRole("button", { name: "Search transactions", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Search transactions", exact: true })
    .click();
  await input.fill("no such receipt");
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(platform(page)).toHaveValue("Swiggy");
  await expect(rows(page)).toHaveCount(3);
  expect(new URL(page.url()).searchParams.get("q")).toBeNull();
  expect(f.writes).toEqual([]);
});

test("contextual summaries keep gross posted expenses, income and transfer activity distinct", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await open(page);
  await expect(summary(page)).toContainText("Monthly activity");
  await expect(summary(page)).toContainText("19 transactions");
  await expect(row(page, ids.food)).toContainText("−₹100.00");
  await expect(row(page, ids.refund)).toContainText("+₹40.00");
  await expect(summary(page)).toContainText("₹865.00");
  await expect(summary(page)).toContainText("₹1,000.00");
  await expect(summary(page)).toContainText("₹550.00");
  await expect(
    summary(page).getByText("19 transactions", { exact: true }),
  ).toHaveCount(1);
  await category(page).selectOption({ label: "Food" });
  await platform(page).selectOption({ label: "Swiggy" });
  await expect(rows(page)).toHaveCount(4);
  await expect(summary(page)).toContainText("₹100.00");
  await expect(history(page)).toContainText("QA Lunch refund");
  await expect(history(page)).toContainText(/Pending review|Needs review/i);
  await expect(history(page)).toContainText(/Voided/i);
  await tabs(page)
    .getByRole("button", { name: "Expenses", exact: true })
    .click();
  await expect(summary(page)).toContainText("Food spending via Swiggy");
  await expect(summary(page)).toContainText("₹100.00");
  await expect(summary(page)).toContainText("1 posted expense");
  await expect(rows(page)).toHaveCount(3);
  await expect(history(page)).not.toContainText("QA Lunch refund");
  await category(page).selectOption({ label: "Shopping" });
  await platform(page).selectOption({ label: "Amazon" });
  await expect(summary(page)).toContainText("Shopping spending via Amazon");
  await expect(summary(page)).toContainText("₹200.00");
  expect(f.writes).toEqual([]);
});

test("transaction details are read-only until Edit and preserve payment source and reference", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await open(page);
  const trigger = row(page, ids.food).getByRole("button");
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Transaction details",
    exact: true,
  });
  await expect(dialog).toContainText("QA Lunch order");
  await expect(dialog).toContainText("QA Orchard Kitchen");
  await expect(dialog).toContainText("Food");
  await expect(dialog).toContainText("Swiggy");
  await expect(dialog).toContainText("QA Credit account");
  await expect(dialog).toContainText("QA-FOOD-REF-001");
  await mkdir("docs/transactions-review/screenshots/after/1440px", {
    recursive: true,
  });
  await page.screenshot({
    path: "docs/transactions-review/screenshots/after/1440px/transaction-details.png",
    fullPage: true,
  });
  expect(f.writes).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Edit transaction", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue("QA Lunch order");
  expect(f.writes).toEqual([]);
  await page.keyboard.press("Escape");
  expect(f.errors).toEqual([]);
});

test("date groups, deterministic sort and empty-state Clear filters retain period and tab", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(history(page)).toContainText("18 October 2026");
  await expect(history(page)).toContainText("17 October 2026");
  const newestIds = await rows(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-transaction-id")),
  );
  expect(newestIds[0]).toBe(ids.food);
  await page
    .getByRole("combobox", { name: "Transaction order", exact: true })
    .selectOption("oldest");
  expect(await rows(page).first().getAttribute("data-transaction-id")).toBe(
    syntheticId(82009),
  );
  await month(page).selectOption("2026-09");
  await tabs(page)
    .getByRole("button", { name: "Expenses", exact: true })
    .click();
  await category(page).selectOption({ label: "Health" });
  await expect(
    page.getByRole("heading", {
      name: "No matching transactions",
      exact: true,
    }),
  ).toBeVisible();
  await expect(history(page)).toContainText(
    "Try another category, platform, or search.",
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(month(page)).toHaveValue("2026-09");
  await expect(
    tabs(page).getByRole("button", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(category(page)).toHaveValue("");
  await expect(category(page)).toBeFocused();
  await expect(rows(page)).toHaveCount(1);
  await expect(history(page)).toContainText("QA September meal");
  expect(f.writes).toEqual([]);
});

test("URL refresh and browser Back/Forward restore category, platform, query, month and tabs", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await open(
    page,
    "/transactions?month=2026-10&period=month&kind=expense&category=Food&platform=Blinkit&q=delivery",
  );
  await expect(
    page.getByRole("searchbox", { name: "Search transactions", exact: true }),
  ).toHaveValue("delivery");
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await expect(platform(page)).toHaveValue("Blinkit");
  await category(page).selectOption({ label: "Shopping" });
  await expect(platform(page)).toHaveValue("");
  await platform(page).selectOption({ label: "Amazon" });
  await page.reload();
  await expect(category(page)).toHaveValue("Shopping");
  await expect(platform(page)).toHaveValue("Amazon");
  await expect(history(page)).toContainText("QA Shopping purchase");
  await page.goBack();
  await expect(category(page)).toHaveValue("Shopping");
  await expect(platform(page)).toHaveValue("");
  await page.goBack();
  await expect(category(page)).toHaveValue("Food");
  await expect(platform(page)).toHaveValue("Blinkit");
  await page.goForward();
  await expect(category(page)).toHaveValue("Shopping");
  for (const [key] of new URL(page.url()).searchParams)
    expect(new URL(page.url()).searchParams.getAll(key)).toHaveLength(1);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("existing Analytics date/status and account-history links stay constrained without an account dropdown", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await open(
    page,
    "/transactions?date=2026-10-18&period=all&kind=expense&category=Food&status=posted",
  );
  await expect(rows(page)).toHaveCount(4);
  await expect(summary(page)).toContainText("₹200.00");
  await expect(history(page)).not.toContainText(
    /awaiting review|Voided food|Lunch refund|September meal/,
  );
  await open(page, `/transactions?account=${ids.card}&period=all`);
  await expect(month(page)).toHaveValue("__all__");
  await expect(rows(page)).toHaveCount(3);
  await expect(history(page)).toContainText("QA Lunch refund");
  await expect(history(page)).toContainText("QA Card repayment");
  await expect(history(page)).not.toContainText("QA Food delivery");
  await expect(page.getByRole("combobox", { name: /account/i })).toHaveCount(0);
  await open(page, "/transactions?month=2026-09&period=all&kind=expense");
  await expect(month(page)).toHaveValue("2026-09");
  await expect(rows(page)).toHaveCount(1);
  await month(page).selectOption("__all__");
  await expect(rows(page)).toHaveCount(16);
  await expect(history(page)).toContainText("QA Undated expense");
  await expect(summary(page)).toContainText("₹910.00");
  expect(f.writes).toEqual([]);
  expect(f.unexpectedApis).toEqual([]);
  expect(f.errors).toEqual([]);
});

for (const width of [320, 360, 375, 390, 412, 430, 768, 1024, 1440]) {
  test(`${width}px responsive Transactions controls, history, summaries and search fit`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = await mockWorkspace(
      context,
      page,
      baseURL!,
      transactionsFixture(),
    );
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await open(page);
    await noOverflow(page);
    const directory = `docs/transactions-review/screenshots/after/${width}px`;
    await mkdir(directory, { recursive: true });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.screenshot({
      path: `${directory}/transactions.png`,
      fullPage: true,
    });
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `${directory}/transactions-viewport.png` });
    if (width < 768) {
      const last = rows(page).last();
      await last.scrollIntoViewIfNeeded();
      const nav = page.getByRole("navigation", {
        name: "Mobile navigation",
        exact: true,
      });
      const lastBounds = (await last.boundingBox())!;
      expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
        (await nav.boundingBox())!.y + 1,
      );
    }
    await category(page).selectOption({ label: "Stationery Items" });
    await platform(page).selectOption({ label: "Blinkit" });
    await noOverflow(page);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `${directory}/category-platform.png`,
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Search transactions", exact: true })
      .click();
    const input = page.getByRole("searchbox", {
      name: "Search transactions",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill("stationery");
    await noOverflow(page);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `${directory}/search.png`,
        fullPage: true,
      });
    await input.press("Escape");
    const selectedTransaction = page.getByRole("button", {
      name: "View transaction: QA Stationery delivery",
      exact: true,
    });
    await selectedTransaction.click();
    const dialog = page.getByRole("dialog", {
      name: "Transaction details",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `${directory}/transaction-details.png`,
        fullPage: true,
      });
    await page.keyboard.press("Escape");
    await expect(selectedTransaction).toBeFocused();
    if (width < 768)
      await expect(
        page.getByRole("navigation", {
          name: "Mobile navigation",
          exact: true,
        }),
      ).toBeVisible();
    else if (width >= 1024)
      await expect(
        history(page).getByRole("columnheader", { name: /Account|Source/i }),
      ).toBeVisible();
    expect(f.writes).toEqual([]);
    expect(f.unexpectedApis).toEqual([]);
    expect(f.errors).toEqual([]);
  });
}

test("keyboard selection and reduced motion retain focus and prevent filter-only writes", async ({
  context,
  page,
  baseURL,
}) => {
  const f = await mockWorkspace(context, page, baseURL!, transactionsFixture());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await category(page).focus();
  await page.keyboard.press("f");
  await page.keyboard.press("Enter");
  await expect(category(page)).toHaveValue("Food");
  await platform(page).focus();
  await page.keyboard.press("s");
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Search transactions", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("searchbox", { name: "Search transactions", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  const button = page.getByRole("button", {
    name: "Search transactions",
    exact: true,
  });
  await expect(button).toBeFocused();
  const focus = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
  expect(
    (focus.outlineStyle !== "none" && focus.outlineWidth !== "0px") ||
      focus.boxShadow !== "none",
  ).toBe(true);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("large amounts and long merchants fit the narrowest phone and desktop without concealing totals", async ({
  context,
  page,
  baseURL,
}) => {
  const data = transactionsFixture();
  data.transactions.find((t) => t.id === syntheticId(82005))!.description =
    "QA Shopping purchase with an intentionally long merchant description for responsive history";
  data.transactions.find((t) => t.id === syntheticId(82005))!.amount =
    "12345678.90";
  const f = await mockWorkspace(context, page, baseURL!, data);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await open(page);
    await noOverflow(page);
    await expect(summary(page)).toContainText("₹1,23,46,343.90");
    await expect(row(page, syntheticId(82005))).toContainText(
      "₹1,23,45,678.90",
    );
    expect(
      await summary(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await row(page, syntheticId(82005)).evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("malformed saved dates stay visible as unavailable in All dates and never enter recognized totals", async ({
  context,
  page,
  baseURL,
}) => {
  const data = transactionsFixture();
  const invalid = {
    ...data.transactions.find((transaction) => transaction.id === ids.food)!,
    id: syntheticId(82023),
    description: "QA Invalid calendar date",
    merchant: null,
    occurredOn: "2026-02-30",
    amount: "1234.56",
  };
  data.transactions.push(invalid);
  const f = await mockWorkspace(context, page, baseURL!, data);
  await open(page, "/transactions?period=all");
  await expect(row(page, invalid.id)).toContainText("Date unavailable");
  await expect(summary(page)).toContainText("₹910.00");
  await expect(summary(page)).toContainText("2 awaiting a valid date");
  await row(page, invalid.id).getByRole("button").click();
  await expect(
    page.getByRole("dialog", { name: "Transaction details", exact: true }),
  ).toContainText("Date unavailable");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(history(page)).toContainText("Date unavailable");
  expect(
    f.data.transactions.find((transaction) => transaction.id === invalid.id)
      ?.occurredOn,
  ).toBe("2026-02-30");
  expect(f.writes).toEqual([]);
  expect(f.unexpectedApis).toEqual([]);
  expect(f.errors).toEqual([]);
});
