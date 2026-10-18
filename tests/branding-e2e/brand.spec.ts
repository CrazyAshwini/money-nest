import { expect, test, type Locator, type Page } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";

const MAIN_MASCOT = "/brand/moneynest-mascot.webp";
const BOT_MASCOT = "/brand/nestbot-icon.webp";
const APP_ICON = "/icon.svg";
const widths = [320, 375, 390, 430, 768, 1024, 1440];

async function mockedWorkspace(
  page: Page,
  state = { authenticated: true, backend: "supabase" },
  workspaceGate?: Promise<void>,
  botGate?: Promise<void>,
) {
  const workspace = cloneDemoData();
  let workspaceWrites = 0;
  let botPosts = 0;
  const unexpectedApiRequests: string[] = [];
  const errors: string[] = [];
  const botRequests: Record<string, unknown>[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
    if (url.pathname === "/api/workspace") {
      if (request.method() !== "GET") {
        workspaceWrites++;
        return route.abort();
      }
      await workspaceGate;
      return route.fulfill({
        status: state.authenticated ? 200 : 401,
        json: {
          configured: true,
          authenticated: state.authenticated,
          backend: state.backend,
          signupEnabled: false,
          needsSetup: false,
          userId: DEMO_USER_ID,
          profile: state.authenticated
            ? {
                displayName: "Synthetic branding reviewer",
                timezone: "Asia/Kolkata",
              }
            : null,
          ...(state.authenticated ? { workspace } : {}),
        },
      });
    }
    if (url.pathname === "/api/ai/settings")
      return route.fulfill({
        status: 200,
        json: { available: true, configured: false, ownerManaged: true },
      });
    if (url.pathname === "/api/ai/bot") {
      if (request.method() !== "POST") return route.abort();
      botPosts++;
      const payload = request.postDataJSON() as Record<string, unknown>;
      botRequests.push(payload);
      expect(payload).toMatchObject({ action: "chat" });
      expect(payload.image).toBeUndefined();
      if (botPosts > 1)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic provider unavailable. Please try again." },
        });
      await botGate;
      return route.fulfill({
        status: 200,
        json: {
          configured: false,
          reply: "Synthetic branding response; no AI provider was called.",
          message: {
            id: "synthetic-branding-reply",
            role: "assistant",
            content: "Synthetic branding response; no AI provider was called.",
            createdAt: "2026-10-16T06:30:00.000Z",
          },
        },
      });
    }
    if (url.pathname.startsWith("/api/")) {
      unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  return {
    assertNoMutations() {
      expect(workspaceWrites).toBe(0);
      expect(unexpectedApiRequests).toEqual([]);
      expect(errors).toEqual([]);
      expect(
        botRequests.every(
          (request) => request.action === "chat" && request.image === undefined,
        ),
      ).toBe(true);
    },
    botPosts: () => botPosts,
  };
}

async function ready(page: Page) {
  await expect(page.locator(".loading .spin")).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
}

async function decoded(image: Locator, expectedPath: string) {
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "");
  await expect(image).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete &&
          element.naturalWidth > 0 &&
          element.naturalHeight > 0,
      ),
    )
    .toBe(true);
  expect(
    await image.evaluate(
      (element: HTMLImageElement) => new URL(element.currentSrc).pathname,
    ),
  ).toBe(expectedPath);
}

