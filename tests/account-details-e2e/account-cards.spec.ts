import { expect, test, type Locator, type Page } from "@playwright/test";
import { accountBalance, formatMoney } from "../../src/lib/finance";
import { accountUsage } from "../../src/lib/usage";
import type { Account } from "../../src/lib/types";
import {
  dashboard,
  fixture,
  id,
  mockWorkspace,
  noOverflow,
  ownedWorkspace,
  TODAY,
} from "./fixture";

const sections = [
  {
    kind: "bank",
    trigger: "Total bank balance details",
    title: "Bank balance details",
  },
  {
    kind: "credit_card",
    trigger: "Credit cards details",
    title: "Credit card details",
  },
  {
    kind: "pay_later",
    trigger: "Pay Later details",
    title: "Pay Later details",
  },
] as const;

async function openDetails(page: Page, section: (typeof sections)[number]) {
  const trigger = page.getByRole("button", {
    name: section.trigger,
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: section.title, exact: true });
  await expect(dialog).toBeVisible();
  const details = dialog.locator(`.fac-details[data-kind="${section.kind}"]`);
  await expect(details).toBeVisible();
  const carousel = details.locator(".financial-carousel");
  return { trigger, dialog, details, carousel };
}

function value(details: Locator, label: string) {
  if (["Current balance", "Current outstanding", "Credit used"].includes(label))
    return details
      .locator(".fac-summary .fac-primary-balance")
      .filter({ hasText: new RegExp(`^${label}`) })
      .locator("strong");
  return details
    .locator(".fac-value")
    .filter({ has: details.page().getByText(label, { exact: true }) })
    .locator("dd");
}

function selectedCard(carousel: Locator) {
  return carousel.locator(
    '.financial-carousel-slide[data-selected="true"] .virtual-account-card',
  );
}

async function selected(details: Locator, account: Account) {
  await expect(details).toHaveAttribute("data-selected-account", account.id);
  const carousel = details.locator(".financial-carousel");
  await expect(carousel).toHaveAttribute(
    "data-selected-account-id",
    account.id,
  );
  await expect(
    carousel.locator('.financial-carousel-slide[data-selected="true"]'),
  ).toHaveCount(1);
  await expect(selectedCard(carousel)).toHaveAccessibleName(
    `${account.name} account details`,
  );
  await expect(details.locator(".recent-account-transactions")).toHaveAttribute(
    "data-account-id",
    account.id,
  );
}

async function noDialogOverflow(dialog: Locator) {
  const box = (await dialog.boundingBox())!;
  const viewport = dialog.page().viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await dialog
      .locator(".financial-details-body")
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
}

