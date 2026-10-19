import { test, expect, type Locator, type Page } from "@playwright/test";
import { analyticsFixture, ids, mockWorkspace, syntheticId } from "./fixture";

async function openAnalytics(page: Page) {
  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.analytics-workspace .spending-chart [data-date="2026-10-09"]')
      .first(),
  ).toBeVisible();
}

async function openDay(page: Page, date: string) {
  await page
    .locator(`.analytics-workspace .spending-chart [data-date="${date}"]`)
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

function activeCard(carousel: Locator) {
  return carousel.locator('[data-selected="true"] .virtual-account-card');
}

function faceMetric(card: Locator, metric: "outstanding" | "available") {
  return card.locator(
    `.virtual-account-face-metrics [data-metric="${metric}"]`,
  );
}

async function swipe(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const start = box.x + box.width * 0.85;
  const end = box.x + box.width * 0.15;
  const y = box.y + Math.min(90, box.height / 2);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start, y }],
  });
  for (let step = 1; step <= 12; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start + ((end - start) * step) / 12, y }],
    });
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}

for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
  test(`${width}px analytics, date sheet and debt dialogs fit the viewport`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(
      context,
      page,
      baseURL!,
      analyticsFixture(),
    );
    await page.setViewportSize({ width, height: width <= 760 ? 844 : 1000 });
    await openAnalytics(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    const dialog = await openDay(page, "2026-10-09");
    await expect(dialog).toContainText("9 Oct 2026");
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
    if (width <= 760) {
      const dayZ = await dialog.evaluate((node) =>
        Number(getComputedStyle(node).zIndex),
      );
      const navZ = await page
        .getByRole("navigation", {
          name: "Mobile navigation",
          exact: true,
          includeHidden: true,
        })
        .evaluate((node) => Number(getComputedStyle(node).zIndex));
      expect(dayZ).toBeGreaterThan(navZ);
    }
    await page.keyboard.press("Escape");
    await page.goto("/accounts");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    await page.goto("/dashboard");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    for (const label of ["Credit cards details", "Pay Later details"]) {
      const trigger = page.getByRole("button", { name: label, exact: true });
      if (width === 390)
        expect((await trigger.boundingBox())!.height).toBeLessThanOrEqual(320);
      await trigger.click();
      const debt = page.getByRole("dialog");
      await expect(debt).toBeVisible();
      const debtBox = (await debt.boundingBox())!;
      expect(debtBox.x).toBeGreaterThanOrEqual(-1);
      expect(debtBox.x + debtBox.width).toBeLessThanOrEqual(width + 1);
      expect(
        await debt.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      const face = activeCard(debt.locator(".financial-carousel"));
      await expect(faceMetric(face, "outstanding")).toBeVisible();
      await expect(faceMetric(face, "available")).toBeVisible();
      const faceBox = (await face
        .locator(".virtual-account-face")
        .boundingBox())!;
      const identityBox = (await face
        .locator(".virtual-account-face-bottom")
        .boundingBox())!;
      for (const metric of ["outstanding", "available"] as const) {
        const metricBox = (await faceMetric(face, metric).boundingBox())!;
        expect(metricBox.x).toBeGreaterThanOrEqual(faceBox.x);
        expect(metricBox.x + metricBox.width).toBeLessThanOrEqual(
          faceBox.x + faceBox.width + 1,
        );
        expect(metricBox.y + metricBox.height).toBeLessThanOrEqual(
          identityBox.y + 1,
        );
      }
      await page.keyboard.press("Escape");
    }
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("daily gross popup uses exact ISO date and excludes pending, voided and movement-only records", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  const dialog = await openDay(page, "2026-10-09");
  await expect(dialog.getByTestId("daily-spending-total")).toHaveText(
    "₹350.50",
  );
  const rows = dialog.locator(".daily-spending-transaction");
  await expect(rows).toHaveCount(2);
  await expect(
    dialog.locator(`[data-transaction-id="${ids.food}"]`),
  ).toContainText(/QA (Cafe|Lunch)/);
  await expect(
    dialog.locator(`[data-transaction-id="${ids.shopping}"]`),
  ).toContainText("₹250.50");
  await expect(dialog).toContainText("Food");
  await expect(dialog).toContainText("QA Verified Card");
  for (const excluded of [
    "Pending excluded",
    "Voided excluded",
    "Transfer excluded",
    "Repayment excluded",
    "Undated excluded",
  ])
    await expect(dialog).not.toContainText(excluded);
  await dialog.getByRole("link", { name: /View all transactions/i }).click();
  await expect(page).toHaveURL(/\/transactions\?/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/transactions");
  expect(url.searchParams.get("date")).toBe("2026-10-09");
  expect(url.searchParams.get("period")).toBe("all");
  await expect(page.locator(".transaction-table")).toContainText("QA Lunch");
  await expect(page.locator(".transaction-table")).not.toContainText(
    "QA Metro",
  );
  // The saved-date ledger is intentionally complete, including pending and movement records.
  await expect(page.locator(".transaction-table")).toContainText(
    "QA Pending excluded",
  );
  expect(fixture.writes).toEqual([]);
});

test("net mode attributes refunds on their recorded date and explains negative daily spending", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  await page
    .getByRole("combobox", { name: "Spending display", exact: true })
    .selectOption("net");
  const dialog = await openDay(page, "2026-10-10");
  await expect(dialog.getByTestId("daily-spending-total")).toHaveText(
    /-₹90\.00|₹-90\.00|−₹90\.00/,
  );
  await expect(dialog).toContainText("₹30.00");
  await expect(dialog).toContainText("₹120.00");
  await expect(dialog).toContainText(/refunds?.*(exceed|greater)|negative/i);
  await expect(dialog.locator(".daily-spending-transaction")).toHaveCount(2);
  await expect(
    dialog.locator(`[data-transaction-id="${ids.refund}"]`),
  ).toContainText("QA Supplies refund");
  await expect(dialog).not.toContainText("QA Lunch");
  await page.keyboard.press("Escape");
  await page
    .getByRole("combobox", { name: "Spending display", exact: true })
    .selectOption("gross");
  const gross = await openDay(page, "2026-10-10");
  await expect(gross.getByTestId("daily-spending-total")).toHaveText("₹30.00");
  expect(fixture.writes).toEqual([]);
});

test("cross-month refund cap keeps full saved refund distinct from its net-spending contribution", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  await page
    .getByRole("combobox", { name: "Spending display", exact: true })
    .selectOption("net");
  const dialog = await openDay(page, "2026-10-12");
  await expect(dialog.getByTestId("daily-spending-total")).toHaveText(
    /-₹400\.00|₹-400\.00|−₹400\.00/,
  );
  const refund = dialog.locator(`[data-transaction-id="${ids.cappedRefund}"]`);
  await expect(refund).toContainText("₹1,000.00");
  await expect(refund).toContainText("₹400.00");
  await expect(dialog).toContainText("₹600.00");
  await expect(dialog).not.toContainText("QA Unmatched refund");
  await page.keyboard.press("Escape");
  const exhausted = await openDay(page, "2026-10-14");
  await expect(exhausted.getByTestId("daily-spending-total")).toHaveText(
    "₹0.00",
  );
  await expect(exhausted).toContainText("₹50.00");
  expect(fixture.writes).toEqual([]);
});

test("empty dates and month changes retain complete source dates", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  const empty = await openDay(page, "2026-10-11");
  await expect(empty.getByTestId("daily-spending-total")).toHaveText("₹0.00");
  await expect(empty).toContainText(
    /no (posted|qualifying|spending|transactions)/i,
  );
  await expect(empty.locator(".daily-spending-transaction")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator('input[type="month"]').fill("2026-09");
  const september = await openDay(page, "2026-09-25");
  await expect(september).toContainText("25 Sept 2026");
  await expect(september.getByTestId("daily-spending-total")).toHaveText(
    "₹600.00",
  );
  await expect(september).not.toContainText("QA Lunch");
  expect(fixture.writes).toEqual([]);
});

// Current editors reject this chronology. The injected legacy/malformed payload
// checks read-only selector presentation without weakening write validation.
test("defensive legacy refund chronology keeps saved date distinct from net recognition", async ({
  context,
  page,
  baseURL,
}) => {
  const data = analyticsFixture();
  const purchaseId = syntheticId(94001);
  const refundId = syntheticId(94002);
  data.transactions.push(
    {
      ...data.transactions[0],
      id: purchaseId,
      occurredOn: "2026-10-16",
      description: "QA Later dated purchase",
      merchant: null,
      amount: "150.00",
      fromAccountId: ids.bank,
    },
    {
      ...data.transactions[0],
      id: refundId,
      occurredOn: "2026-10-15",
      description: "QA Earlier dated refund",
      merchant: null,
      amount: "70.00",
      kind: "refund",
      fromAccountId: null,
      toAccountId: ids.bank,
      refundOfTransactionId: purchaseId,
    },
  );
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await openAnalytics(page);
  await page
    .getByRole("combobox", { name: "Spending display", exact: true })
    .selectOption("net");
  const recorded = await openDay(page, "2026-10-15");
  await expect(recorded.getByTestId("daily-spending-total")).toHaveText(
    "₹0.00",
  );
  const recordedRefund = recorded.locator(
    `[data-transaction-id="${refundId}"]`,
  );
  await expect(recordedRefund).toContainText("₹0.00 applied");
  await expect(recordedRefund).toContainText(
    "₹70.00 not applied to this day’s net spending",
  );
  await expect(recordedRefund).not.toContainText(/exceeds/i);
  await page.keyboard.press("Escape");
  const recognized = await openDay(page, "2026-10-16");
  await expect(recognized.getByTestId("daily-spending-total")).toHaveText(
    "₹80.00",
  );
  const recognizedRefund = recognized.locator(
    `[data-transaction-id="${refundId}"]`,
  );
  await expect(recognizedRefund).toContainText("₹70.00 applied");
  await expect(recognizedRefund).toContainText("15 Oct 2026");
  await expect(recognizedRefund).toContainText(
    /recognized when the linked purchase/i,
  );
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("transaction row opens the existing review editor without saving", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  const dialog = await openDay(page, "2026-10-09");
  await dialog.locator(`[data-transaction-id="${ids.food}"]`).click();
  await expect(
    page.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue("QA Lunch");
  await page.keyboard.press("Escape");
  expect(fixture.writes).toEqual([]);
});

test("chart keyboard navigation opens a day, restores focus, and uses a restrained green indicator", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  const svg = page.locator(".analytics-workspace .recharts-surface").first();
  await svg.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const outline = await svg.evaluate((node) => ({
    color: getComputedStyle(node).outlineColor,
    width: parseFloat(getComputedStyle(node).outlineWidth),
    style: getComputedStyle(node).outlineStyle,
    role: node.getAttribute("role"),
    tabindex: node.getAttribute("tabindex"),
  }));
  expect(outline.role).toBe("application");
  expect(outline.tabindex).toBe("0");
  expect(outline.width).toBeLessThanOrEqual(2);
  expect(outline.color).not.toBe("rgb(16, 16, 16)");
  expect(outline.style).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("3 Oct 2026");
  await page.keyboard.press("Escape");
  await expect(svg).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(svg).toBeVisible();
  await openDay(page, "2026-10-09");
  await expect(
    page.getByRole("dialog").getByTestId("daily-spending-total"),
  ).toHaveText("₹350.50");
  expect(fixture.errors).toEqual([]);
});

test("mouse click removes chart tooltip and does not keep an oversized focus outline", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  const day = page
    .locator('.analytics-workspace .spending-chart [data-date="2026-10-09"]')
    .first();
  await day.hover();
  await expect(page.locator(".recharts-tooltip-wrapper")).toBeVisible();
  await expect(page.locator(".recharts-tooltip-wrapper")).toContainText(
    /Click to view transactions/i,
  );
  await day.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".recharts-tooltip-wrapper")).toBeHidden();
  await page.keyboard.press("Escape");
  const restoredOutline = await page
    .locator(".analytics-workspace .recharts-surface")
    .first()
    .evaluate((node) => ({
      width: parseFloat(getComputedStyle(node).outlineWidth),
      color: getComputedStyle(node).outlineColor,
    }));
  expect(restoredOutline.width).toBeLessThanOrEqual(2);
  expect(restoredOutline.color).not.toBe("rgb(16, 16, 16)");
  await page.getByRole("heading", { name: "Analytics", exact: true }).click();
  const outline = await page
    .locator(".analytics-workspace .recharts-surface")
    .first()
    .evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).toBe("none");
  expect(fixture.errors).toEqual([]);
});