async function fullLogo(logo: Locator) {
  await expect(logo).toBeVisible();
  await decoded(logo.locator(".money-nest-brand-mascot"), MAIN_MASCOT);
  await expect(logo.locator(".money-nest-wordmark-money")).toHaveText("Money");
  await expect(logo.locator(".money-nest-wordmark-nest")).toHaveText("NEST");
  await expect(logo.locator(".money-nest-wordmark")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  for (const decoration of [".money-nest-bird", ".money-nest-underline"]) {
    await expect(logo.locator(decoration)).toHaveCount(1);
    await expect(logo.locator(decoration)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  }
  const geometry = await logo.evaluate((element) => {
    const container = element.getBoundingClientRect();
    const pieces = [
      ".money-nest-brand-mascot",
      ".money-nest-wordmark-money",
      ".money-nest-wordmark-nest",
    ];
    return pieces.map((selector) => {
      const node = element.querySelector(selector)!;
      const rect = node.getBoundingClientRect();
      return {
        selector,
        width: rect.width,
        left: rect.left,
        right: rect.right,
        availableLeft: Math.max(0, container.left),
        availableRight: Math.min(innerWidth, container.right),
      };
    });
  });
  for (const piece of geometry) {
    expect(piece.width, piece.selector).toBeGreaterThan(10);
    expect(piece.left, piece.selector).toBeGreaterThanOrEqual(
      piece.availableLeft - 1,
    );
    expect(piece.right, piece.selector).toBeLessThanOrEqual(
      piece.availableRight + 1,
    );
  }
}

async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

for (const width of widths) {
  test(`full Money NEST branding, unified NestBot and navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const mock = await mockedWorkspace(page);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /Synthetic$/, level: 1 }),
    ).toBeVisible();
    await ready(page);
    const logo = page.locator(
      width <= 760 ? ".dashboard-mobile-brand" : ".desktop-sidebar > .brand",
    );
    await expect(logo).toHaveAccessibleName("Money Nest home");
    await fullLogo(logo);
    await noOverflow(page);
    await decoded(
      page.locator(".nestbot-trigger .money-nest-bot-avatar"),
      BOT_MASCOT,
    );
    await page.screenshot({
      path: test.info().outputPath(`dashboard-${width}x1000.png`),
      fullPage: true,
    });

    const botTrigger = page.getByRole("button", {
      name: "Open Money Nest Bot",
      exact: true,
    });
    await expect(botTrigger).toHaveCount(1);
    await expect(
      page.locator(".nestbot-floating-trigger, .nestbot-panel"),
    ).toHaveCount(0);
    await botTrigger.click();
    const panel = page.getByRole("dialog", {
      name: "Money Nest Bot",
      exact: true,
    });
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(
      panel.getByRole("textbox", { name: "Message NestBot", exact: true }),
    ).toBeFocused();
    await decoded(
      panel.locator(".nestbot-chat-header-info .money-nest-bot-avatar"),
      BOT_MASCOT,
    );
    await expect(panel).not.toContainText("Assistant unavailable");
    await panel
      .getByRole("button", { name: "Close NestBot", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(botTrigger).toBeFocused();
    expect(mock.botPosts()).toBe(0);

    if (width <= 760) {
      await page.goto("/bills");
      const opener = page.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      await opener.click();
      const drawer = page.locator(".navigation-drawer");
      await expect(drawer).toHaveAccessibleName("Workspace menu");
      await fullLogo(drawer.locator(".brand"));
      await noOverflow(page);
      await page.screenshot({
        path: test.info().outputPath(`drawer-${width}x1000.png`),
      });
      await drawer
        .getByRole("button", { name: "Close navigation", exact: true })
        .click();
      await expect(opener).toBeFocused();
    }
    mock.assertNoMutations();
  });
}

for (const width of [390, 1440]) {
  test(`dark preference preserves branding and keyboard focus stays visible on the teal chat header at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const mock = await mockedWorkspace(page);
    await page.goto("/dashboard");
    await ready(page);
    const logo = page.locator(
      width <= 760 ? ".dashboard-mobile-brand" : ".desktop-sidebar > .brand",
    );
    const colors = () =>
      logo.evaluate((element) => ({
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
        money: getComputedStyle(
          element.querySelector(".money-nest-wordmark-money")!,
        ).color,
        nest: getComputedStyle(
          element.querySelector(".money-nest-wordmark-nest")!,
        ).color,
      }));
    const lightTheme = await colors();
    expect(lightTheme.colorScheme).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-color-scheme: dark)").matches,
      ),
    ).toBe(true);
    expect(await colors()).toEqual(lightTheme);
    await fullLogo(logo);
    await noOverflow(page);
    await page.screenshot({
      path: test
        .info()
        .outputPath(`dashboard-dark-preference-${width}x1000.png`),
    });

    const trigger = page.getByRole("button", {
      name: "Open Money Nest Bot",
      exact: true,
    });
    await trigger.click();
    const chat = page.getByRole("dialog", {
      name: "Money Nest Bot",
      exact: true,
    });
    const close = chat.getByRole("button", {
      name: "Close NestBot",
      exact: true,
    });
    await expect(
      chat.getByRole("textbox", { name: "Message NestBot", exact: true }),
    ).toBeFocused();
    // Walk the focus-trapped dialog's actual keyboard order from its input.
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press("Tab");
      expect(
        await chat.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
      if (await close.evaluate((element) => document.activeElement === element))
        break;
    }
    const visibleFocus = async (button: Locator) => {
      await expect(button).toBeFocused();
      const ring = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          visible: element.matches(":focus-visible"),
          color: style.outlineColor,
          width: parseFloat(style.outlineWidth),
          style: style.outlineStyle,
          offset: parseFloat(style.outlineOffset),
        };
      });
      expect(ring.visible).toBe(true);
      expect(ring.color).toBe("rgb(255, 255, 255)");
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(ring.style).toBe("solid");
      expect(ring.offset).toBeLessThanOrEqual(0);
    };
    await visibleFocus(close);
    await page.screenshot({
      path: test
        .info()
        .outputPath(`nestbot-dark-preference-close-focus-${width}x1000.png`),
    });
    await page.keyboard.press("Enter");
    await expect(chat).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(mock.botPosts()).toBe(0);
    mock.assertNoMutations();
  });

  test(`distinct bot artwork survives loading, replies, errors and receipt handoff at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    let releaseBot!: () => void;
    const botGate = new Promise<void>((resolve) => {
      releaseBot = resolve;
    });
    const mock = await mockedWorkspace(page, undefined, undefined, botGate);
    await page.goto("/dashboard");
    const launcher = page.getByRole("button", {
      name: "Open Money Nest Bot",
      exact: true,
    });
    await decoded(launcher.locator(".money-nest-bot-avatar"), BOT_MASCOT);
    await launcher.click();
    const chat = page.getByRole("dialog", {
      name: "Money Nest Bot",
      exact: true,
    });
    await expect(chat).toBeVisible();
    await decoded(
      chat.locator(".nestbot-chat-header-info .money-nest-bot-avatar"),
      BOT_MASCOT,
    );
    await decoded(
      chat.locator(".nestbot-msg.assistant .money-nest-bot-avatar").first(),
      BOT_MASCOT,
    );
    const input = chat.getByRole("textbox", {
      name: "Message NestBot",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill("How much money do I have?");
    await chat
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    try {
      await expect(chat.getByRole("status")).toContainText(
        "Thinking & checking records...",
      );
      await expect(input).toBeDisabled();
      await decoded(
        chat
          .locator(".nestbot-msg.assistant")
          .last()
          .locator(".money-nest-bot-avatar"),
        BOT_MASCOT,
      );
    } finally {
      releaseBot();
    }
    await expect(
      chat.getByText(
        "Synthetic branding response; no AI provider was called.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      chat.locator(".nestbot-msg.assistant .money-nest-bot-avatar"),
    ).toHaveCount(2);
    await decoded(
      chat.locator(".nestbot-msg.assistant .money-nest-bot-avatar").last(),
      BOT_MASCOT,
    );
    await expect(
      chat.locator(".nestbot-msg.user .money-nest-bot-avatar"),
    ).toHaveCount(0);
    await expect(
      chat.locator(`img[src='${MAIN_MASCOT}'], img[src^='${APP_ICON}']`),
    ).toHaveCount(0);
    const background = await chat
      .locator(".nestbot-chat-header")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe("rgb(21, 94, 80)");
    expect(
      await chat
        .getByRole("heading", { name: "Money Nest Bot", exact: true })
        .evaluate((element) => getComputedStyle(element).color),
    ).toBe("rgb(255, 255, 255)");
    await noOverflow(page);
    await page.screenshot({
      path: test.info().outputPath(`nestbot-${width}x1000.png`),
    });
    await expect(input).toBeEnabled();
    await input.fill("Synthetic unavailable request");
    await input.press("Enter");
    await expect(
      chat.getByRole("log", { name: "NestBot conversation", exact: true }),
    ).toContainText("Synthetic provider unavailable. Please try again.");
    await expect(
      chat.locator(".nestbot-msg.assistant .money-nest-bot-avatar"),
    ).toHaveCount(3);
    await decoded(
      chat.locator(".nestbot-msg.assistant .money-nest-bot-avatar").last(),
      BOT_MASCOT,
    );
    await page.keyboard.press("Escape");
    await expect(chat).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await launcher.click();
    await chat
      .getByRole("button", { name: "Upload receipt screenshot", exact: true })
      .click();
    await expect(chat).toHaveCount(0);
    const editor = page.getByRole("dialog", {
      name: "Add New Expense",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await editor
      .getByRole("button", { name: "Upload Image", exact: true })
      .click();
    await expect(page.locator(".receipt-modal")).toBeVisible();
    expect(mock.botPosts()).toBe(2);
    mock.assertNoMutations();
  });

  test(`financial card dialogs retain close and focus behavior at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const mock = await mockedWorkspace(page);
    await page.goto("/dashboard");
    for (const [trigger, title] of [
      ["Total bank balance details", "Bank balance details"],
      [/^Spending · .+ details$/, "Spending details"],
      ["Credit cards details", "Credit card details"],
      ["Pay Later details", "Pay Later details"],
    ]) {
      const card = page.getByRole("button", { name: trigger, exact: true });
      await card.click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: "Close financial details", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(card).toBeFocused();
    }
    mock.assertNoMutations();
  });

  test(`login, recovery, private access and 404 use the complete logo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = { authenticated: false, backend: "supabase" };
    const mock = await mockedWorkspace(page, state);
    for (const [route, heading] of [
      ["/login", "Welcome to your workspace"],
      ["/reset-password", "Choose a new cloud password"],
      ["/branding-regression-missing-page", "Let's get you back home."],
    ]) {
      await page.goto(route);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      await ready(page);
      await fullLogo(page.locator(".brand:visible").first());
      await noOverflow(page);
      if (route === "/login")
        await page.screenshot({
          path: test.info().outputPath(`login-${width}x1000.png`),
        });
    }
    state.backend = "local";
    await page.goto("/profile");
    await expect(
      page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    await fullLogo(page.locator(".private-access > .brand"));
    await expect(page.locator(".brand")).not.toHaveText(/^M$/);
    await noOverflow(page);
    mock.assertNoMutations();
  });
}

test("loading uses the dedicated app artwork while the workspace request is pending", async ({
  page,
}) => {
  let releaseWorkspace!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseWorkspace = resolve;
  });
  const mock = await mockedWorkspace(page, undefined, gate);
  await page.goto("/dashboard");
  try {
    await decoded(
      page.getByRole("status").locator(".money-nest-app-icon"),
      APP_ICON,
    );
    await expect(page.getByRole("status")).toContainText(
      "Opening your finance workspace",
    );
  } finally {
    releaseWorkspace();
  }
  await expect(page.locator(".loading")).toHaveCount(0);
  await fullLogo(page.locator(".desktop-sidebar > .brand"));
  mock.assertNoMutations();
});

test("manifest, raster exports and browser metadata reference the current app icon family", async ({
  page,
}) => {
  await mockedWorkspace(page, { authenticated: false, backend: "supabase" });
  await page.goto("/login");
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    )!;
    const response = await fetch(link.href);
    return { status: response.status, value: await response.json() };
  });
  expect(manifest.status).toBe(200);
  expect(manifest.value).toMatchObject({
    start_url: "/dashboard",
    scope: "/",
    theme_color: "#155E50",
    background_color: "#F7FAF8",
  });
  expect(manifest.value.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: "/icon-192.png?v=brand-v2",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      }),
      expect.objectContaining({
        src: "/icon-512.png?v=brand-v2",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      }),
      expect.objectContaining({
        src: "/icon-maskable-512.png?v=brand-v2",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      }),
    ]),
  );
  for (const [asset, size] of [
    ["/icon-192.png", 192],
    ["/icon-512.png", 512],
    ["/icon-maskable-512.png", 512],
    ["/apple-touch-icon.png", 180],
  ] as const) {
    const resource = await page.evaluate(
      async ({ asset }) => {
        const response = await fetch(`${asset}?v=brand-v2`);
        const image = new Image();
        image.src = `${asset}?v=brand-v2`;
        await image.decode();
        return {
          status: response.status,
          mime: response.headers.get("content-type"),
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      },
      { asset },
    );
    expect(resource).toEqual({
      status: 200,
      mime: "image/png",
      width: size,
      height: size,
    });
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png?v=brand-v2",
  );
  const iconHrefs = await page
    .locator('link[rel="icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(iconHrefs).toContain("/icon.svg?v=brand-v2");
  expect(iconHrefs).toContain("/favicon.ico?v=brand-v2");
  expect(new Set([MAIN_MASCOT, BOT_MASCOT, APP_ICON]).size).toBe(3);
  const cdp = await page.context().newCDPSession(page);
  const parsed = await cdp.send("Page.getAppManifest");
  expect(parsed.errors).toEqual([]);
  const installability = await cdp
    .send("Page.getInstallabilityErrors")
    .catch((error: Error) => ({ unsupported: error.message }));
  await test.info().attach("chromium-manifest-check.json", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        manifestErrors: parsed.errors,
        installability,
        osInstallation:
          "Not performed. Fresh installation and existing-install icon refresh require manual browser/OS verification.",
      },
      null,
      2,
    ),
  });
  await cdp.detach();
});
