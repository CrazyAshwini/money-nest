import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  accountBalance,
  formatMoney,
  isDebtAccount,
} from "../../src/lib/finance";
import { getCreditAvailabilityPresentation } from "../../src/lib/credit-presentation";
import { accountHistoryHref } from "../../src/lib/account-presentation";
import { accountUsage } from "../../src/lib/usage";
import type { Account, WorkspaceData } from "../../src/lib/types";
import { fixture, mockWorkspace, noOverflow, ready, TODAY } from "./fixture";

const kinds = [
  {
    kind: "bank",
    label: "Bank accounts",
    filter: "Bank",
    control: "bank account",
    first: "bank",
    second: "bankTwin",
    file: "bank",
  },
  {
    kind: "credit_card",
    label: "Credit cards",
    filter: "Cards",
    control: "credit card",
    first: "card",
    second: "cardTwin",
    file: "credit-card",
  },
  {
    kind: "pay_later",
    label: "Pay Later accounts",
    filter: "Pay Later",
    control: "pay later account",
    first: "payLater",
    second: "payLaterTwin",
    file: "pay-later",
  },
  {
    kind: "wallet",
    label: "Wallets",
    filter: "Wallet",
    control: "wallet",
    first: "wallet",
    second: "walletTwin",
    file: "wallet",
  },
] as const;

const carousel = (page: Page, label: string) =>
  page.getByRole("region", { name: label, exact: true });
const card = (deck: Locator) =>
  deck.locator(
    '.financial-carousel-slide[data-selected="true"] .virtual-account-card',
  );
const history = (page: Page, accountId: string) =>
  page.locator(`.recent-account-transactions[data-account-id="${accountId}"]`);
const row = (history: Locator, transactionId: string) =>
  history.locator(`[data-transaction-id="${transactionId}"]`);

async function open(page: Page, path = "/accounts") {
  await page.goto(path);
  await ready(page);
  await expect(page.locator(".financial-carousel").first()).toBeVisible();
}

