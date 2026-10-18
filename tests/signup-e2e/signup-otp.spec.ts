import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";

const syntheticEmail = "alex.signup@example.test";
const syntheticPassword = "Fictional-signup-only-42";
const syntheticCode = "001234";
const screenshots = path.resolve("artifacts/signup-otp");

type AuthRequest = {
  action: string;
  email?: string;
  password?: string;
  token?: string;
};
type AuthReply = { status?: number; json: Record<string, unknown> } | "abort";
type MockOptions = {
  signupEnabled?: boolean;
  retryAfter?: number;
  onAuth?: (
    request: AuthRequest,
  ) => AuthReply | undefined | Promise<AuthReply | undefined>;
};

async function isolatedSignup(page: Page, options: MockOptions = {}) {
  const state = {
    authenticated: false,
    refreshFails: false,
    workspaceReads: 0,
    blockedFinanceWrites: 0,
    authCalls: {} as Record<string, number>,
    verifiedLeadingZeros: false,
  };
  const workspace = Object.fromEntries(
    Object.keys(cloneDemoData()).map((key) => [key, []]),
  );
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const origin = new URL(test.info().project.use.baseURL!).origin;
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/workspace" && request.method() === "GET") {
      state.workspaceReads++;
      if (state.refreshFails)
        return route.fulfill({
          status: 503,
          json: {
            configured: true,
            backend: "supabase",
            authenticated: false,
            signupEnabled: options.signupEnabled !== false,
            error:
              "Synthetic workspace refresh unavailable. Try signing in again.",
          },
        });
      return route.fulfill({
        status: state.authenticated ? 200 : 401,
        json: {
          configured: true,
          backend: "supabase",
          authenticated: state.authenticated,
          signupEnabled: options.signupEnabled !== false,
          ...(state.authenticated
            ? {
                userId: DEMO_USER_ID,
                profile: { displayName: "Synthetic signup tester" },
                workspace,
              }
            : {}),
        },
      });
    }
    if (url.pathname === "/api/auth" && request.method() === "POST") {
      const body = request.postDataJSON() as AuthRequest;
      state.authCalls[body.action] = (state.authCalls[body.action] ?? 0) + 1;
      const reply = await options.onAuth?.(body);
      if (reply === "abort") return route.abort("connectionfailed");
      if (reply)
        return route.fulfill({ status: reply.status ?? 200, json: reply.json });
      if (body.action === "signup")
        return route.fulfill({
          status: 200,
          json: {
            ok: true,
            needsEmailConfirmation: true,
            retryAfter: options.retryAfter ?? 30,
          },
        });
      if (body.action === "verify-signup-otp") {
        state.verifiedLeadingZeros =
          typeof body.token === "string" &&
          body.token === syntheticCode &&
          body.email === syntheticEmail;
        state.authenticated = true;
        return route.fulfill({
          status: 200,
          json: { ok: true, authenticated: true },
        });
      }
      if (body.action === "resend-signup-otp")
        return route.fulfill({
          status: 200,
          json: { ok: true, retryAfter: options.retryAfter ?? 30 },
        });
      if (body.action === "reset")
        return route.fulfill({ status: 200, json: { ok: true } });
      if (body.action === "login") {
        state.authenticated = true;
        return route.fulfill({ status: 200, json: { ok: true } });
      }
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(request.method()))
        state.blockedFinanceWrites++;
      return route.abort();
    }
    return route.continue();
  });
  return state;
}

async function openSignup(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "New here? Create an account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Create your MoneyNest account",
      exact: true,
    }),
  ).toBeVisible();
}

async function fillSignup(page: Page) {
  await page.getByLabel("Email address", { exact: true }).fill(syntheticEmail);
  await page.getByLabel("Password", { exact: true }).fill(syntheticPassword);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(syntheticPassword);
}

async function enterVerification(page: Page) {
  await openSignup(page);
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(syntheticEmail, { exact: false })).toHaveCount(0);
  await expect(page.getByText("Step 2 of 2", { exact: true })).toBeVisible();
}

