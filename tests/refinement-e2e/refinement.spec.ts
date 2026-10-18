import { test, expect, type Locator, type Page } from "@playwright/test";
import { mockWorkspace, syntheticId, workspaceFixture } from "./fixture";

test.use({ hasTouch: true });

const widths = [320, 360, 375, 390, 430, 768, 1024, 1440, 1920];
const surfaces = [
  ["/dashboard", "Home"],
  ["/accounts", "Accounts"],
  ["/analytics", "Analytics"],
  ["/profile", "Profile"],
  ["/transactions", "Transactions"],
] as const;
const kinds = [
  {
    kind: "bank",
    name: "Bank accounts",
    filter: /^Bank$/i,
    control: "bank account",
    offset: 100,
    label: "bank",
  },
  {
    kind: "credit_card",
    name: "Credit cards",
    filter: /^(Cards|Credit cards?)$/i,
    control: "credit card",
    offset: 200,
    label: "card",
  },
] as const;

async function openSurface(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

function activeCard(carousel: Locator) {
  return carousel.locator('[data-selected="true"] .virtual-account-card');
}

async function selectFilter(page: Page, filter: RegExp) {
  await page
    .locator("main")
    .getByRole("button", { name: filter, exact: true })
    .click();
}

async function assertSelection(
  page: Page,
  carousel: Locator,
  accountId: string,
  label: string,
  index: number,
  count = 4,
) {
  await expect(carousel).toHaveAttribute("data-selected-account-id", accountId);
  await expect(activeCard(carousel)).toContainText(
    `Synthetic ${label} ${index}`,
  );
  const history = page.locator(
    `.recent-account-transactions[data-account-id="${accountId}"]`,
  );
  await expect(history).toBeVisible();
  const rows = history.locator("[data-transaction-id]");
  await expect(rows).toHaveCount(count);
  await expect(rows).toHaveText(
    Array.from(
      { length: count },
      (_, position) =>
        new RegExp(`Synthetic ${label} ${index} activity ${7 - position}`),
    ),
  );
  await expect(
    history.getByRole("link", { name: "View all", exact: true }),
  ).toHaveAttribute("href", `/transactions?account=${accountId}&period=all`);
}

async function horizontalTouch(page: Page, track: Locator, forward = true) {
  await track.scrollIntoViewIfNeeded();
  const box = (await track.boundingBox())!;
  const left = box.x + box.width * 0.15;
  const right = box.x + box.width * 0.85;
  const y = box.y + Math.min(80, box.height / 2);
  const session = await page.context().newCDPSession(page);
  const start = forward ? right : left;
  const end = forward ? left : right;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start, y }],
  });
  for (let i = 1; i <= 12; i++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start + ((end - start) * i) / 12, y }],
    });
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}

async function verticalTouch(page: Page, track: Locator) {
  const box = (await track.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height - 20, 140);
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 12; i++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - i * 12 }],
    });
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}

