import {
  test,
  expect,
  type Locator,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import {
  analyticsFixture,
  ids,
  mockWorkspace,
} from "../analytics-cards-e2e/fixture";

const widths = [320, 375, 390, 430, 768, 1024, 1440];
const firstQuote = "Every rupee has a story. Make yours count.";
const loader = (page: Page) => page.locator("main[data-workspace-loading]");
const selectedCard = (dialog: Locator) =>
  dialog.locator('[data-selected="true"] .virtual-account-card');

async function holdWorkspace(context: BrowserContext) {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/api/workspace", async (route) => {
    await blocked;
    if (!route.request().failure()) await route.fallback();
  });
  return release;
}

async function fitsViewport(element: Locator, width: number) {
  const box = (await element.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(
    await element.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
}

for (const width of widths) {
  test(`${width}px panda loading, matched dashboard tiles and debt sheets fit without overflow`, async ({
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
    const release = await holdWorkspace(context);
    await page.goto("/dashboard");
    const loading = loader(page);
    await expect(loading).toHaveAttribute("data-stage", "checking-session");
    await expect(
      loading.getByRole("heading", { name: "Money NEST", exact: true }),
    ).toHaveCount(1);
    const logo = loading.locator(".money-nest-app-icon");
    await expect(logo).toHaveAttribute("src", "/icon.svg");
    expect(
      await logo.evaluate(
        (node) =>
          (node as HTMLImageElement).complete &&
          (node as HTMLImageElement).naturalWidth > 0,
      ),
    ).toBe(true);
    const logoBox = (await logo.boundingBox())!;
    expect(logoBox.width).toBeGreaterThanOrEqual(150);
    expect(logoBox.width).toBeLessThanOrEqual(170);
    const headingBox = (await loading
      .getByRole("heading", { level: 1 })
      .boundingBox())!;
    expect(headingBox.y).toBeGreaterThanOrEqual(logoBox.y + logoBox.height);
    expect(Math.abs(logoBox.x + logoBox.width / 2 - width / 2)).toBeLessThan(1);
    const progress = loading.getByRole("progressbar");
    await expect(progress).not.toHaveAttribute("aria-valuenow");
    await expect(loading).not.toContainText(/\d+%/);
    await expect(loading).not.toContainText("QA Verified");
    await expect(
      loading.locator("[data-loading-quote] + div > span"),
    ).toHaveCount(4);
    await expect(loading.locator("footer")).toHaveText(
      "Your private financial workspace",
    );
    const footerBox = (await loading.locator("footer").boundingBox())!;
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    await expect(
      loading.locator(".workspace-skeleton, .skeleton, .spin"),
    ).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await fitsViewport(loading, width);
    release();
    const credit = page.getByRole("button", {
      name: "Credit cards details",
      exact: true,
    });
    const payLater = page.getByRole("button", {
      name: "Pay Later details",
      exact: true,
    });
    await expect(credit).toBeVisible();
    await expect(loader(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Total bank balance details",
        exact: true,
      }),
    ).toContainText("₹25,000.00");
    await expect(
      page.getByRole("button", { name: /spending.*details/i, exact: true }),
    ).toContainText("₹380.50");
    await expect(credit).toContainText("₹22,000.00");
    await expect(payLater).toContainText("₹15,000.00");
    const creditBox = (await credit.boundingBox())!;
    const payLaterBox = (await payLater.boundingBox())!;
    expect(Math.abs(creditBox.height - payLaterBox.height)).toBeLessThanOrEqual(
      1,
    );
    if (width >= 375)
      expect(Math.abs(creditBox.y - payLaterBox.y)).toBeLessThanOrEqual(1);
    await fitsViewport(credit, width);
    await fitsViewport(payLater, width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    if (width <= 760)
      await expect(
        page.getByRole("navigation", {
          name: "Mobile navigation",
          exact: true,
        }),
      ).toBeVisible();
    for (const [trigger, accountId, limit] of [
      [credit, ids.verified, "₹10,000.00"],
      [payLater, ids.payVerified, "₹6,000.00"],
    ] as const) {
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await fitsViewport(dialog, width);
      const card = selectedCard(dialog);
      const face = card.locator(".virtual-account-face");
      await expect(face.locator('[data-metric="limit"]')).toContainText(limit);
      await expect(
        face.locator(".virtual-account-face-utilization"),
      ).toHaveAttribute("data-state", "available");
      await expect(face.getByRole("meter")).toHaveCount(1);
      await expect(
        dialog.locator(".fac-summary, .fac-statements, details"),
      ).toHaveCount(0);
      await expect(
        dialog.locator(
          ".fac-details > .financial-carousel + .recent-account-transactions",
        ),
      ).toHaveAttribute("data-account-id", accountId);
      const history = dialog.locator(".recent-account-transactions");
      await expect(
        history.getByRole("link", { name: "View all", exact: true }),
      ).toHaveAttribute(
        "href",
        `/transactions?account=${accountId}&period=all`,
      );
      await history.scrollIntoViewIfNeeded();
      await fitsViewport(history, width);
      await expect(
        dialog.getByRole("link", { name: "Manage account", exact: true }),
      ).toBeVisible();
      const manage = dialog.getByRole("link", {
        name: "Manage account",
        exact: true,
      });
      await manage.scrollIntoViewIfNeeded();
      const manageBox = (await manage.boundingBox())!;
      const footerBox = (await dialog
        .locator(".financial-details-footer")
        .boundingBox())!;
      expect(manageBox.y + manageBox.height).toBeLessThanOrEqual(
        footerBox.y + 1,
      );
      const faceBox = (await face.boundingBox())!;
      for (const selector of [
        ".virtual-account-card-top",
        ".virtual-account-face-metrics",
        ".virtual-account-face-limit",
        ".virtual-account-face-utilization",
        ".virtual-account-face-bottom",
      ]) {
        const box = (await face.locator(selector).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(faceBox.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(
          faceBox.x + faceBox.width + 1,
        );
        expect(box.y).toBeGreaterThanOrEqual(faceBox.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(
          faceBox.y + faceBox.height + 1,
        );
      }
      const sections = [
        ".virtual-account-card-top",
        ".virtual-account-face-metrics",
        ".virtual-account-face-limit",
        ".virtual-account-face-utilization",
        ".virtual-account-face-bottom",
      ];
      for (let index = 0; index < sections.length - 1; index++) {
        const current = (await face.locator(sections[index]).boundingBox())!;
        const next = (await face.locator(sections[index + 1]).boundingBox())!;
        expect(current.y + current.height).toBeLessThanOrEqual(next.y + 1);
      }
      if (width <= 760) {
        const nav = page.getByRole("navigation", {
          name: "Mobile navigation",
          exact: true,
          includeHidden: true,
        });
        const dialogZ = await dialog.evaluate((node) =>
          Number(getComputedStyle(node).zIndex),
        );
        const navZ = await nav.evaluate((node) =>
          Number(getComputedStyle(node).zIndex),
        );
        expect(dialogZ).toBeGreaterThan(navZ);
      }
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("quotes rotate on a real pending request, reduced motion removes animation, and 30-second timeout permits retry", async ({
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.pauseAt(new Date("2026-10-18T06:31:00Z"));
  let attempts = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/api/workspace", async (route) => {
    attempts += 1;
    if (attempts === 1) await blocked;
    if (!route.request().failure()) await route.fallback();
  });
  await page.goto("/dashboard");
  await expect(loader(page)).toHaveAttribute("data-stage", "checking-session");
  await expect(page.locator("[data-loading-quote]")).toContainText(firstQuote);
  for (const quote of [
    "Small savings today, more possibilities tomorrow.",
    "A clearer picture of your money starts here.",
    "Your money, your goals, your nest.",
    firstQuote,
  ]) {
    await page.clock.fastForward(4500);
    await expect(page.locator("[data-loading-quote]")).toContainText(quote);
    await expect(loader(page)).not.toContainText(/\d+%|ready!/i);
  }
  expect(
    await page
      .locator("[data-loading-quote]")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  expect(
    await page
      .getByRole("progressbar")
      .locator("span")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await page.clock.fastForward(12_001);
  await expect(loader(page).getByRole("alert")).toContainText(
    /taking longer|try again|couldn’t|could not/i,
  );
  await expect(loader(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Credit cards details", exact: true }),
  ).toBeVisible();
  expect(attempts).toBe(2);
  release();
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("server errors hide private details and Retry preserves the existing session cookie", async ({
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
  await context.addCookies([
    {
      name: "synthetic-session",
      value: "synthetic-only",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  let attempts = 0;
  await context.route("**/api/workspace", async (route) => {
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: "PRIVATE_QA_ACCOUNT_12345 backend stack trace" },
      });
    return route.fallback();
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "PRIVATE_QA_ACCOUNT_12345",
  );
  await expect(page.locator("body")).not.toContainText("backend stack trace");
  await expect(loader(page)).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Credit cards details", exact: true }),
  ).toBeVisible();
  expect(attempts).toBe(2);
  expect(
    (await context.cookies()).find(
      (cookie) => cookie.name === "synthetic-session",
    )?.value,
  ).toBe("synthetic-only");
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("workspace parsing is an actual loading stage and successful readiness is never delayed for quotes", async ({
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
  await page.clock.pauseAt(new Date("2026-10-18T06:31:00Z"));
  await page.addInitScript(() => {
    const actualFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await actualFetch(...args);
      if (new URL(response.url).pathname === "/api/workspace") {
        const actualJson = response.json.bind(response);
        response.json = async () => {
          await new Promise<void>((resolve) => {
            (
              window as typeof window & {
                releaseSyntheticWorkspace?: () => void;
              }
            ).releaseSyntheticWorkspace = resolve;
          });
          return actualJson();
        };
      }
      return response;
    };
  });
  await page.goto("/dashboard");
  await expect(loader(page)).toHaveAttribute("data-stage", "loading-records");
  await expect(loader(page).getByRole("status")).toHaveText(
    "Loading your financial records…",
  );
  await expect(loader(page).getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
  );
  await expect(
    page.getByRole("button", { name: "Credit cards details", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as typeof window & { releaseSyntheticWorkspace?: () => void }
    ).releaseSyntheticWorkspace?.(),
  );
  // The clock remains paused: readiness must not wait for any animation, quote or timer.
  await expect(loader(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Credit cards details", exact: true }),
  ).toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test.describe("native touch debt sheets", () => {
  test.use({ hasTouch: true });
  for (const item of [
    {
      trigger: "Credit cards details",
      next: ids.estimated,
      limit: "₹12,000.00",
      amount: "₹2,000.00",
      history: "QA Metro",
      utilization: "16.6%",
    },
    {
      trigger: "Pay Later details",
      next: ids.payEstimated,
      limit: "₹5,000.00",
      amount: "₹1,000.00",
      history: "No transactions recorded",
      utilization: "20%",
    },
  ]) {
    test(`${item.trigger} swipes to that account's figures and history`, async ({
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
      await page.goto("/dashboard");
      await page.getByRole("button", { name: item.trigger, exact: true }).tap();
      const dialog = page.getByRole("dialog");
      const carousel = dialog.locator(".financial-carousel");
      const track = carousel.locator(".financial-carousel-track");
      const box = (await track.boundingBox())!;
      const session = await context.newCDPSession(page);
      const start = box.x + box.width * 0.85;
      const end = box.x + box.width * 0.15;
      const y = box.y + Math.min(80, box.height / 2);
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
      await expect(carousel).toHaveAttribute(
        "data-selected-account-id",
        item.next,
      );
      const card = selectedCard(dialog);
      await expect(card.locator('[data-metric="outstanding"]')).toContainText(
        item.amount,
      );
      await expect(card.locator('[data-metric="limit"]')).toContainText(
        item.limit,
      );
      await expect(
        card.locator(".virtual-account-face-utilization"),
      ).toContainText(item.utilization);
      await expect(
        card.locator(".virtual-account-face-utilization"),
      ).not.toContainText(/verified/i);
      const recent = dialog.locator(".recent-account-transactions");
      await expect(recent).toHaveAttribute("data-account-id", item.next);
      await expect(recent).toContainText(item.history);
      await expect(recent).not.toContainText(/QA Cafe|QA Supplies/);
      await expect(
        recent.getByRole("link", { name: "View all", exact: true }),
      ).toHaveAttribute(
        "href",
        `/transactions?account=${item.next}&period=all`,
      );
      expect(fixture.writes).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  }
});

test("unknown limits stay unknown while independently reported available amounts remain partial", async ({
  context,
  page,
  baseURL,
}) => {
  const data = analyticsFixture();
  for (const account of data.accounts) {
    if (account.kind === "credit_card" || account.kind === "pay_later")
      account.creditLimit = null;
  }
  const fixture = await mockWorkspace(context, page, baseURL!, data);
  await page.goto("/dashboard");
  for (const [trigger, knownAvailability] of [
    ["Credit cards details", "₹8,190.60"],
    ["Pay Later details", "₹4,500.00"],
  ]) {
    const tile = page.getByRole("button", { name: trigger, exact: true });
    const limits = tile.locator(".dashboard-credit-limit");
    await expect(limits).toHaveAttribute("data-limit-status", "unknown");
    await expect(limits).toContainText("Not available");
    await expect(limits).not.toContainText("₹0");
    const availability = tile.locator(".dashboard-credit-available");
    await expect(availability).toHaveAttribute(
      "data-availability-status",
      "partial",
    );
    await expect(availability).toContainText(knownAvailability);
    await expect(availability).toContainText(/partial/i);
  }
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