async function expectNoPersistedCredentials(page: Page) {
  // Assert booleans so a failed check cannot print a password or OTP in test output.
  expect(
    await page.evaluate(
      ({ email, password, code }) => {
        const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
        return [email, password, code].every(
          (value) => !stored.includes(value) && !location.href.includes(value),
        );
      },
      {
        email: syntheticEmail,
        password: syntheticPassword,
        code: syntheticCode,
      },
    ),
  ).toBe(true);
}

async function expectResponsiveControls(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const control of await page
    .locator(".login-form input, .login-form button")
    .all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(Boolean(box && box.width >= 24 && box.height >= 44)).toBe(true);
  }
}

test("signup validates inputs and keeps accessible password controls", async ({
  page,
}) => {
  const state = await isolatedSignup(page);
  await openSignup(page);
  const email = page.getByLabel("Email address", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  const confirmation = page.getByLabel("Confirm password", { exact: true });
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(confirmation).toHaveAttribute("autocomplete", "new-password");
  await email.fill("invalid-email");
  await password.fill(syntheticPassword);
  await confirmation.fill(syntheticPassword);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  expect(state.authCalls.signup ?? 0).toBe(0);
  await email.fill(syntheticEmail);
  await password.fill("short");
  await confirmation.fill("short");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  expect(state.authCalls.signup ?? 0).toBe(0);
  await password.fill(syntheticPassword);
  await confirmation.fill("Different-fictional-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".login-form").getByRole("alert")).toContainText(
    /match/i,
  );
  expect(state.authCalls.signup ?? 0).toBe(0);
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
  await email.focus();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Show password", exact: true }),
  ).toBeFocused();
  await expectNoPersistedCredentials(page);
  expect(state.blockedFinanceWrites).toBe(0);
});

test("six-digit paste preserves leading zeros and requires authenticated workspace refresh", async ({
  page,
}) => {
  const state = await isolatedSignup(page);
  await enterVerification(page);
  const code = page.getByLabel("Verification code", { exact: true });
  await expect(code).toHaveAttribute("inputmode", "numeric");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await page.keyboard.press("Tab");
  await expect(code).toBeFocused();
  await code.fill("123");
  await expect(
    page.getByRole("button", { name: "Verify email", exact: true }),
  ).toBeDisabled();
  await code.fill("");
  await code.evaluate((input, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, syntheticCode);
  expect((await code.inputValue()) === syntheticCode).toBe(true);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".user-card")).toContainText(
    "Synthetic signup tester",
  );
  expect(state.verifiedLeadingZeros).toBe(true);
  expect(state.workspaceReads).toBeGreaterThan(1);
  await expectNoPersistedCredentials(page);
  expect(state.blockedFinanceWrites).toBe(0);
});

for (const failure of ["incorrect", "expired"] as const) {
  test(`${failure} verification code remains on verification with an announced retry`, async ({
    page,
  }) => {
    const state = await isolatedSignup(page, {
      onAuth: ({ action }) =>
        action === "verify-signup-otp"
          ? {
              status: 400,
              json: {
                error:
                  failure === "expired"
                    ? "This code has expired. Request a new code and try again."
                    : "That code is incorrect. Check it and try again.",
              },
            }
          : undefined,
    });
    await enterVerification(page);
    await page
      .getByLabel("Verification code", { exact: true })
      .fill(syntheticCode);
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(page.locator(".login-form").getByRole("alert")).toContainText(
      failure,
    );
    await expect(
      page.getByRole("heading", { name: "Verify your email", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(state.authCalls["verify-signup-otp"]).toBe(1);
    expect(state.authenticated).toBe(false);
    await expectNoPersistedCredentials(page);
  });
}

test("signup and verification recover from network errors without duplicate submissions", async ({
  page,
}) => {
  let signupFailed = false;
  let verifyFailed = false;
  const state = await isolatedSignup(page, {
    onAuth: ({ action }) => {
      if (action === "signup" && !signupFailed) {
        signupFailed = true;
        return "abort";
      }
      if (action === "verify-signup-otp" && !verifyFailed) {
        verifyFailed = true;
        return "abort";
      }
    },
  });
  await openSignup(page);
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".login-form").getByRole("alert")).toBeVisible();
  expect(
    (await page.getByLabel("Email address", { exact: true }).inputValue()) ===
      syntheticEmail,
  ).toBe(true);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Verification code", { exact: true })
    .fill(syntheticCode);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.locator(".login-form").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(state.authCalls.signup).toBe(2);
  expect(state.authCalls["verify-signup-otp"]).toBe(2);
  expect(state.blockedFinanceWrites).toBe(0);
});

test("resend respects server cooldowns and a provider rate-limit retryAfter", async ({
  page,
}) => {
  let resends = 0;
  const state = await isolatedSignup(page, {
    retryAfter: 2,
    onAuth: ({ action }) => {
      if (action !== "resend-signup-otp") return;
      resends++;
      return resends === 1
        ? {
            status: 429,
            json: {
              error: "Please wait before requesting another code.",
              retryAfter: 7,
            },
          }
        : { json: { ok: true, retryAfter: 4 } };
    },
  });
  await openSignup(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Resend code in 00:0[12]/ }),
  ).toBeDisabled();
  await page.clock.runFor(3_000);
  await page.getByRole("button", { name: "Resend code", exact: true }).click();
  await expect(page.locator(".login-form").getByRole("alert")).toContainText(
    /wait/i,
  );
  await expect(
    page.getByRole("button", { name: "Resend code in 00:07", exact: true }),
  ).toBeDisabled();
  expect(resends).toBe(1);
  await page.clock.runFor(8_000);
  await page.getByRole("button", { name: "Resend code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resend code in 00:04", exact: true }),
  ).toBeDisabled();
  expect(resends).toBe(2);
  expect(state.authCalls["resend-signup-otp"]).toBe(2);
  await page.clock.runFor(5_000);
  await expect(
    page.getByRole("button", { name: "Resend code", exact: true }),
  ).toBeEnabled();
  expect(resends).toBe(2);
  await expectNoPersistedCredentials(page);
});

