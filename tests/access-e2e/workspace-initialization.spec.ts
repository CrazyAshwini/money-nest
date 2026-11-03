import { expect, test, type Page } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";
import type { WorkspaceData } from "../../src/lib/types";

const cloudOwner = "11000000-0000-4000-8000-000000000008";
function emptyWorkspace() {
  return Object.fromEntries(
    Object.keys(cloneDemoData()).map((key) => [key, []]),
  ) as unknown as WorkspaceData;
}

async function initializationMocks(page: Page) {
  const state = {
    authenticated: false,
    backend: "supabase" as "supabase" | "demo",
    failDemoAttempts: 0,
    authRequests: [] as Array<{ action: string; email?: string }>,
    profileWrites: 0,
    reads: 0,
    restoreCloud: false,
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
    if (url.pathname === "/api/workspace") {
      expect(request.method()).toBe("GET");
      state.reads++;
      return route.fulfill({
        status: state.authenticated ? 200 : 401,
        json: {
          configured: true,
          authenticated: state.authenticated,
          backend: state.backend,
          signupEnabled: false,
          ...(state.authenticated
            ? {
                userId: state.backend === "demo" ? DEMO_USER_ID : cloudOwner,
                profile: {
                  displayName:
                    state.backend === "demo"
                      ? "Synthetic demo tester"
                      : "Underlying cloud tester",
                  email:
                    state.backend === "demo"
                      ? "demo@example.test"
                      : "cloud@example.test",
                },
                workspace: emptyWorkspace(),
              }
            : {}),
        },
      });
    }
    if (url.pathname === "/api/auth") {
      const body =
        request.postDataJSON() as (typeof state.authRequests)[number];
      state.authRequests.push(body);
      if (body.action === "login") {
        expect(body.email).toBe("demo@moneynest.com");
        if (state.failDemoAttempts) {
          state.failDemoAttempts--;
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic demo initialization unavailable" },
          });
        }
        state.authenticated = true;
        state.backend = "demo";
        return route.fulfill({
          status: 200,
          json: { ok: true, authenticated: true, mode: "demo" },
        });
      }
      expect(body.action).toBe("exit-demo");
      state.backend = "supabase";
      state.authenticated = state.restoreCloud;
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    if (url.pathname === "/api/profile") {
      state.profileWrites++;
      return route.fulfill({
        status: 500,
        json: { error: "Unexpected profile mutation" },
      });
    }
    if (url.pathname === "/api/ai/settings")
      return route.fulfill({
        status: 200,
        json: { available: true, configured: false, ownerManaged: true },
      });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  return state;
}

for (const [authError, heading, message] of [
  [
    "recovery",
    "Reset your cloud password",
    "This password-reset link has expired. Request another one.",
  ],
  [
    "confirmation",
    "Welcome to your workspace",
    "This confirmation link is invalid or expired. Sign in again or request a new code from your signup screen.",
  ],
] as const) {
  test(`${authError} callback initializes the correct screen and removes only the consumed query`, async ({
    page,
  }) => {
    const state = await initializationMocks(page);
    await page.goto(`/login?auth_error=${authError}&keep=1`);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: message }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login\?keep=1$/);
    if (authError === "recovery")
      await expect(page.locator('input[name="password"]')).toHaveCount(0);
    else
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
    expect(state.authRequests).toEqual([]);
  });
}

test("the legacy demo link enters once and stays on the dashboard after the identity changes", async ({
  page,
}) => {
  const state = await initializationMocks(page);
  await page.goto("/login?demo=1");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".demo-strip")).toContainText("Demo workspace");
  await page.waitForTimeout(1500);
  expect(state.authRequests.map((request) => request.action)).toEqual([
    "login",
  ]);
  expect(state.profileWrites).toBe(0);
});

test("a failed demo initialization stays put until an explicit retry succeeds", async ({
  page,
}) => {
  const state = await initializationMocks(page);
  state.failDemoAttempts = 1;
  await page.goto("/demo");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not initialize demo session" }),
  ).toContainText("Could not initialize demo session");
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/demo$/);
  expect(state.authRequests).toHaveLength(1);
  await page.getByRole("button", { name: "Retry demo", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".demo-strip")).toBeVisible();
  expect(state.authRequests.map((request) => request.action)).toEqual([
    "login",
    "login",
  ]);
});

test("demo profile is read-only and exiting restores the existing cloud workspace", async ({
  page,
}) => {
  const state = await initializationMocks(page);
  state.authenticated = true;
  state.backend = "demo";
  state.restoreCloud = true;
  await page.goto("/profile");
  const name = page.getByLabel("Profile name", { exact: true });
  await expect(name).toHaveValue("Synthetic demo tester");
  await expect(name).toHaveAttribute("readonly", "");
  await expect(
    page.getByRole("button", { name: "Save profile", exact: true }),
  ).toBeDisabled();
  // Even a direct native form submission cannot fall through to a real profile write.
  await name
    .locator("xpath=ancestor::form")
    .evaluate((form) => (form as HTMLFormElement).requestSubmit());
  expect(state.profileWrites).toBe(0);
  await page.evaluate(() => sessionStorage.setItem("finance-os:mode", "demo"));
  await page
    .getByRole("button", { name: "Exit demo", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".demo-strip")).toHaveCount(0);
  expect(state.authRequests.map((request) => request.action)).toEqual([
    "exit-demo",
  ]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("finance-os:mode")),
  ).toBeNull();
  await page.goto("/profile");
  await expect(page.getByLabel("Profile name", { exact: true })).toHaveValue(
    "Underlying cloud tester",
  );
  await expect(
    page.getByRole("button", { name: "Save profile", exact: true }),
  ).toBeEnabled();
  expect(state.profileWrites).toBe(0);
});
