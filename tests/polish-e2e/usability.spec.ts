import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { cloneDemoData } from "../../src/lib/seed";

const data = cloneDemoData();
const mainRoutes = [
  "/dashboard",
  "/accounts",
  "/transactions",
  "/transactions/new",
  "/bills",
  "/pay-later",
  "/fixed-deposits",
  "/loans",
  "/emi-calendar",
  "/split-bills",
  "/imports",
  "/orders",
  "/analytics",
  "/notifications",
  "/settings",
  "/profile",
  "/profile/setup",
  "/login",
];
const detailRoutes = [
  `/accounts/${data.accounts[0].id}`,
  `/bills/${data.bills[0].id}`,
  `/fixed-deposits/${data.fixedDeposits[0].id}`,
  `/loans/${data.loans[0].id}`,
  `/split-bills/${data.groups[0].id}`,
];

async function ready(page: Page) {
  await expect(page.locator(".loading .spin")).toHaveCount(0);
  await expect(page.locator("h1").first()).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function noOverflow(page: Page, context: string) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll, `${context}: page overflow`).toBeLessThanOrEqual(
    widths.client + 1,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("finance-os:mode", "demo"),
  );
});

for (const width of [320, 360, 390, 768]) {
  test(`every page and record view fits a ${width}px screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const exceptions: string[] = [];
    page.on("pageerror", (error) => exceptions.push(error.message));
    for (const route of [...mainRoutes, ...detailRoutes]) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      await ready(page);
      await noOverflow(page, route);
    }
    expect(exceptions).toEqual([]);
    await page.goto("/dashboard");
    await ready(page);
    if (width < 480) {
      const columns = await page
        .locator(".home-content .stats-grid")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(2);
    }
    if (width === 360) {
      await mkdir(path.resolve("artifacts"), { recursive: true });
      await page.screenshot({
        path: path.resolve("artifacts/mobile-polish-dashboard.png"),
      });
    }
  });
}

test("mobile menu traps focus, closes with Escape or navigation, and restores the trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dashboard");
  await ready(page);
  const trigger = page.locator("button.mobile-menu");
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole("dialog", {
    name: "Workspace menu",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  for (let index = 0; index < 23; index++) {
    await page.keyboard.press("Tab");
    expect(
      await menu.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(menu).toHaveCount(0);
  await ready(page);
  await noOverflow(page, "menu navigation");
  await trigger.click();
  await expect(
    menu.getByRole("link", { name: "Orders & refunds", exact: true }),
  ).toHaveCount(0);
  await menu
    .getByRole("link", { name: "Money Nest home", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("long profile names and email addresses fit the phone drawer and profile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.addInitScript(() => sessionStorage.removeItem("finance-os:mode"));
  const email = `${"synthetic".repeat(6)}@example.test`;
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        authenticated: true,
        backend: "local",
        userId: data.accounts[0].userId,
        profile: {
          id: data.accounts[0].userId,
          displayName: `Synthetic${"A".repeat(50)}`,
          email,
        },
        workspace: data,
      }),
    }),
  );
  await page.goto("/dashboard");
  await ready(page);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const menu = page.getByRole("dialog", {
    name: "Workspace menu",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await noOverflow(page, "long profile name in drawer");
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/mobile-polish-menu.png"),
  });
  await page.keyboard.press("Escape");
  await page.goto("/profile");
  await ready(page);
  await expect(
    page.getByRole("link", { name: email, exact: true }),
  ).toHaveAttribute("href", `mailto:${email}`);
  await noOverflow(page, "long profile email");
});

test("all rendered local links resolve and footer data links reach their section", async ({
  page,
}) => {
  const links = new Set<string>();
  for (const route of [...mainRoutes, ...detailRoutes]) {
    await page.goto(route);
    await ready(page);
    for (const href of await page
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("href") || ""),
      )) {
      expect(href).not.toBe("#");
      if (href.startsWith("/") && !href.startsWith("//")) links.add(href);
    }
  }
  for (const href of links) {
    const response = await page.request.get(href.split("#")[0]);
    expect(response.status(), href).toBe(200);
  }
  await page.goto("/dashboard");
  await ready(page);
  await expect(page.locator(".page-footer")).toContainText(
    `© ${new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date())} Money Nest`,
  );
  await page
    .getByRole("navigation", { name: "Footer navigation", exact: true })
    .getByRole("link", { name: "Data & privacy", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings#data$/);
  await expect(page.locator("#data")).toBeVisible();
});

test("page titles and descriptions are distinct and installed icons resolve", async ({
  page,
}) => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const route of mainRoutes) {
    await page.goto(route);
    await ready(page);
    await expect(page).toHaveTitle(/\| Money Nest$/);
    titles.add(await page.title());
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description?.length, route).toBeGreaterThan(25);
    descriptions.add(description!);
  }
  expect(titles.size).toBe(mainRoutes.length);
  expect(descriptions.size).toBe(mainRoutes.length);
  for (const asset of [
    "/icon.svg",
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/manifest.webmanifest",
  ]) {
    expect((await page.request.get(asset)).status(), asset).toBe(200);
  }
  await page.goto("/dashboard");
  await expect(page.locator('link[rel="icon"]')).not.toHaveCount(0);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png",
  );
});

test("invalid paths show the custom 404 and stay there for a signed-out profile", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.removeItem("finance-os:mode"));
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        authenticated: false,
        backend: "local",
        needsSetup: false,
        emailRequired: true,
      }),
    }),
  );
  for (const route of [
    "/missing-page",
    "/accounts/not-an-id",
    "/settings/extra",
    "/transactions/new/extra",
  ]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(404);
    await expect(page).toHaveTitle("Page not found | Money Nest");
    await expect(
      page.getByRole("heading", {
        name: "Let's get you back home.",
        exact: true,
      }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(
      new RegExp(`${route.replaceAll("/", "\\/")}$`),
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await noOverflow(page, route);
  }
});

test("exports report success and missing record views provide working return links", async ({
  page,
}) => {
  await page.goto("/transactions");
  await ready(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^transactions-.*\.csv$/,
  );
  await expect(page.locator(".toast.visible")).toContainText(
    "Filtered transactions exported.",
  );
  await page
    .getByRole("button", { name: "Dismiss message", exact: true })
    .click();
  await expect(page.locator(".toast.visible")).toHaveCount(0);
  for (const root of [
    "accounts",
    "bills",
    "fixed-deposits",
    "loans",
    "split-bills",
  ]) {
    await page.goto(`/${root}/ffffffff-ffff-4fff-8fff-ffffffffffff`);
    await ready(page);
    const back = page.locator(`#workspace-content a[href="/${root}"]`).first();
    await expect(back).toHaveAttribute("href", `/${root}`);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/${root}$`));
  }
});