for (const width of [320, 390, 768, 1440]) {
  test(`selected bank, credit and Pay Later cards retain balances and close focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = fixture();
    const unchanged = await mockWorkspace(page, f.data);
    const owned = ownedWorkspace(f.data);
    await dashboard(page);
    for (const section of sections) {
      const account =
        section.kind === "bank"
          ? f.bank
          : section.kind === "credit_card"
            ? f.credit
            : f.payLater;
      const { trigger, dialog, details, carousel } = await openDetails(
        page,
        section,
      );
      await selected(details, account);
      await expect(carousel.locator(".virtual-account-card")).toHaveCount(
        section.kind === "credit_card" ? 2 : 3,
      );
      await expect(dialog).not.toContainText(
        "FOREIGN ACCOUNT MUST STAY HIDDEN",
      );
      await expect(dialog).not.toContainText(
        "FOREIGN TRANSACTION MUST STAY HIDDEN",
      );
      if (section.kind === "bank") {
        await expect(value(details, "Current balance")).toContainText(
          formatMoney(accountBalance(owned, account.id, TODAY).current!),
        );
        await expect(value(details, "Recorded credits")).toContainText(
          "₹30.00",
        );
        await expect(value(details, "Recorded debits")).toContainText("₹30.00");
        await expect(dialog).toContainText("Calculated");
        await expect(dialog).toContainText("1111");
        await expect(dialog).not.toContainText("1234567890121111");
      } else {
        const usage = accountUsage(owned, account.id, TODAY);
        await expect(value(details, "Current outstanding")).toContainText(
          formatMoney(usage.currentOutstanding!),
        );
        await expect(value(details, "Credit used")).toContainText(
          formatMoney(usage.used!),
        );
        await expect(value(details, "Available credit")).toContainText(
          formatMoney(usage.availableCredit!),
        );
      }
      const mark = selectedCard(carousel).getByRole("img", {
        name: /initials$/,
      });
      await expect(mark).toBeVisible();
      await expect(mark).not.toHaveText("");
      await expect(details.locator(".fac-summary")).toBeVisible();
      await expect(details.locator("details")).toHaveCount(0);
      const cardBox = (await selectedCard(carousel).boundingBox())!;
      const carouselBox = (await carousel.boundingBox())!;
      const summaryBox = (await details.locator(".fac-summary").boundingBox())!;
      const recentBox = (await details
        .locator(".recent-account-transactions")
        .boundingBox())!;
      if (width >= 1000) {
        expect(carouselBox.x + carouselBox.width).toBeLessThanOrEqual(
          summaryBox.x,
        );
        expect(carouselBox.y).toBeLessThan(recentBox.y);
      } else {
        expect(cardBox.y).toBeLessThan(summaryBox.y);
      }
      expect(summaryBox.y).toBeLessThan(recentBox.y);
      await noOverflow(page);
      await noDialogOverflow(dialog);
      await page.screenshot({
        path: test.info().outputPath(`${section.kind}-${width}x1000.png`),
      });
      await dialog
        .getByRole("button", { name: "Close financial details", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    unchanged();
  });
}

test("five recent rows use exact selected account links, exclude future and retain review status", async ({
  page,
}) => {
  const f = fixture();
  const unchanged = await mockWorkspace(page, f.data);
  await dashboard(page);
  const { dialog, details, carousel } = await openDetails(page, sections[0]);
  const recent = details.locator(".recent-account-transactions > ul > li");
  await expect(recent).toHaveCount(5);
  for (const [index, description] of [
    "Current bank expense",
    "Same-day confirmed bank expense",
    "Earlier bank income",
    "Pending bank purchase",
    "Voided bank purchase",
  ].entries())
    await expect(recent.nth(index)).toContainText(description);
  await expect(recent.nth(3)).toContainText("Pending review · not posted");
  await expect(recent.nth(4)).toContainText("Voided · not posted");
  await expect(dialog).not.toContainText("Other SBI account payment");
  await expect(dialog).not.toContainText("Future bank payment");
  await expect(dialog).not.toContainText("Older bank history");
  await expect(value(details, "Current balance")).toContainText("₹970.00");
  await carousel
    .getByRole("button", { name: "Next bank account", exact: true })
    .click();
  await selected(details, f.bankTwin);
  await expect(recent).toHaveCount(1);
  await expect(recent).toContainText("Other SBI account payment");
  await expect(dialog).not.toContainText("Current bank expense");
  await expect(value(details, "Current balance")).toContainText("₹1,979.00");
  unchanged();
});

test("same-provider selection supports finite arrows, Home/End and dialog keyboard focus", async ({
  page,
}) => {
  const f = fixture();
  const unchanged = await mockWorkspace(page, f.data);
  await dashboard(page);
  const { details, carousel, dialog, trigger } = await openDetails(
    page,
    sections[2],
  );
  const track = carousel.locator(".financial-carousel-track");
  const previous = carousel.getByRole("button", {
    name: /Previous pay later provider/i,
  });
  const next = carousel.getByRole("button", {
    name: /Next pay later provider/i,
  });
  await expect(previous).toBeDisabled();
  await track.focus();
  await page.keyboard.press("ArrowRight");
  await selected(details, f.payLaterTwin);
  await expect(details.locator(".recent-account-transactions")).toContainText(
    "Other Amazon account purchase",
  );
  await expect(
    details.locator(".recent-account-transactions"),
  ).not.toContainText("Current Amazon purchase");
  await page.keyboard.press("End");
  await selected(details, f.partial);
  await expect(next).toBeDisabled();
  await page.keyboard.press("Home");
  await selected(details, f.payLater);
  await next.click();
  await selected(details, f.payLaterTwin);
  await previous.click();
  await selected(details, f.payLater);
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  unchanged();
});

for (const index of [0, 2]) {
  test(`native touch scrolling selects the next ${sections[index].kind} card`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    const f = fixture();
    const [first, second] =
      index === 0 ? [f.bank, f.bankTwin] : [f.payLater, f.payLaterTwin];
    f.data.accounts = [first, second];
    const unchanged = await mockWorkspace(page, f.data);
    await dashboard(page);
    const { details, carousel } = await openDetails(page, sections[index]);
    const track = carousel.locator(".financial-carousel-track");
    await track.scrollIntoViewIfNeeded();
    const box = (await track.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + Math.min(80, box.height / 2);
    const start = box.x + box.width * 0.85;
    const end = box.x + box.width * 0.15;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: start, y }],
    });
    for (let step = 1; step <= 12; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start + ((end - start) * step) / 12, y }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await selected(details, second);
    expect(
      await track.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
    await cdp.detach();
    unchanged();
  });
}

for (const section of sections) {
  test(`View all opens the selected ${section.kind} exact-account ledger across months`, async ({
    page,
  }) => {
    const f = fixture();
    const unchanged = await mockWorkspace(page, f.data);
    await dashboard(page);
    const account =
      section.kind === "bank"
        ? f.bank
        : section.kind === "credit_card"
          ? f.credit
          : f.payLater;
    const old =
      section.kind === "bank"
        ? "Older bank history"
        : section.kind === "credit_card"
          ? "Old card history"
          : "Old Amazon history";
    const { details } = await openDetails(page, section);
    const link = details.getByRole("link", { name: "View all", exact: true });
    await expect(link).toHaveAttribute(
      "href",
      `/transactions?account=${account.id}&period=all`,
    );
    await link.click();
    await expect(page).toHaveURL(
      new RegExp(`/transactions\\?account=${account.id}&period=all$`),
    );
    await expect(
      page.getByRole("combobox", { name: "Filter account", exact: true }),
    ).toHaveValue(account.id);
    await expect(page.getByLabel("All dates", { exact: true })).toBeChecked();
    await expect(
      page.getByRole("button", { name: `Edit ${old}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Edit FOREIGN TRANSACTION MUST STAY HIDDEN",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    unchanged();
  });
}