test("pending requests disable duplicate signup and verification actions", async ({
  page,
}) => {
  let releaseSignup!: () => void;
  let releaseVerification!: () => void;
  const signupGate = new Promise<void>((resolve) => {
    releaseSignup = resolve;
  });
  const verificationGate = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  const state = await isolatedSignup(page, {
    onAuth: async ({ action }) => {
      if (action === "signup") await signupGate;
      if (action === "verify-signup-otp") await verificationGate;
    },
  });
  await openSignup(page);
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connecting…", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(state.authCalls.signup).toBe(1);
  releaseSignup();
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Verification code", { exact: true })
    .fill(syntheticCode);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Verifying…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Change email", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Back to sign in", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(state.authCalls["verify-signup-otp"]).toBe(1);
  releaseVerification();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(state.blockedFinanceWrites).toBe(0);
});

test("verification success without workspace authentication never redirects into finance", async ({
  page,
}) => {
  const state = await isolatedSignup(page, {
    onAuth: ({ action }) =>
      action === "verify-signup-otp"
        ? { json: { ok: true, authenticated: true } }
        : undefined,
  });
  await enterVerification(page);
  await page
    .getByLabel("Verification code", { exact: true })
    .fill(syntheticCode);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".login-form").getByRole("alert")).toContainText(
    /sign in|session|workspace/i,
  );
  await expect(page).toHaveURL(/\/login$/);
  expect(state.authenticated).toBe(false);
  expect(state.workspaceReads).toBeGreaterThan(1);
});

test("workspace refresh network failure after verification keeps the user on sign-in", async ({
  page,
}) => {
  const state = await isolatedSignup(page);
  await enterVerification(page);
  state.refreshFails = true;
  await page
    .getByLabel("Verification code", { exact: true })
    .fill(syntheticCode);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".login-form").getByRole("alert")).toContainText(
    /sign in|session|workspace/i,
  );
  await expect(page).toHaveURL(/\/login$/);
  expect(state.workspaceReads).toBeGreaterThan(1);
});