async function selected(page: Page, deck: Locator, account: Account) {
  await expect(deck).toHaveAttribute("data-selected-account-id", account.id);
  await expect(
    card(deck).getByRole("link", {
      name: `${account.name} account details`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(history(page, account.id)).toBeVisible();
}

async function faceValues(
  face: Locator,
  account: Account,
  data: WorkspaceData,
) {
  if (isDebtAccount(account)) {
    const usage = accountUsage(data, account.id, TODAY);
    const availability = getCreditAvailabilityPresentation(usage);
    const outstanding = face.locator('[data-metric="outstanding"]');
    if (usage.currentOutstanding !== null)
      await expect(outstanding).toContainText(
        formatMoney(usage.currentOutstanding),
      );
    else if (usage.provenance === "partial" && usage.used !== null) {
      await expect(outstanding).toContainText(
        `At least ${formatMoney(usage.used)}`,
      );
      await expect(outstanding).toContainText("Partial");
    } else await expect(outstanding).toContainText("Not available");
    await expect(face.locator('[data-metric="available"]')).toContainText(
      availability.amount === null
        ? "Not available"
        : formatMoney(availability.amount),
    );
    await expect(face.locator('[data-metric="limit"]')).toContainText(
      usage.totalCreditLimit === null
        ? "Not available"
        : formatMoney(usage.totalCreditLimit),
    );
    if (
      usage.creditUtilization !== null &&
      usage.provenance !== "partial" &&
      usage.provenance !== "unknown"
    ) {
      await expect(face.getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        String(usage.progress),
      );
    } else {
      await expect(face.getByRole("meter")).toHaveCount(0);
      await expect(face).toContainText("Usage unavailable");
    }
  } else {
    const balance = accountBalance(data, account.id, TODAY);
    const value = face.locator('[data-metric="balance"]');
    await expect(value).toContainText(
      balance.current === null
        ? "Balance unavailable"
        : formatMoney(balance.current),
    );
    if (balance.current !== null)
      await expect(value).toContainText(
        balance.currentSource === "opening" ||
          balance.movementsSinceSnapshot > 0
          ? "Calculated"
          : "Reported",
      );
  }
}

async function noDuplicatePanels(page: Page) {
  await expect(
    page.locator(
      "main .virtual-account-facts, main .virtual-account-card-footer, main .virtual-account-credit-facts",
    ),
  ).toHaveCount(0);
}

async function touchNext(page: Page, track: Locator) {
  await track.scrollIntoViewIfNeeded();
  const box = (await track.boundingBox())!;
  const start = box.x + box.width * 0.85;
  const end = box.x + box.width * 0.15;
  const y = box.y + Math.min(80, box.height / 2);
  const cdp = await page.context().newCDPSession(page);
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
  await cdp.detach();
}

async function manage(page: Page, account: Account) {
  const edit = card(
    carousel(page, kinds.find((item) => item.kind === account.kind)!.label),
  ).getByRole("button", { name: `Edit ${account.name} account`, exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog", {
    name: "Edit account",
    exact: true,
  });
  await expect(
    dialog.getByRole("textbox", { name: "Account name", exact: true }),
  ).toHaveValue(account.name);
  const link = dialog.getByRole("link", {
    name: "Statements and reports",
    exact: true,
  });
  await expect(link).toHaveAttribute(
    "href",
    `/accounts/${account.id}?manage=reports`,
  );
  await link.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Statements and reports", level: 1 }),
  ).toBeVisible();
  return page.locator(".account-management");
}

test("overview retains category order and one canonical financial summary on each card", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  await open(page);
  await expect(
    page
      .getByRole("group", { name: "Account kind", exact: true })
      .getByRole("button"),
  ).toHaveText(["All", "Bank", "Cards", "Pay Later", "Wallet"]);
  for (const item of kinds) {
    const account = f[item.first];
    const deck = carousel(page, item.label);
    await selected(page, deck, account);
    await faceValues(
      card(deck).locator(".virtual-account-face"),
      account,
      f.data,
    );
    await expect(
      card(deck).getByRole("img", {
        name: `${account.institution} initials`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(deck.locator(".financial-carousel-heading")).toContainText(
      "1 of 2",
    );
  }
  await noDuplicatePanels(page);
  await expect(page.locator("main")).not.toContainText("1234567890120425");
  await expect(page.locator("main")).not.toContainText(
    "FOREIGN ACCOUNT MUST STAY HIDDEN",
  );
  await expect(page.locator("main")).not.toContainText(
    "FOREIGN TRANSACTION MUST STAY HIDDEN",
  );
  state.unchanged();
});

test("category filters retain all supported kinds without replacing the existing carousel", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  await open(page);
  const filters = page.getByRole("group", {
    name: "Account kind",
    exact: true,
  });
  for (const item of kinds) {
    await filters
      .getByRole("button", { name: item.filter, exact: true })
      .click();
    await expect(
      filters.getByRole("button", { name: item.filter, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("main .financial-carousel:visible")).toHaveCount(
      1,
    );
    await selected(page, carousel(page, item.label), f[item.first]);
  }
  await filters.getByRole("button", { name: "All", exact: true }).click();
  await expect(
    page.locator("main .account-group-panel > .financial-carousel:visible"),
  ).toHaveCount(4);
  state.unchanged();
});

test("grouped history keeps owner and account IDs, self-transfers once and distinct equal purchases", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  f.data.transactions.find(
    (transaction) => transaction.description === "QA Purchase awaiting review",
  )!.occurredOn = "2026-10-21";
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  await open(page);
  const recent = history(page, f.bank.id);
  await expect(recent.locator(".recent-account-date-group")).toHaveCount(1);
  await expect(recent).toContainText("22 October 2026");
  await expect(recent.locator("[data-transaction-id]")).toHaveCount(4);
  await expect(row(recent, f.selfTransfer.id)).toHaveCount(1);
  for (const purchase of f.twins)
    await expect(row(recent, purchase.id)).toContainText("QA Stationery Shop");
  await expect(
    recent.getByText("QA Stationery Shop", { exact: true }),
  ).toHaveCount(2);
  await expect(row(recent, f.transfer.id)).toContainText(
    "QA Current → QA Daily wallet",
  );
  await expect(row(recent, f.twins[0].id)).toContainText(
    "Shopping · QA Marketplace",
  );
  await expect(recent).not.toContainText("FOREIGN");
  await expect(recent).not.toContainText("QA Savings income");
  await open(page, `/accounts/${f.bank.id}`);
  const statementHistory = history(page, f.bank.id);
  await expect(
    statementHistory.locator(".recent-account-date-group"),
  ).toHaveCount(2);
  await expect(statementHistory).toContainText("21 October 2026");
  await expect(statementHistory).toContainText("Needs review · not posted");
  const viewAll = statementHistory.getByRole("link", {
    name: "View all",
    exact: true,
  });
  await expect(viewAll).toHaveAttribute("href", accountHistoryHref(f.bank.id));
  await viewAll.click();
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?account=${f.bank.id}&period=all$`),
  );
  await expect(page.getByRole("combobox", { name: /account/i })).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".txw-history [data-transaction-id]:visible"),
  ).toHaveCount(5);
  await expect(page.locator(".txw-history")).not.toContainText("FOREIGN");
  state.unchanged();
});

for (const item of kinds) {
  test(`${item.kind} pencil opens the exact selected existing editor without navigating or saving`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = fixture();
    const state = await mockWorkspace(context, page, baseURL!, f.data);
    await open(page);
    const deck = carousel(page, item.label);
    for (const account of [f[item.first], f[item.second]]) {
      if (account.id === f[item.second].id)
        await deck
          .getByRole("button", { name: `Next ${item.control}`, exact: true })
          .click();
      await selected(page, deck, account);
      const pencil = card(deck).getByRole("button", {
        name: `Edit ${account.name} account`,
        exact: true,
      });
      await expect(pencil).toHaveAttribute("title", /Edit/);
      const box = (await pencil.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      if (account.id === f[item.second].id) {
        await card(deck)
          .getByRole("link", {
            name: `${account.name} account details`,
            exact: true,
          })
          .focus();
        await page.keyboard.press("Tab");
        await expect(pencil).toBeFocused();
        expect(
          await pencil.evaluate((node) => getComputedStyle(node).outlineStyle),
        ).not.toBe("none");
        await page.keyboard.press("Enter");
      } else await pencil.click();
      await expect(page).toHaveURL(/\/accounts$/);
      const dialog = page.getByRole("dialog", {
        name: "Edit account",
        exact: true,
      });
      await expect(
        dialog.getByRole("textbox", { name: "Account name", exact: true }),
      ).toHaveValue(account.name);
      await expect(
        dialog.getByRole("combobox", { name: "Account type", exact: true }),
      ).toHaveValue(account.kind);
      await expect(
        dialog.getByRole("button", { name: "Save account", exact: true }),
      ).toBeVisible();
      expect(state.writes).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(pencil).toBeFocused();
    }
    state.unchanged();
  });

  test(`${item.kind} individual page is a compact card and statement history with preserved Back and View all`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = fixture();
    const state = await mockWorkspace(context, page, baseURL!, f.data);
    const account = f[item.first];
    await open(page);
    const deck = carousel(page, item.label);
    await card(deck)
      .getByRole("link", {
        name: `${account.name} account details`,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}$`));
    await selected(page, carousel(page, item.label), account);
    await faceValues(
      card(carousel(page, item.label)).locator(".virtual-account-face"),
      account,
      f.data,
    );
    await noDuplicatePanels(page);
    await expect(
      page.locator(
        "main .three-stats, main .info-banner, main .account-credit-overview, main .account-statement-details, main .transaction-table",
      ),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reported snapshot", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit account", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toHaveCount(0);
    const recent = history(page, account.id);
    await expect(
      recent.getByRole("heading", { name: "Statement history", exact: true }),
    ).toBeVisible();
    await expect(recent.locator(".recent-account-heading p")).toHaveCount(0);
    await expect(
      recent.getByRole("link", { name: "View all", exact: true }),
    ).toHaveAttribute("href", accountHistoryHref(account.id));
    await expect(
      page.getByRole("link", { name: /^Back(?: to accounts)?$/, exact: true }),
    ).toHaveAttribute("href", "/accounts");
    await page
      .getByRole("link", { name: /^Back(?: to accounts)?$/, exact: true })
      .click();
    await expect(page).toHaveURL(/\/accounts$/);
    state.unchanged();
  });

  test(`${item.kind} native mobile swipe updates the selected card and account-only history without arrows`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = fixture();
    const state = await mockWorkspace(context, page, baseURL!, f.data);
    await page.setViewportSize({ width: 390, height: 1000 });
    await open(page);
    await page
      .getByRole("group", { name: "Account kind", exact: true })
      .getByRole("button", { name: item.filter, exact: true })
      .click();
    const deck = carousel(page, item.label);
    await expect(
      deck.locator(".financial-carousel-controls"),
    ).not.toBeVisible();
    await expect(deck).not.toContainText("Swipe or use the arrows to browse");
    const first = f[item.first];
    const next = f[item.second];
    await selected(page, deck, first);
    await touchNext(page, deck.locator(".financial-carousel-track"));
    await selected(page, deck, next);
    await expect(deck.locator(".financial-carousel-heading")).toContainText(
      "2 of 2",
    );
    await expect(history(page, first.id)).toHaveCount(0);
    await faceValues(card(deck).locator(".virtual-account-face"), next, f.data);
    await noOverflow(page);
    state.unchanged();
  });
}

test("desktop carousel keyboard and finite arrows stay local and single cards have no controls", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  await open(page);
  for (const item of kinds) {
    const deck = carousel(page, item.label);
    const track = deck.locator(".financial-carousel-track");
    await expect(
      deck.getByRole("button", {
        name: `Previous ${item.control}`,
        exact: true,
      }),
    ).toBeDisabled();
    await track.focus();
    await page.keyboard.press("End");
    await selected(page, deck, f[item.second]);
    await expect(
      deck.getByRole("button", { name: `Next ${item.control}`, exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Home");
    await selected(page, deck, f[item.first]);
    await expect(track).toBeFocused();
    const outline = await track.evaluate(
      (node) => getComputedStyle(node).outlineStyle,
    );
    expect(outline).not.toBe("none");
  }
  f.data.accounts = f.data.accounts.filter(
    (account) => account.id !== f.bankTwin.id,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    carousel(page, "Bank accounts").locator(".financial-carousel-controls"),
  ).toHaveCount(0);
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("Edit Account retains reported balance entry and reconciliation behind the optional management flow", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data, [
    "snapshots",
  ]);
  await open(page, `/accounts/${f.bank.id}`);
  const tools = await manage(page, f.bank);
  await expect(tools).toHaveAttribute("data-account-id", f.bank.id);
  await expect(tools).toContainText("Balance reconciliation");
  expect(state.writes).toEqual([]);
  await tools
    .getByRole("button", { name: "Update reported balance", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add reported snapshot",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("spinbutton", { name: "Reported cash balance · ₹", exact: true })
    .fill("1200.00");
  await dialog
    .getByRole("button", { name: "Save reported snapshot", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].collection).toBe("snapshots");
  expect(state.writes[0].record).toMatchObject({
    accountId: f.bank.id,
    userId: f.bank.userId,
    reportedBalance: "1200.00",
    source: "user_report",
    verifiedByUser: false,
  });
  await tools
    .getByRole("link", { name: "Back to account", exact: true })
    .click();
  await expect(
    card(carousel(page, "Bank accounts")).locator('[data-metric="balance"]'),
  ).toContainText(
    formatMoney(accountBalance(f.data, f.bank.id, TODAY).current!),
  );
  await expect(
    page.getByRole("button", { name: "Update reported balance", exact: true }),
  ).toHaveCount(0);
  expect(state.errors).toEqual([]);
  expect(state.unexpectedApis).toEqual([]);
});

test("management preserves statement and repayment entry plus generic EMI principal and future-interest reports", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  await open(page, `/accounts/${f.payLater.id}`);
  const tools = await manage(page, f.payLater);
  await expect(tools).toContainText("Active EMI agreements");
  await expect(
    tools.locator('[data-field="financed-principal"]'),
  ).toContainText("₹600.00");
  await expect(tools.locator('[data-field="unbilled-interest"]')).toContainText(
    "₹120.00",
  );
  await expect(tools.locator('[data-field="unbilled-interest"]')).toContainText(
    "Does not consume limit upfront",
  );
  await tools
    .getByRole("button", { name: "Add statement", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Add statement", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await tools
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await tools
    .getByRole("link", { name: "Back to account", exact: true })
    .click();
  const face = card(carousel(page, "Pay Later accounts")).locator(
    ".virtual-account-face",
  );
  const usage = accountUsage(f.data, f.payLater.id, TODAY);
  expect(usage.used).toBe("600.00");
  await expect(face.locator('[data-metric="available"]')).toContainText(
    "₹5,400.00",
  );
  state.unchanged();
});

test("unknown wallet and partial Pay Later keep unavailable values and preserve the empty history", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  await open(page, `/accounts/${f.walletTwin.id}`);
  let selectedCard = card(carousel(page, "Wallets"));
  await expect(selectedCard.locator('[data-metric="balance"]')).toContainText(
    "Balance unavailable",
  );
  await expect(selectedCard).not.toContainText("₹0.00");
  await expect(selectedCard.locator(".virtual-account-number")).toHaveCount(0);
  await expect(history(page, f.walletTwin.id)).toContainText(
    "No transactions recorded for this account yet.",
  );
  await open(page, `/accounts/${f.payLaterTwin.id}`);
  selectedCard = card(carousel(page, "Pay Later accounts"));
  await expect(
    selectedCard.locator('[data-metric="outstanding"]'),
  ).toContainText("At least ₹100.00");
  await expect(
    selectedCard.locator('[data-metric="outstanding"]'),
  ).toContainText("Partial");
  await expect(selectedCard.locator('[data-metric="available"]')).toContainText(
    "Not available",
  );
  await expect(selectedCard.getByRole("meter")).toHaveCount(0);
  state.unchanged();
});

test("long names, large signed amounts and keyboard transaction entry remain readable at 320px", async ({
  context,
  page,
  baseURL,
}) => {
  const f = fixture();
  f.bank.name =
    "QA exceptionally long current account name with a careful readable fallback";
  f.bank.institution = "QA Long Institution Name and Banking Services";
  f.data.snapshots[0].reportedBalance = "123456789.99";
  f.twins[0].merchant =
    "QA exceptionally long merchant name that should truncate without covering the signed amount";
  const state = await mockWorkspace(context, page, baseURL!, f.data);
  await page.setViewportSize({ width: 320, height: 1000 });
  await open(page, `/accounts/${f.bank.id}`);
  const selectedCard = card(carousel(page, "Bank accounts"));
  await faceValues(
    selectedCard.locator(".virtual-account-face"),
    f.bank,
    f.data,
  );
  const pencilBox = (await selectedCard
    .getByRole("button", { name: `Edit ${f.bank.name} account`, exact: true })
    .boundingBox())!;
  const cardBox = (await selectedCard.boundingBox())!;
  expect(pencilBox.x + pencilBox.width).toBeLessThanOrEqual(
    cardBox.x + cardBox.width + 1,
  );
  await noOverflow(page);
  const transaction = row(history(page, f.bank.id), f.twins[0].id).getByRole(
    "button",
  );
  await transaction.focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue(f.twins[0].description);
  expect(state.writes).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(transaction).toBeFocused();
  state.unchanged();
});

for (const width of [
  320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440, 1920,
]) {
  test(`compact overview and bank details fit ${width}px with reachable history and proportional cards`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = fixture();
    const state = await mockWorkspace(context, page, baseURL!, f.data);
    await page.setViewportSize({ width, height: 1000 });
    await open(page);
    await noOverflow(page);
    await noDuplicatePanels(page);
    await expect(page.locator("main")).not.toContainText(
      "Swipe or use the arrows to browse",
    );
    for (const item of kinds) {
      const deck = carousel(page, item.label);
      const chosen = card(deck);
      await faceValues(
        chosen.locator(".virtual-account-face"),
        f[item.first],
        f.data,
      );
      expect(
        await chosen.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const recent = history(page, f[item.first].id);
      const deckBox = (await deck.boundingBox())!;
      const recentBox = (await recent.boundingBox())!;
      if (width >= 768) {
        expect(deckBox.x + deckBox.width).toBeLessThanOrEqual(recentBox.x + 1);
        const panelBox = (await deck.locator("..").boundingBox())!;
        expect(panelBox.height).toBeLessThanOrEqual(
          Math.max(deckBox.height, recentBox.height) + 65,
        );
        await expect(
          deck.locator(".financial-carousel-controls"),
        ).toBeVisible();
      } else {
        expect(deckBox.y + deckBox.height).toBeLessThanOrEqual(recentBox.y + 1);
        expect(recentBox.y - (deckBox.y + deckBox.height)).toBeLessThanOrEqual(
          35,
        );
        await expect(
          deck.locator(".financial-carousel-controls"),
        ).not.toBeVisible();
      }
    }
    const dir = `docs/accounts-redesign-review/screenshots/after/${width}px`;
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: `${dir}/overview.png`,
      fullPage: width === 390 || width === 1440,
    });
    await open(page, `/accounts/${f.bank.id}`);
    await expect(
      page.getByRole("heading", { name: "Statement history", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await noDuplicatePanels(page);
    if (width <= 430) {
      const nav = page.getByRole("navigation", {
        name: "Mobile navigation",
        exact: true,
      });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole("button", { name: /Add/ })).toBeVisible();
      const last = history(page, f.bank.id)
        .locator("[data-transaction-id]")
        .last();
      await last.scrollIntoViewIfNeeded();
      const lastBox = (await last.boundingBox())!;
      const navBox = (await nav.boundingBox())!;
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y + 1);
    }
    await page.screenshot({ path: `${dir}/bank-details.png`, fullPage: true });
    if (width === 390 || width === 1440) {
      for (const item of kinds.slice(1)) {
        await open(page, `/accounts/${f[item.first].id}`);
        await page.screenshot({
          path: `${dir}/${item.file}-details.png`,
          fullPage: true,
        });
      }
    }
    state.unchanged();
  });
}