test("unknown bank balances and bill-only Pay Later exposure stay explicitly unknown", async ({
  page,
}) => {
  const f = fixture();
  const unchanged = await mockWorkspace(page, f.data);
  await dashboard(page);
  const bank = await openDetails(page, sections[0]);
  await bank.carousel.locator(".financial-carousel-track").focus();
  await page.keyboard.press("End");
  await selected(bank.details, f.unknownBank);
  await expect(value(bank.details, "Current balance")).toContainText(
    /unknown|not reported|not available/i,
  );
  await expect(
    bank.details.locator(".recent-account-transactions > ul > li"),
  ).toHaveCount(0);
  await expect(
    selectedCard(bank.carousel).getByRole("img", { name: /initials$/ }),
  ).toBeVisible();
  await bank.dialog
    .getByRole("button", { name: "Close financial details", exact: true })
    .click();
  const payLater = await openDetails(page, sections[2]);
  await payLater.carousel.locator(".financial-carousel-track").focus();
  await page.keyboard.press("End");
  await selected(payLater.details, f.partial);
  await expect(value(payLater.details, "Current outstanding")).toContainText(
    /unknown|not reported|not available/i,
  );
  expect(
    accountUsage(ownedWorkspace(f.data), f.partial.id, TODAY).available,
  ).toBeNull();
  await expect(value(payLater.details, "Available credit")).toContainText(
    /unknown|not reported|not available/i,
  );
  await expect(payLater.details).not.toContainText("₹330.00");
  await expect(payLater.details).toContainText(
    /partial|bill-only|unpaid bills/i,
  );
  await expect(payLater.details).toContainText("₹170.00");
  await expect(
    selectedCard(payLater.carousel).locator(".usage-meter"),
  ).toHaveCount(0);
  unchanged();
});