for (const response of [
  "missing authenticated flag",
  "session unavailable",
] as const) {
  test(`verification with ${response} returns to sign-in without refreshing finance`, async ({
    page,
  }) => {
    const state = await isolatedSignup(page, {
      onAuth: ({ action }) =>
        action === "verify-signup-otp"
          ? response === "missing authenticated flag"
            ? { json: { ok: true } }
            : {
                status: 401,
                json: {
                  error:
                    "Your authenticated session is unavailable. Please sign in to continue.",
                  code: "session_unavailable",
                },
              }
          : undefined,
    });
    await enterVerification(page);
    const initialReads = state.workspaceReads;
    await page
      .getByLabel("Verification code", { exact: true })
      .fill(syntheticCode);
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".login-form").getByRole("alert")).toContainText(
      /sign in|session/i,
    );
    expect(
      (await page.getByLabel("Email address", { exact: true }).inputValue()) ===
        syntheticEmail,
    ).toBe(true);
    await expect(page.getByLabel("Password", { exact: true })).toBeEmpty();
    await expect(
      page.getByLabel("Verification code", { exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
    expect(state.workspaceReads).toBe(initialReads);
    expect(state.authenticated).toBe(false);
    expect(state.blockedFinanceWrites).toBe(0);
    await expectNoPersistedCredentials(page);
  });
}

test("change email, back, and reload clear pending credentials without granting access", async ({
  page,
}) => {
  const state = await isolatedSignup(page);
  await enterVerification(page);
  await page
    .getByLabel("Verification code", { exact: true })
    .fill(syntheticCode);
  await expectNoPersistedCredentials(page);
  await page.getByRole("button", { name: "Change email", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Create your MoneyNest account",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeEmpty();
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toBeEmpty();
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to sign in", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeEmpty();
  await expectNoPersistedCredentials(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  expect(state.authCalls["verify-signup-otp"] ?? 0).toBe(0);
  expect(state.authenticated).toBe(false);
});

test("signup disabled retains existing sign-in and generic password recovery", async ({
  page,
}) => {
  const state = await isolatedSignup(page, { signupEnabled: false });
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /New here|Create account|Verify email/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Forgot your password?", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Reset your cloud password",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(syntheticEmail);
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /if this email|if this address/i,
  );
  await page
    .getByRole("button", { name: "Back to sign in", exact: true })
    .click();
  await page.getByLabel("Email address", { exact: true }).fill(syntheticEmail);
  await page.getByLabel("Password", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(state.authCalls.reset).toBe(1);
  expect(state.authCalls.login).toBe(1);
  expect(state.authCalls.signup ?? 0).toBe(0);
  expect(state.blockedFinanceWrites).toBe(0);
});

for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
  test(`branded signup and OTP error fit ${width}px without horizontal scrolling`, async ({
    page,
  }) => {
    const state = await isolatedSignup(page, {
      onAuth: ({ action }) =>
        action === "verify-signup-otp"
          ? {
              status: 400,
              json: {
                error:
                  "This code has expired. Request a new code and try again.",
              },
            }
          : undefined,
    });
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await openSignup(page);
    await expectResponsiveControls(page);
    await expect(
      page.locator('img[src*="panda-money-bag"]:visible').first(),
    ).toBeVisible();
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, `signup-${width}.png`),
      fullPage: true,
    });
    await fillSignup(page);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Verify your email", exact: true }),
    ).toBeVisible();
    await expectResponsiveControls(page);
    await page.screenshot({
      path: path.join(screenshots, `verification-${width}.png`),
      fullPage: true,
    });
    const code = page.getByLabel("Verification code", { exact: true });
    await code.fill(syntheticCode);
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(page.locator(".login-form").getByRole("alert")).toContainText(
      /expired/i,
    );
    await expectResponsiveControls(page);
    // Hide synthetic digits in the retained image while preserving the error state.
    await page.screenshot({
      path: path.join(screenshots, `verification-error-${width}.png`),
      fullPage: true,
      style:
        ".otp-slots > span { color: transparent !important; -webkit-text-fill-color: transparent !important; }",
    });
    await expectNoPersistedCredentials(page);
    expect(state.blockedFinanceWrites).toBe(0);
  });
}

for (const width of [390, 1440]) {
  test(`email verified success is shown at ${width}px before authenticated redirect`, async ({
    page,
  }) => {
    const state = await isolatedSignup(page);
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await enterVerification(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await page
      .getByLabel("Verification code", { exact: true })
      .fill(syntheticCode);
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Email verified", exact: true }),
    ).toBeVisible();
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, `verification-success-${width}.png`),
      fullPage: true,
    });
    await page.clock.runFor(1_000);
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(state.verifiedLeadingZeros).toBe(true);
    expect(state.blockedFinanceWrites).toBe(0);
  });
}