test("chart tooltip, keyboard date and dialog agree after pointer hover", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  await page
    .locator('.analytics-workspace .spending-chart [data-date="2026-10-09"]')
    .first()
    .hover();
  await expect(page.locator(".recharts-tooltip-wrapper")).toBeVisible();
  await expect(page.locator(".recharts-tooltip-wrapper")).toContainText(
    "9 Oct 2026",
  );
  const chart = page.locator(".analytics-workspace .recharts-surface").first();
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  const selected = page.locator(
    '.analytics-workspace .spending-day[data-keyboard-selected="true"]',
  );
  await expect(selected).toHaveCount(1);
  const date = (await selected.getAttribute("data-date"))!;
  const fullDate = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
  await expect(page.locator(".recharts-tooltip-wrapper")).toContainText(
    fullDate,
  );
  await expect(page.locator(".recharts-tooltip-wrapper")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(fullDate);
  await page.keyboard.press("Escape");
  await expect(chart).toBeFocused();
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("largest spending day opens the same daily dialog and restores its own button focus", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  const trigger = page.locator(".analytics-insights button");
  await trigger.click();
  await expect(page.getByRole("dialog")).toContainText("9 Oct 2026");
  await expect(
    page.getByRole("dialog").getByTestId("daily-spending-total"),
  ).toHaveText("₹350.50");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("category links apply exact category, posted expense and selected-month filters", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  const category = page
    .locator('.analytics-workspace a[href*="category=Food"]')
    .first();
  await expect(category).toBeVisible();
  await category.click();
  await expect(page).toHaveURL(/\/transactions\?/);
  const url = new URL(page.url());
  for (const [key, value] of Object.entries({
    category: "Food",
    kind: "expense",
    status: "posted",
    month: "2026-10",
  }))
    expect(url.searchParams.get(key)).toBe(value);
  await expect(page.locator(".transaction-table")).toContainText("QA Lunch");
  await expect(page.locator(".transaction-table")).not.toContainText(
    "QA Supplies",
  );
  expect(fixture.writes).toEqual([]);
});

for (const item of [
  {
    id: ids.verified,
    label: "verified card",
    status: "verified",
    value: "₹8,190.60",
    outstanding: "₹1,809.40",
    outstandingStatus: "verified",
    index: 0,
  },
  {
    id: ids.estimated,
    label: "estimated card",
    status: "estimated",
    value: "₹10,000.00",
    outstanding: "₹2,000.00",
    outstandingStatus: "estimated",
    index: 1,
  },
  {
    id: ids.unknownLimit,
    label: "unknown card limit",
    status: "unknown",
    value: "Not available",
    outstanding: "₹750.00",
    outstandingStatus: "verified",
    index: 2,
  },
  {
    id: ids.payVerified,
    label: "verified Pay Later",
    status: "verified",
    value: "₹4,500.00",
    outstanding: "₹1,500.00",
    outstandingStatus: "verified",
    index: 0,
  },
  {
    id: ids.payEstimated,
    label: "estimated Pay Later",
    status: "estimated",
    value: "₹4,000.00",
    outstanding: "₹1,000.00",
    outstandingStatus: "estimated",
    index: 1,
  },
  {
    id: ids.partial,
    label: "partial Pay Later",
    status: "unknown",
    value: "Not available",
    outstanding: "At least ₹800.00",
    outstandingStatus: "partial",
    index: 2,
  },
]) {
  test(`${item.label} preserves selector availability and provenance on its virtual card`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(
      context,
      page,
      baseURL!,
      analyticsFixture(),
    );
    await page.goto(`/accounts/${item.id}`);
    const card = page.locator(
      `.financial-carousel-slide[data-account-id="${item.id}"] .virtual-account-card`,
    );
    await expect(card).toBeVisible();
    const available = faceMetric(card, "available");
    await expect(available).toHaveAttribute("data-status", item.status);
    await expect(available.locator("strong")).toHaveText(item.value);
    if (item.status === "estimated")
      await expect(available).toContainText("Estimated");
    await expect(faceMetric(card, "outstanding")).toHaveAttribute(
      "data-status",
      item.outstandingStatus,
    );
    await expect(faceMetric(card, "outstanding").locator("strong")).toHaveText(
      item.outstanding,
    );
    if (item.id === ids.partial) {
      await expect(card).toContainText(/minimum known|at least/i);
      await expect(card).not.toContainText("₹3,200");
    }
    await expect(card.locator(".virtual-account-face")).toHaveAttribute(
      "data-branding",
      "issuer-initials",
    );
    const face = (await card.locator(".virtual-account-face").boundingBox())!;
    expect(face.width / face.height).toBeGreaterThan(1.45);
    expect(face.width / face.height).toBeLessThan(1.7);
    await page.goto("/dashboard");
    const isPayLater = [
      ids.payVerified,
      ids.payEstimated,
      ids.partial,
    ].includes(item.id);
    await page
      .getByRole("button", {
        name: isPayLater ? "Pay Later details" : "Credit cards details",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    const carousel = dialog.locator(".financial-carousel");
    await carousel.locator(".financial-carousel-track").focus();
    await page.keyboard.press("Home");
    for (let index = 0; index < item.index; index++)
      await page.keyboard.press("ArrowRight");
    await expect(carousel).toHaveAttribute("data-selected-account-id", item.id);
    const selected = activeCard(carousel);
    await expect(selected.locator(".virtual-account-facts")).toHaveCount(0);
    await expect(faceMetric(selected, "available")).toBeVisible();
    await expect(faceMetric(selected, "available")).toHaveAttribute(
      "data-status",
      item.status,
    );
    await expect(
      faceMetric(selected, "available").locator("strong"),
    ).toHaveText(item.value);
    await expect(faceMetric(selected, "outstanding")).toBeVisible();
    await expect(faceMetric(selected, "outstanding")).toHaveAttribute(
      "data-status",
      item.outstandingStatus,
    );
    await expect(
      faceMetric(selected, "outstanding").locator("strong"),
    ).toHaveText(item.outstanding);
    const limits: Record<string, string> = {
      [ids.verified]: "₹10,000.00",
      [ids.estimated]: "₹12,000.00",
      [ids.unknownLimit]: "Not available",
      [ids.payVerified]: "₹6,000.00",
      [ids.payEstimated]: "₹5,000.00",
      [ids.partial]: "₹4,000.00",
    };
    await expect(selected.locator('[data-metric="limit"]')).toContainText(
      limits[item.id],
    );
    const usageKnown = item.id !== ids.unknownLimit && item.id !== ids.partial;
    await expect(
      selected.locator(".virtual-account-face-utilization"),
    ).toHaveAttribute("data-state", usageKnown ? "available" : "unavailable");
    await expect(selected.getByRole("meter")).toHaveCount(usageKnown ? 1 : 0);
    if (!usageKnown) await expect(selected).toContainText("Usage unavailable");
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("missing institution has an honest initials fallback and an empty account history", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await page.goto(`/accounts/${ids.unknownLimit}`);
  const card = page.locator(
    `.financial-carousel-slide[data-account-id="${ids.unknownLimit}"] .virtual-account-card`,
  );
  await expect(card.getByRole("img")).toHaveAccessibleName(
    /institution not available.*initials/i,
  );
  await expect(card).not.toContainText(/VISA|Mastercard|CVV|PIN/);
  await page.goto("/accounts");
  const carousel = page.getByRole("region", {
    name: "Credit cards",
    exact: true,
  });
  await carousel.locator(".financial-carousel-track").focus();
  await page.keyboard.press("End");
  await expect(carousel).toHaveAttribute(
    "data-selected-account-id",
    ids.unknownLimit,
  );
  const history = page.locator(
    `.recent-account-transactions[data-account-id="${ids.unknownLimit}"]`,
  );
  await expect(history).toBeVisible();
  await expect(history).toContainText(
    /No (recent|saved|transactions|activity)/i,
  );
  expect(fixture.errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`${width}px debt face keeps long names and large amounts inside the card`, async ({
    context,
    page,
    baseURL,
  }, testInfo) => {
    const data = analyticsFixture();
    const account = data.accounts.find((record) => record.id === ids.verified)!;
    account.name = "QA International Platinum Rewards Credit Account";
    account.institution = "QA International Financial Services";
    account.creditLimit = "30000000.00";
    const snapshot = data.snapshots.find(
      (record) => record.accountId === ids.verified,
    )!;
    snapshot.reportedOutstanding = "12345678.90";
    snapshot.reportedAvailable = "17654321.10";
    const fixture = await mockWorkspace(context, page, baseURL!, data);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await page
      .getByRole("button", { name: "Credit cards details", exact: true })
      .click();
    const card = activeCard(
      page.getByRole("dialog").locator(".financial-carousel"),
    );
    const face = card.locator(".virtual-account-face");
    await expect(faceMetric(card, "outstanding").locator("strong")).toHaveText(
      "₹1,23,45,678.90",
    );
    await expect(faceMetric(card, "available").locator("strong")).toHaveText(
      "₹1,76,54,321.10",
    );
    const box = (await face.boundingBox())!;
    // Dense mobile fronts grow beyond the preferred physical-card ratio rather
    // than clipping identity or shrinking required financial facts illegibly.
    expect(box.height).toBeGreaterThanOrEqual(box.width / 1.586 - 1);
    const identity = card.locator(".virtual-account-face-bottom");
    const identityBox = (await identity.boundingBox())!;
    for (const child of [
      card.locator(".virtual-account-card-top"),
      faceMetric(card, "outstanding").locator("strong"),
      faceMetric(card, "available").locator("strong"),
      card.locator(".virtual-account-face-limit"),
      card.locator(".virtual-account-face-utilization"),
      identity,
    ]) {
      const childBox = (await child.boundingBox())!;
      expect(childBox.x).toBeGreaterThanOrEqual(box.x);
      expect(childBox.x + childBox.width).toBeLessThanOrEqual(
        box.x + box.width,
      );
      expect(childBox.y).toBeGreaterThanOrEqual(box.y);
      expect(childBox.y + childBox.height).toBeLessThanOrEqual(
        box.y + box.height,
      );
    }
    for (const metric of ["outstanding", "available"] as const) {
      const metricBox = (await faceMetric(card, metric).boundingBox())!;
      expect(metricBox.y + metricBox.height).toBeLessThanOrEqual(identityBox.y);
    }
    const sections = [
      card.locator(".virtual-account-card-top"),
      card.locator(".virtual-account-face-metrics"),
      card.locator(".virtual-account-face-limit"),
      card.locator(".virtual-account-face-utilization"),
      identity,
    ];
    for (let index = 0; index < sections.length - 1; index++) {
      const current = (await sections[index].boundingBox())!;
      const next = (await sections[index + 1].boundingBox())!;
      expect(current.y + current.height).toBeLessThanOrEqual(next.y + 1);
    }
    await expect(card.locator("h3")).toHaveText(account.name);
    await expect(card.locator(".virtual-account-number")).toContainText("0222");
    await face.screenshot({ path: testInfo.outputPath("long-debt-card.png") });
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("a direct availability report remains visible when separate usage is only a minimum", async ({
  context,
  page,
  baseURL,
}) => {
  const data = analyticsFixture();
  data.accounts.find((record) => record.id === ids.partial)!.creditLimit = null;
  data.snapshots.push({
    id: syntheticId(93001),
    userId: data.accounts[0].userId,
    accountId: ids.partial,
    asOf: "2026-10-18",
    reportedAvailable: "300.00",
    source: "user_report",
    verifiedByUser: true,
  });
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await page.goto(`/accounts/${ids.partial}`);
  const card = page.locator(
    `.financial-carousel-slide[data-account-id="${ids.partial}"] .virtual-account-card`,
  );
  await expect(faceMetric(card, "available")).toHaveAttribute(
    "data-status",
    "verified",
  );
  await expect(faceMetric(card, "available")).toContainText("₹300.00");
  await expect(faceMetric(card, "outstanding")).toHaveAttribute(
    "data-status",
    "partial",
  );
  await expect(faceMetric(card, "outstanding")).toContainText(
    "At least ₹800.00",
  );
  await expect(card).toContainText(/minimum known|at least/i);
  await expect(card).toContainText("₹800.00");
  await expect(card).not.toContainText("₹3,200");
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Pay Later details", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Pay Later details",
    exact: true,
  });
  const carousel = dialog.locator(".financial-carousel");
  await carousel.locator(".financial-carousel-track").focus();
  await page.keyboard.press("End");
  await expect(carousel).toHaveAttribute(
    "data-selected-account-id",
    ids.partial,
  );
  await expect(dialog.locator(".fac-summary")).toHaveCount(0);
  await expect(faceMetric(activeCard(carousel), "available")).toHaveAttribute(
    "data-status",
    "verified",
  );
  await expect(faceMetric(activeCard(carousel), "available")).toContainText(
    "₹300.00",
  );
  await expect(faceMetric(activeCard(carousel), "outstanding")).toContainText(
    "At least ₹800.00",
  );
  await expect(
    activeCard(carousel).locator(".virtual-account-face-utilization"),
  ).toHaveAttribute("data-state", "unavailable");
  await expect(activeCard(carousel).getByRole("meter")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("dashboard aggregate availability stays partial when one account is unknown", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await page.goto("/dashboard");
  const credit = page.getByRole("button", {
    name: "Credit cards details",
    exact: true,
  });
  await expect(credit).toContainText(/partial/i);
  await expect(credit).toContainText("₹18,190.60");
  await expect(credit.locator("#financial-credit-value")).toHaveText(
    "₹4,559.40",
  );
  await expect(credit.locator("#financial-credit-caption")).toHaveText(
    "3 cards",
  );
  await expect(credit.locator(".dashboard-credit-limit")).toHaveAttribute(
    "data-limit-status",
    "partial",
  );
  await expect(credit.locator(".dashboard-credit-limit")).toContainText(
    "₹22,000.00",
  );
  await expect(credit.locator(".dashboard-credit-limit")).toContainText(
    /known limits.*partial/i,
  );
  const payLater = page.getByRole("button", {
    name: "Pay Later details",
    exact: true,
  });
  await expect(payLater).toContainText(/partial/i);
  await expect(payLater).toContainText("₹8,500.00");
  await expect(payLater.locator("#financial-paylater-value")).toHaveText(
    "₹2,500.00",
  );
  await expect(payLater.locator("#financial-paylater-caption")).toHaveText(
    "3 providers",
  );
  await expect(payLater.locator(".dashboard-credit-limit")).toHaveAttribute(
    "data-limit-status",
    "known",
  );
  await expect(payLater.locator(".dashboard-credit-limit")).toContainText(
    "₹15,000.00",
  );
  await expect(payLater.locator("#financial-paylater-label")).toContainText(
    /known outstanding.*partial.*estimated/i,
  );
  for (const card of [credit, payLater]) {
    await expect(card.locator(".dashboard-credit-available")).toHaveAttribute(
      "data-availability-status",
      "partial",
    );
    await expect(card).not.toContainText(/usage known|smart use/i);
  }
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("empty debt groups never claim verified availability", async ({
  context,
  page,
  baseURL,
}) => {
  const data = analyticsFixture();
  data.accounts = [];
  data.snapshots = [];
  data.bills = [];
  data.transactions = [];
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await page.goto("/dashboard");
  for (const name of ["Credit cards details", "Pay Later details"]) {
    const card = page.getByRole("button", { name, exact: true });
    await expect(card).not.toContainText(/verified/i);
    await expect(card.locator(".dashboard-credit-available")).toHaveAttribute(
      "data-availability-status",
      "unknown",
    );
    await expect(card.locator(".dashboard-credit-available")).toContainText(
      name === "Pay Later details" ? "Available limit" : "Available credit",
    );
    await expect(card).toContainText("Not available");
    await expect(card.locator(".dashboard-credit-limit")).toHaveAttribute(
      "data-limit-status",
      "unknown",
    );
    await expect(card.locator(".dashboard-credit-limit")).toContainText(
      "Not available",
    );
  }
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("outstanding verification does not certify a separate unverified usage report", async ({
  context,
  page,
  baseURL,
}) => {
  const data = analyticsFixture();
  data.accounts = data.accounts.filter((record) => record.id === ids.verified);
  data.transactions = [];
  data.bills = [];
  data.snapshots = [
    {
      id: syntheticId(95001),
      userId: data.accounts[0].userId,
      accountId: ids.verified,
      asOf: "2026-10-18",
      reportedOutstanding: "100.00",
      source: "user_report",
      verifiedByUser: true,
    },
    {
      id: syntheticId(95002),
      userId: data.accounts[0].userId,
      accountId: ids.verified,
      asOf: "2026-10-18",
      reportedUtilized: "200.00",
      source: "user_report",
      verifiedByUser: false,
    },
  ];
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await page.goto("/dashboard");
  const card = page.getByRole("button", {
    name: "Credit cards details",
    exact: true,
  });
  await expect(card.locator("#financial-credit-value")).toHaveText("₹100.00");
  await expect(card.locator("#financial-credit-caption")).not.toContainText(
    /verified/i,
  );
  const outstanding = card.locator("#financial-credit-label");
  await expect(outstanding).toContainText(/outstanding.*verified reports/i);
  await expect(card.locator(".dashboard-credit-available")).toHaveAttribute(
    "data-availability-status",
    "estimated",
  );
  await expect(card.locator(".dashboard-credit-available")).toContainText(
    "₹9,800.00",
  );
  await card.click();
  const dialog = page.getByRole("dialog");
  const face = activeCard(dialog.locator(".financial-carousel"));
  await expect(faceMetric(face, "outstanding")).toHaveAttribute(
    "data-status",
    "verified",
  );
  await expect(faceMetric(face, "outstanding")).toContainText("₹100.00");
  await expect(faceMetric(face, "available")).toHaveAttribute(
    "data-status",
    "estimated",
  );
  await expect(faceMetric(face, "available")).toContainText("₹9,800.00");
  await expect(dialog.locator(".fac-summary")).toHaveCount(0);
  await expect(face.locator(".virtual-account-face-utilization")).toContainText(
    "2%",
  );
  await expect(
    face.locator(".virtual-account-face-utilization"),
  ).not.toContainText(/verified/i);
  await expect(face.getByRole("meter")).toHaveAttribute("aria-valuenow", "2");
  await dialog
    .getByRole("link", { name: "Manage account", exact: true })
    .click();
  const accountFacts = page.locator(".account-credit-facts");
  await expect(
    accountFacts
      .locator("div")
      .filter({ has: page.getByText("Current outstanding", { exact: true }) }),
  ).toContainText("₹100.00");
  await expect(
    accountFacts
      .locator("div")
      .filter({ has: page.getByText("Credit used", { exact: true }) }),
  ).toContainText("₹200.00");
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

for (const kind of ["Credit cards", "Pay Later"]) {
  test(`${kind} desktop arrow and keyboard selection keep availability and history on the same account`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(
      context,
      page,
      baseURL!,
      analyticsFixture(),
    );
    await page.goto("/accounts");
    const carousel = page.getByRole("region", {
      name: kind === "Pay Later" ? "Pay Later accounts" : kind,
      exact: true,
    });
    const targetId = kind === "Credit cards" ? ids.estimated : ids.payEstimated;
    const suffix =
      kind === "Credit cards" ? "credit card" : "pay later account";
    await carousel
      .getByRole("button", { name: `Next ${suffix}`, exact: true })
      .click();
    await expect(carousel).toHaveAttribute(
      "data-selected-account-id",
      targetId,
    );
    await expect(activeCard(carousel)).toContainText("Estimated");
    const history = page.locator(
      `.recent-account-transactions[data-account-id="${targetId}"]`,
    );
    await expect(history).toBeVisible();
    await expect(history).not.toContainText("QA Lunch");
    const track = carousel.locator(".financial-carousel-track");
    await track.focus();
    await page.keyboard.press("End");
    const last = kind === "Credit cards" ? ids.unknownLimit : ids.partial;
    await expect(carousel).toHaveAttribute("data-selected-account-id", last);
    await expect(faceMetric(activeCard(carousel), "available")).toHaveAttribute(
      "data-status",
      "unknown",
    );
    await expect(
      carousel.getByRole("button", { name: `Next ${suffix}`, exact: true }),
    ).toBeDisabled();
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test.describe("native touch selection", () => {
  test.use({ hasTouch: true });

  test("a mobile tap opens the source-date spending sheet without hover", async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(
      context,
      page,
      baseURL!,
      analyticsFixture(),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await openAnalytics(page);
    await page
      .locator('.analytics-workspace .spending-chart [data-date="2026-10-09"]')
      .first()
      .tap();
    const dialog = page.getByRole("dialog", {
      name: "9 Oct 2026",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("daily-spending-total")).toHaveText(
      "₹350.50",
    );
    await expect(page.locator(".recharts-tooltip-wrapper")).toBeHidden();
    await dialog
      .getByRole("button", { name: "Close daily spending", exact: true })
      .tap();
    await expect(dialog).toHaveCount(0);
    await page
      .locator('.analytics-workspace .spending-chart [data-date="2026-10-10"]')
      .first()
      .tap();
    const nextDay = page.getByRole("dialog", {
      name: "10 Oct 2026",
      exact: true,
    });
    await expect(nextDay).toBeVisible();
    await expect(nextDay.getByTestId("daily-spending-total")).toHaveText(
      "₹30.00",
    );
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  for (const kind of ["Credit cards", "Pay Later"]) {
    test(`${kind} mobile native swipe changes the selected ID and its financial summary`, async ({
      context,
      page,
      baseURL,
    }) => {
      const fixture = await mockWorkspace(
        context,
        page,
        baseURL!,
        analyticsFixture(),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/accounts");
      const carousel = page.getByRole("region", {
        name: kind === "Pay Later" ? "Pay Later accounts" : kind,
        exact: true,
      });
      await expect(carousel).toBeVisible();
      await swipe(page, carousel.locator(".financial-carousel-track"));
      await expect(carousel).toHaveAttribute(
        "data-selected-account-id",
        kind === "Credit cards" ? ids.estimated : ids.payEstimated,
      );
      await expect(
        faceMetric(activeCard(carousel), "available"),
      ).toHaveAttribute("data-status", "estimated");
      await expect(
        faceMetric(activeCard(carousel), "outstanding"),
      ).toHaveAttribute("data-status", "estimated");
      await expect(
        faceMetric(activeCard(carousel), "outstanding").locator("strong"),
      ).toHaveText(kind === "Credit cards" ? "₹2,000.00" : "₹1,000.00");
      const history = page.locator(
        `.recent-account-transactions[data-account-id="${kind === "Credit cards" ? ids.estimated : ids.payEstimated}"]`,
      );
      await expect(history).toBeVisible();
      await expect(history).not.toContainText("QA Lunch");
      await expect(history).not.toContainText("QA Supplies");
      expect(fixture.writes).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  }
});

test("empty workspace has truthful chart and category empty states", async ({
  context,
  page,
  baseURL,
}) => {
  const data = analyticsFixture();
  data.transactions = [];
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await openAnalytics(page);
  await expect(page.locator(".analytics-workspace")).toContainText(
    /No (spending|posted|expenses|transactions)/i,
  );
  const dialog = await openDay(page, "2026-10-09");
  await expect(dialog.getByTestId("daily-spending-total")).toHaveText("₹0.00");
  await expect(dialog.locator(".daily-spending-transaction")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

for (const filter of [
  { query: "date=2026-10-32", label: "date" },
  { query: "month=2026-13", label: "month" },
]) {
  test(`malformed ${filter.label} filter stays empty until analytics filters are cleared`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(
      context,
      page,
      baseURL!,
      analyticsFixture(),
    );
    await page.goto(`/transactions?${filter.query}&period=all`);
    await expect(page.locator(".transaction-table")).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "No transactions here yet",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText("QA Lunch");
    await expect(page.locator("main")).not.toContainText(
      "QA September equipment",
    );
    await expect(page.locator("main")).toContainText(
      `Unavailable ${filter.label}`,
    );
    await page
      .getByRole("button", { name: "Clear analytics filters", exact: true })
      .click();
    await expect(page.locator(".transaction-table")).toContainText("QA Lunch");
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("category month links override the global month without broadening the ledger", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await openAnalytics(page);
  await expect(page.locator('input[type="month"]')).toHaveValue("2026-10");
  await page.goto(
    "/transactions?category=Shopping&kind=expense&status=posted&month=2026-09&period=month",
  );
  await expect(page.locator(".transaction-table")).toContainText(
    "QA September equipment",
  );
  await expect(page.locator(".transaction-table")).not.toContainText(
    "QA Supplies",
  );
  await expect(page.locator(".transaction-table")).not.toContainText(
    "QA Pending excluded",
  );
  await page
    .getByRole("button", { name: "Clear analytics filters", exact: true })
    .click();
  await expect(page.locator(".transaction-table")).toContainText("QA Supplies");
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("an explicit month overrides period=all until the user enables All dates", async ({
  context,
  page,
  baseURL,
}) => {
  const fixture = await mockWorkspace(
    context,
    page,
    baseURL!,
    analyticsFixture(),
  );
  await page.goto(
    "/transactions?category=Shopping&kind=expense&status=posted&month=2026-09&period=all",
  );
  await expect(page.locator(".transaction-table")).toContainText(
    "QA September equipment",
  );
  await expect(page.locator(".transaction-table")).not.toContainText(
    "QA Supplies",
  );
  await expect(page.locator(".transaction-analytics-filters")).toContainText(
    "Month: September 2026",
  );
  const allDates = page.getByRole("checkbox", {
    name: "All dates",
    exact: true,
  });
  await expect(allDates).not.toBeChecked();
  await allDates.check();
  await expect(page.locator(".transaction-table")).toContainText(
    "QA September equipment",
  );
  await expect(page.locator(".transaction-table")).toContainText("QA Supplies");
  await expect(
    page.locator(".transaction-analytics-filters"),
  ).not.toContainText("Month:");
  await expect(page.locator(".transaction-period")).toContainText("All dates");
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("analytics and account decks exclude foreign records even in a mixed mocked payload", async ({
  context,
  page,
  baseURL,
}) => {
  const data = analyticsFixture();
  const foreignOwner = syntheticId(99009);
  const foreignAccount = syntheticId(99010);
  data.accounts.push({
    id: foreignAccount,
    userId: foreignOwner,
    name: "Foreign private card",
    institution: "Foreign private issuer",
    kind: "credit_card",
    active: true,
    maskedSuffix: "9999",
    creditLimit: "99999.00",
  });
  data.transactions.push({
    ...data.transactions[0],
    id: syntheticId(99011),
    userId: foreignOwner,
    description: "Foreign private expense",
    merchant: "Foreign private merchant",
    amount: "99999.00",
    fromAccountId: foreignAccount,
  });
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await openAnalytics(page);
  const dialog = await openDay(page, "2026-10-09");
  await expect(dialog.getByTestId("daily-spending-total")).toHaveText(
    "₹350.50",
  );
  await expect(dialog).not.toContainText("Foreign private");
  await page.keyboard.press("Escape");
  await page.goto("/accounts");
  await expect(page.locator("main")).not.toContainText("Foreign private");
  await expect(
    page.locator(`[data-account-id="${foreignAccount}"]`),
  ).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpectedApis).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("two isolated synthetic users do not receive each other's chart or card records", async ({
  browser,
  baseURL,
}) => {
  for (const label of ["Alice", "Bob"]) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
    });
    const page = await context.newPage();
    const data = analyticsFixture();
    const owner = label === "Alice" ? syntheticId(99001) : syntheticId(99002);
    for (const records of Object.values(data))
      for (const record of records) record.userId = owner;
    data.transactions = data.transactions.map((record) => ({
      ...record,
      description: `${label} private ${record.description}`,
    }));
    data.accounts = data.accounts.map((record) => ({
      ...record,
      name: `${label} private ${record.name}`,
    }));
    await mockWorkspace(context, page, baseURL!, data);
    await context.route("**/api/workspace", (route) =>
      route.fulfill({
        status: 200,
        json: {
          configured: true,
          authenticated: true,
          backend: "supabase",
          userId: owner,
          profile: {
            id: owner,
            displayName: `${label} Synthetic`,
            currency: "INR",
            timezone: "Asia/Kolkata",
          },
          workspace: data,
        },
      }),
    );
    await openAnalytics(page);
    const dialog = await openDay(page, "2026-10-09");
    await expect(dialog).toContainText(`${label} private QA Supplies`);
    await expect(dialog).not.toContainText(
      `${label === "Alice" ? "Bob" : "Alice"} private`,
    );
    await page.keyboard.press("Escape");
    await page.goto("/accounts");
    await expect(page.locator("main")).toContainText(
      `${label} private QA Verified Card`,
    );
    await expect(page.locator("main")).not.toContainText(
      `${label === "Alice" ? "Bob" : "Alice"} private`,
    );
    await context.close();
  }
});