for (const section of sections) {
  test(`single ${section.kind} card has an empty recent state without redundant controls`, async ({
    page,
  }) => {
    const f = fixture();
    const account =
      section.kind === "bank"
        ? f.bank
        : section.kind === "credit_card"
          ? f.credit
          : f.payLater;
    f.data.accounts = [account];
    f.data.transactions = [];
    f.data.bills = [];
    if (section.kind === "bank")
      f.data.snapshots = [{ ...f.data.snapshots[0], reportedBalance: "0.00" }];
    const unchanged = await mockWorkspace(page, f.data);
    await dashboard(page);
    const { details, carousel } = await openDetails(page, section);
    await selected(details, account);
    await expect(carousel.locator(".virtual-account-card")).toHaveCount(1);
    await expect(carousel.locator(".financial-carousel-controls")).toHaveCount(
      0,
    );
    await expect(
      details.locator(".recent-account-transactions > ul > li"),
    ).toHaveCount(0);
    await expect(details.locator(".recent-account-empty")).toContainText(
      /No .*transactions/i,
    );
    if (section.kind === "bank")
      await expect(value(details, "Current balance")).toContainText("₹0.00");
    unchanged();
  });
}

test("empty account groups show useful states without fabricated values", async ({
  page,
}) => {
  const f = fixture();
  f.data.accounts = [];
  f.data.transactions = [];
  f.data.snapshots = [];
  f.data.bills = [];
  const unchanged = await mockWorkspace(page, f.data);
  await dashboard(page);
  for (const section of sections) {
    const { details, carousel, dialog } = await openDetails(page, section);
    await expect(carousel.locator(".virtual-account-card")).toHaveCount(0);
    await expect(details.locator(".fac-summary")).toHaveCount(0);
    await expect(details).toContainText(
      /no .*accounts|no .*cards|no .*providers/i,
    );
    await dialog
      .getByRole("button", { name: "Close financial details", exact: true })
      .click();
  }
  unchanged();
});

test("long names, large signed balances and masked identifiers fit a narrow sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const f = fixture();
  f.bank.name =
    "Synthetic current account with deliberately long account title for narrow phones";
  f.bank.institution =
    "Synthetic Financial Institution With A Deliberately Long Name";
  f.data.snapshots.find((row) => row.accountId === f.bank.id)!.reportedBalance =
    "-1234567890123.45";
  const unchanged = await mockWorkspace(page, f.data);
  await dashboard(page);
  const { dialog, details, carousel } = await openDetails(page, sections[0]);
  await selected(details, f.bank);
  await expect(selectedCard(carousel)).toContainText("••1111");
  await expect(dialog).not.toContainText("1234567890121111");
  await expect(value(details, "Current balance")).toContainText(
    "−₹12,34,56,78,90,153.45",
  );
  await noOverflow(page);
  await noDialogOverflow(dialog);
  unchanged();
});

test("Pay Later due amount and next due date agree across unpaid, paid and future payments", async ({
  page,
}) => {
  const f = fixture();
  f.data.accounts = [f.bank, f.payLater];
  const bill = (
    number: number,
    amount: string,
    statementDate: string,
    dueDate: string,
  ) => ({
    id: id(number),
    userId: f.payLater.userId,
    accountId: f.payLater.id,
    statementAmount: amount,
    statementDate,
    dueDate,
    periodStart: statementDate,
    periodEnd: statementDate,
  });
  const older = bill(501, "120.00", "2026-09-01", "2026-09-20");
  const latest = bill(502, "300.00", "2026-10-01", "2026-10-20");
  f.data.bills = [latest, older];
  const paid = {
    ...f.data.transactions[0],
    id: id(503),
    description: "Paid latest statement",
    amount: "300.00",
    kind: "bill_payment" as const,
    fromAccountId: f.bank.id,
    toAccountId: f.payLater.id,
  };
  const future = {
    ...paid,
    id: id(504),
    description: "Future older-statement payment",
    amount: "120.00",
    occurredOn: "2026-10-20",
  };
  f.data.transactions = [paid, future];
  f.data.allocations = [
    {
      id: id(505),
      userId: f.payLater.userId,
      transactionId: paid.id,
      billId: latest.id,
      amount: "300.00",
      verified: true,
    },
    {
      id: id(506),
      userId: f.payLater.userId,
      transactionId: future.id,
      billId: older.id,
      amount: "120.00",
      verified: true,
    },
  ];
  const unchanged = await mockWorkspace(page, f.data);
  await dashboard(page);
  const { details } = await openDetails(page, sections[2]);
  await expect(value(details, "Recorded amount due")).toContainText("₹120.00");
  await expect(value(details, "Next payment due")).toContainText(
    /20 Sep|Sep 20/,
  );
  await expect(
    details.locator(".recent-account-transactions"),
  ).not.toContainText("Future older-statement payment");
  unchanged();
});