for (const width of widths) {
  test(`${width}px main pages have contextual headers, safe navigation and no document overflow`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(context, page, baseURL!);
    await page.setViewportSize({ width, height: width <= 760 ? 844 : 1000 });
    for (const [path, title] of surfaces) {
      await openSurface(page, path);
      if (title !== "Home")
        await expect(page.locator("main h1")).toHaveText(title);
      await expect(
        page.getByText("YOUR MONEY, IN PERSPECTIVE", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("The details that keep your finances in balance.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.locator('input[type="month"]:visible')).toHaveCount(
        title === "Analytics" ? 1 : 0,
      );
      await noOverflow(page);
      const nav = page.getByRole("navigation", {
        name: "Mobile navigation",
        exact: true,
      });
      if (width <= 760) {
        await expect(nav).toBeVisible();
        await expect(nav.locator(".bottom-bar-item")).toHaveText([
          "Home",
          "Accounts",
          "Add",
          "Analytics",
          "Profile",
        ]);
        await expect(
          page.getByRole("button", { name: "Open navigation", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: "Your profile", exact: true }),
        ).toHaveCount(0);
        if (title !== "Transactions") {
          await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
          await expect(
            nav.getByRole("link", { name: title, exact: true }),
          ).toHaveAttribute("aria-current", "page");
        }
        for (const item of await nav.locator(".bottom-bar-item").all())
          expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(
          page
            .locator("main button:visible")
            .filter({ hasText: /^Add Transaction$/i }),
        ).toHaveCount(0);
        if (!["Transactions"].includes(title))
          await expect(
            page
              .locator("main")
              .getByRole("link", { name: "Import", exact: true }),
          ).toHaveCount(0);
      } else {
        await expect(nav).toBeHidden();
        await expect(page.locator(".desktop-sidebar")).toBeVisible();
      }
      if (title !== "Home")
        await expect(
          page.locator(
            ".nestbot-floating-button:visible, .nestbot-floating-container:visible",
          ),
        ).toHaveCount(0);
    }
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

for (const item of kinds) {
  for (const count of [0, 1, 2, 6]) {
    test(`${item.name} handles ${count} active records with finite boundaries and ID-synced history`, async ({
      context,
      page,
      baseURL,
    }) => {
      const data = workspaceFixture(count);
      data.accounts = data.accounts.filter((account) => account.active);
      const fixture = await mockWorkspace(context, page, baseURL!, data);
      await page.setViewportSize({ width: 390, height: 844 });
      await openSurface(page, "/accounts");
      await selectFilter(page, item.filter);
      const carousel = region(page, item.name);
      if (!count) {
        await expect(carousel).toBeVisible();
        await expect(carousel.locator(".financial-carousel-slide")).toHaveCount(
          0,
        );
        await expect(carousel).toContainText(/No accounts in this group yet/i);
        await expect(carousel.getByRole("button")).toHaveCount(0);
        await expect(page.locator(".recent-account-transactions")).toHaveCount(
          0,
        );
      } else {
        await expect(carousel).toBeVisible();
        await expect(carousel).toHaveAttribute(
          "aria-roledescription",
          "carousel",
        );
        await assertSelection(
          page,
          carousel,
          syntheticId(item.offset),
          item.label,
          1,
        );
        const previous = carousel.getByRole("button", {
          name: `Previous ${item.control}`,
          exact: true,
        });
        const next = carousel.getByRole("button", {
          name: `Next ${item.control}`,
          exact: true,
        });
        if (count === 1) {
          for (const button of [previous, next]) {
            if (await button.count()) await expect(button).toBeDisabled();
          }
          await horizontalTouch(
            page,
            carousel.locator(".financial-carousel-track"),
          );
          await horizontalTouch(
            page,
            carousel.locator(".financial-carousel-track"),
            false,
          );
          await expect(carousel).toHaveAttribute(
            "data-selected-account-id",
            syntheticId(item.offset),
          );
        } else {
          await expect(previous).toBeDisabled();
          for (let i = 1; i < count; i++) {
            await next.click();
            await assertSelection(
              page,
              carousel,
              syntheticId(item.offset + i),
              item.label,
              i + 1,
            );
          }
          await expect(next).toBeDisabled();
          await carousel.locator(".financial-carousel-track").focus();
          await page.keyboard.press("ArrowRight");
          await expect(carousel).toHaveAttribute(
            "data-selected-account-id",
            syntheticId(item.offset + count - 1),
          );
          for (let i = count - 2; i >= 0; i--) {
            await previous.click();
            await assertSelection(
              page,
              carousel,
              syntheticId(item.offset + i),
              item.label,
              i + 1,
            );
          }
          await expect(previous).toBeDisabled();
          await expect(activeCard(carousel)).toHaveAttribute(
            "href",
            `/accounts/${syntheticId(item.offset)}`,
          );
        }
      }
      expect(fixture.writes).toEqual([]);
      expect(fixture.errors).toEqual([]);
      expect(fixture.unexpectedApis).toEqual([]);
    });
  }

  test.describe(`${item.name} native mobile gestures`, () => {
    test.use({ isMobile: true });
    test(`${item.name} supports native horizontal touch, local keyboard focus and accurate View all`, async ({
      context,
      page,
      baseURL,
    }) => {
      const fixture = await mockWorkspace(
        context,
        page,
        baseURL!,
        workspaceFixture(2),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await openSurface(page, "/accounts");
      await selectFilter(page, item.filter);
      const carousel = region(page, item.name);
      const track = carousel.locator(".financial-carousel-track");
      expect(
        await track.evaluate(
          (element) => getComputedStyle(element).scrollSnapType,
        ),
      ).toMatch(/x mandatory/);
      await horizontalTouch(page, track);
      await assertSelection(
        page,
        carousel,
        syntheticId(item.offset + 1),
        item.label,
        2,
      );
      await horizontalTouch(page, track);
      await expect(carousel).toHaveAttribute(
        "data-selected-account-id",
        syntheticId(item.offset + 1),
      );
      await horizontalTouch(page, track, false);
      await assertSelection(
        page,
        carousel,
        syntheticId(item.offset),
        item.label,
        1,
      );
      await horizontalTouch(page, track, false);
      await expect(carousel).toHaveAttribute(
        "data-selected-account-id",
        syntheticId(item.offset),
      );
      await track.scrollIntoViewIfNeeded();
      const beforeScroll = await page.evaluate(() => window.scrollY);
      await verticalTouch(page, track);
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(beforeScroll);
      await expect(carousel).toHaveAttribute(
        "data-selected-account-id",
        syntheticId(item.offset),
      );
      await page.locator("main h1").click();
      await page.keyboard.press("ArrowRight");
      await expect(carousel).toHaveAttribute(
        "data-selected-account-id",
        syntheticId(item.offset),
      );
      await track.focus();
      await page.keyboard.press("ArrowRight");
      await assertSelection(
        page,
        carousel,
        syntheticId(item.offset + 1),
        item.label,
        2,
      );
      await page.keyboard.press("ArrowLeft");
      await assertSelection(
        page,
        carousel,
        syntheticId(item.offset),
        item.label,
        1,
      );
      await carousel
        .getByRole("button", { name: `Next ${item.control}`, exact: true })
        .click();
      const history = page.locator(
        `.recent-account-transactions[data-account-id="${syntheticId(item.offset + 1)}"]`,
      );
      await history
        .getByRole("link", { name: "View all", exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(
          `/transactions\\?account=${syntheticId(item.offset + 1)}&period=all$`,
        ),
      );
      await expect(
        page.getByLabel("Filter account", { exact: true }),
      ).toHaveValue(syntheticId(item.offset + 1));
      const rows = page.locator(".transaction-table tbody tr");
      await expect(rows).toHaveCount(7);
      for (const row of await rows.all())
        await expect(row).toContainText(`Synthetic ${item.label} 2 activity`);
      await expect(page.getByLabel("All dates", { exact: true })).toBeChecked();
      expect(fixture.writes).toEqual([]);
      expect(fixture.errors).toEqual([]);
      expect(fixture.unexpectedApis).toEqual([]);
    });
  });

  test(`${item.name} keeps selected ID across reorder, resize, removal and archival`, async ({
    context,
    page,
    baseURL,
  }) => {
    const data = workspaceFixture(6);
    const fixture = await mockWorkspace(context, page, baseURL!, data, {
      backend: "supabase",
    });
    await openSurface(page, "/accounts");
    await selectFilter(page, item.filter);
    const carousel = region(page, item.name);
    await carousel
      .getByRole("button", { name: `Next ${item.control}`, exact: true })
      .click();
    const selectedId = syntheticId(item.offset + 1);
    await assertSelection(page, carousel, selectedId, item.label, 2);
    data.accounts.reverse();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(carousel).toHaveAttribute(
      "data-selected-account-id",
      selectedId,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(carousel).toHaveAttribute(
      "data-selected-account-id",
      selectedId,
    );
    data.accounts = data.accounts.filter(
      (account) => account.id !== selectedId,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(carousel).not.toHaveAttribute(
      "data-selected-account-id",
      selectedId,
    );
    const survivor = await carousel.getAttribute("data-selected-account-id");
    expect(
      data.accounts.some(
        (account) =>
          account.id === survivor &&
          account.active &&
          account.kind === item.kind,
      ),
    ).toBe(true);
    data.accounts.find((account) => account.id === survivor)!.active = false;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(carousel).not.toHaveAttribute(
      "data-selected-account-id",
      survivor!,
    );
    await expect(page.locator("main")).toContainText(/Archived/i);
    const archivedId = await carousel.getAttribute("data-selected-account-id");
    expect(
      data.accounts.some(
        (account) =>
          account.id === archivedId &&
          account.active &&
          account.kind === item.kind,
      ),
    ).toBe(true);
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
  });

  test(`${item.name} deep-link selector stays in category and replaces accidental swipe history`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(
      context,
      page,
      baseURL!,
      workspaceFixture(2),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await openSurface(page, "/accounts");
    await selectFilter(page, item.filter);
    await activeCard(region(page, item.name)).click();
    await expect(page).toHaveURL(
      new RegExp(`/accounts/${syntheticId(item.offset)}$`),
    );
    const carousel = region(page, item.name);
    await carousel
      .getByRole("button", { name: `Next ${item.control}`, exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/accounts/${syntheticId(item.offset + 1)}$`),
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `Synthetic ${item.label} 2`,
    );
    await expect(carousel).toHaveAttribute(
      "data-selected-account-id",
      syntheticId(item.offset + 1),
    );
    const rows = page.locator(".transaction-table tbody tr");
    await expect(rows).toHaveCount(7);
    for (const row of await rows.all())
      await expect(row).toContainText(`Synthetic ${item.label} 2 activity`);
    await expect(
      page.getByRole("button", { name: "Edit account", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reported snapshot", exact: true }),
    ).toBeVisible();
    if (item.kind === "credit_card")
      await expect(
        page.getByRole("button", { name: "Record repayment", exact: true }),
      ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/accounts$/);
    await openSurface(page, `/accounts/${syntheticId(999999)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Account details",
    );
    await expect(page.getByRole("link", { name: /^Back/i })).toHaveCount(1);
    await expect(page.locator("main")).toContainText("Account not found");
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
  });
}

test("kind changes restore a stable category account and preserve archive/deep account actions", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(context, page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await openSurface(page, "/accounts");
  await selectFilter(page, /^Bank$/i);
  const bank = region(page, "Bank accounts");
  await bank
    .getByRole("button", { name: "Next bank account", exact: true })
    .click();
  await selectFilter(page, /^(Cards|Credit cards?)$/i);
  const credit = region(page, "Credit cards");
  await expect(credit).toHaveAttribute(
    "data-selected-account-id",
    syntheticId(200),
  );
  await expect(bank).toHaveCount(0);
  await selectFilter(page, /^Bank$/i);
  const selectedId = await bank.getAttribute("data-selected-account-id");
  expect([syntheticId(100), syntheticId(101)]).toContain(selectedId);
  await expect(page.locator("main")).toContainText("Synthetic archived bank");
  await activeCard(bank).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${selectedId}$`));
  await expect(
    page.getByRole("button", { name: /Edit account/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reported snapshot", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Account history", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Back/i })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^Back/i })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/accounts$/);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`${width}px dashboard account dialogs select IDs and retain focus, vertical scrolling and real data`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(context, page, baseURL!);
    await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
    await openSurface(page, "/dashboard");
    for (const [item, opener, title] of [
      [kinds[0], "Total bank balance details", "Bank balance details"],
      [kinds[1], "Credit cards details", "Credit card details"],
    ] as const) {
      const trigger = page.getByRole("button", {
        name: opener,
        exact: true,
        includeHidden: true,
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      const carousel = dialog.getByRole("region", {
        name: item.name,
        exact: true,
      });
      await assertSelection(
        page,
        carousel,
        syntheticId(item.offset),
        item.label,
        1,
        5,
      );
      await carousel
        .getByRole("button", { name: `Next ${item.control}`, exact: true })
        .click();
      await assertSelection(
        page,
        carousel,
        syntheticId(item.offset + 1),
        item.label,
        2,
        5,
      );
      await expect(dialog).toBeVisible();
      await expect(activeCard(carousel)).toContainText("₹1,100.00");
      const track = carousel.locator(".financial-carousel-track");
      await track.focus();
      await page.keyboard.press("ArrowRight");
      await expect(carousel).toHaveAttribute(
        "data-selected-account-id",
        syntheticId(item.offset + 2),
      );
      await expect(activeCard(carousel)).toContainText(
        /At least|Unknown|Not reported/i,
      );
      if (width >= 760) {
        await track.hover();
        await page.mouse.wheel(0, 180);
        await expect(carousel).toHaveAttribute(
          "data-selected-account-id",
          syntheticId(item.offset + 2),
        );
      }
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      if (width < 760) {
        await track.scrollIntoViewIfNeeded();
        const scrollContainer = dialog.locator(".financial-details-body");
        const before = await scrollContainer.evaluate(
          (element) => element.scrollTop,
        );
        const selected = await carousel.getAttribute(
          "data-selected-account-id",
        );
        await verticalTouch(page, track);
        await expect
          .poll(() => scrollContainer.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(before);
        await expect(carousel).toHaveAttribute(
          "data-selected-account-id",
          selected!,
        );
      }
      await noOverflow(page);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
  });
}

for (const [path, title] of surfaces) {
  test(`mobile center Add saves exactly once from ${title}`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(context, page, baseURL!);
    const before = fixture.data.transactions.length;
    await page.setViewportSize({ width: 390, height: 844 });
    await openSurface(page, path);
    await page
      .getByRole("navigation", { name: "Mobile navigation", exact: true })
      .getByRole("button", { name: "Add transaction", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Add New Expense",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await editor.locator('input[name="amount"]').fill("12.34");
    await editor
      .locator('textarea[name="description"]')
      .fill(`Synthetic center add ${title}`);
    await editor
      .locator('select[name="fromAccountId"]')
      .selectOption(syntheticId(100));
    await editor.locator('input[name="occurredOn"]').fill("2026-10-18");
    await editor
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.data.transactions).toHaveLength(before + 1);
    expect(
      fixture.data.transactions.filter(
        (transaction) =>
          transaction.description === `Synthetic center add ${title}`,
      ),
    ).toHaveLength(1);
    expect(fixture.errors).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
  });
}

test("Analytics selected month remains functional while current balances stay current", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(context, page, baseURL!);
  await openSurface(page, "/dashboard");
  const current = await page
    .locator(".dashboard-card-bank > strong")
    .innerText();
  await page
    .getByRole("link", { name: "Analytics", exact: true })
    .first()
    .click();
  const netSpending = page
    .locator(".analytics-summary-refined .stat")
    .filter({ hasText: "Net spending" })
    .locator(":scope > strong");
  await expect(netSpending).not.toHaveText("₹0.00");
  await page.getByLabel("Selected month", { exact: true }).fill("2026-09");
  await expect(netSpending).toHaveText("₹0.00");
  await page.locator('.desktop-sidebar a[href="/dashboard"]').first().click();
  await expect(page.locator(".dashboard-card-bank > strong")).toHaveText(
    current,
  );
  await expect(page.locator('input[type="month"]')).toHaveCount(0);
  await expect(page.locator(".dashboard-card-bank")).not.toContainText(
    "September",
  );
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
});

test("recent history associates by account and owner IDs and keeps partial credit honest", async ({
  context,
  page,
  baseURL,
}) => {
  const data = workspaceFixture();
  data.transactions.push({
    ...data.transactions[0],
    id: syntheticId(99999),
    userId: syntheticId(999),
    fromAccountId: syntheticId(100),
    toAccountId: null,
    occurredOn: "2026-10-18",
    description: "Forbidden other owner record",
  });
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await openSurface(page, "/accounts");
  await selectFilter(page, /^Bank$/i);
  await assertSelection(
    page,
    region(page, "Bank accounts"),
    syntheticId(100),
    "bank",
    1,
  );
  await expect(
    page.locator(
      `.recent-account-transactions[data-account-id="${syntheticId(100)}"]`,
    ),
  ).not.toContainText("Forbidden other owner record");
  await selectFilter(page, /^(Cards|Credit cards?)$/i);
  const carousel = region(page, "Credit cards");
  await carousel
    .getByRole("button", { name: "Next credit card", exact: true })
    .click();
  await carousel
    .getByRole("button", { name: "Next credit card", exact: true })
    .click();
  await expect(
    activeCard(carousel).locator(".virtual-account-primary strong"),
  ).toHaveText("Not reported");
  await expect(
    activeCard(carousel).locator(".virtual-account-credit-facts"),
  ).toContainText("Unknown");
  await expect(
    activeCard(carousel).locator(".virtual-account-bill"),
  ).toContainText("Statement ₹220");
  await expect(activeCard(carousel).locator(".usage-meter")).toHaveCount(0);
  await expect(activeCard(carousel)).not.toContainText("₹9,780.00");
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
});

test("compact cards contain long names and signed large balances without exposing full identifiers", async ({
  context,
  page,
  baseURL,
}) => {
  const data = workspaceFixture(2);
  const bank = data.accounts.find(
    (account) => account.id === syntheticId(100),
  )!;
  bank.name =
    "Synthetic very long bank account name for responsive overflow verification";
  bank.institution =
    "QA Synthetic Institution With A Deliberately Very Long Display Name";
  bank.maskedSuffix = "1234567890123456";
  data.snapshots.find(
    (snapshot) => snapshot.accountId === bank.id,
  )!.reportedBalance = "-1234567890123.45";
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
    await openSurface(page, "/accounts");
    await selectFilter(page, /^Bank$/i);
    const carousel = region(page, "Bank accounts");
    await expect(activeCard(carousel)).toContainText(bank.name);
    await expect(activeCard(carousel)).toContainText("••3456");
    await expect(activeCard(carousel)).not.toContainText("1234567890123456");
    await expect(activeCard(carousel).locator("button, a")).toHaveCount(0);
    await expect(
      activeCard(carousel).locator(".virtual-account-primary strong"),
    ).toContainText("−₹12,34,56,78,90,123.45");
    await noOverflow(page);
  }
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
});

test("Profile hub retains every existing finance destination and proper secondary Back", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(context, page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await openSurface(page, "/profile");
  const main = page.locator("main");
  for (const href of [
    "/accounts",
    "/transactions",
    "/bills",
    "/pay-later",
    "/fixed-deposits",
    "/loans",
    "/split-bills",
    "/imports",
    "/settings",
    "/notifications",
    "/orders",
  ]) {
    await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
  await expect(
    main.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await main.locator('a[href="/bills"]').first().click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByRole("link", { name: /^Back/i })).toBeVisible();
  await expect(page.locator('input[type="month"]')).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
});

test("reduced motion, empty account history and keyboard selection remain accessible", async ({
  context,
  page,
  baseURL,
}) => {
  const data = workspaceFixture(2);
  data.transactions = [];
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSurface(page, "/accounts");
  await selectFilter(page, /^Bank$/i);
  const carousel = region(page, "Bank accounts");
  const track = carousel.locator(".financial-carousel-track");
  expect(
    await track.evaluate((element) => getComputedStyle(element).scrollBehavior),
  ).not.toBe("smooth");
  await track.focus();
  await page.keyboard.press("End");
  await expect(carousel).toHaveAttribute(
    "data-selected-account-id",
    syntheticId(101),
  );
  await page.keyboard.press("Home");
  await expect(carousel).toHaveAttribute(
    "data-selected-account-id",
    syntheticId(100),
  );
  await expect(
    page.locator(
      `.recent-account-transactions[data-account-id="${syntheticId(100)}"]`,
    ),
  ).toContainText("No transactions recorded for this account yet.");
  await expect(carousel.locator('[aria-live="polite"]')).toContainText(
    /1 of 2/,
  );
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`${width}px NestBot is a single safe dialog and retains real chat/error and scanner handoff`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(context, page, baseURL!);
    const requests: { action: string; message: string; image?: unknown }[] = [];
    await page.route("**/api/ai/bot", async (route) => {
      const request = route.request().postDataJSON() as {
        action: string;
        message: string;
        image?: unknown;
      };
      requests.push(request);
      if (requests.length === 1)
        return route.fulfill({
          status: 200,
          json: {
            configured: true,
            reply: "Synthetic response; nothing was posted.",
            message: {
              id: "synthetic-bot-reply",
              role: "assistant",
              content: "Synthetic response; nothing was posted.",
              createdAt: "2026-10-18T06:30:00Z",
            },
          },
        });
      return route.fulfill({
        status: 503,
        json: { error: "Synthetic provider unavailable. Please try again." },
      });
    });
    await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
    await openSurface(page, "/dashboard");
    const opener = page.getByRole("button", {
      name: "Open Money Nest Bot",
      exact: true,
      includeHidden: true,
    });
    await expect(opener).toHaveCount(1);
    const openerBox = (await opener.boundingBox())!;
    expect(openerBox.width).toBeGreaterThanOrEqual(44);
    expect(openerBox.height).toBeGreaterThanOrEqual(44);
    if (width < 760) {
      const navBox = (await page
        .getByRole("navigation", { name: "Mobile navigation", exact: true })
        .boundingBox())!;
      expect(openerBox.y + openerBox.height).toBeLessThan(navBox.y);
    }
    await opener.click();
    const bot = page.getByRole("dialog", {
      name: "Money Nest Bot",
      exact: true,
    });
    await expect(bot).toBeVisible();
    const input = bot.getByRole("textbox", {
      name: "Message NestBot",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill("Synthetic balance question");
    await input.press("Enter");
    await expect(
      bot.getByRole("log", { name: "NestBot conversation", exact: true }),
    ).toContainText("Synthetic response; nothing was posted.");
    await input.fill("Synthetic unavailable request");
    await input.press("Enter");
    await expect(
      bot.getByRole("log", { name: "NestBot conversation", exact: true }),
    ).toContainText("Synthetic provider unavailable. Please try again.");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await bot.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(bot).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await bot
      .getByRole("button", { name: "Upload receipt screenshot", exact: true })
      .click();
    await expect(bot).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Add New Expense", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Add New Expense", exact: true })
      .getByRole("button", { name: "Upload Image", exact: true })
      .click();
    await expect(page.locator(".receipt-modal")).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (request) => request.action === "chat" && request.image === undefined,
      ),
    ).toBe(true);
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
  });
}
