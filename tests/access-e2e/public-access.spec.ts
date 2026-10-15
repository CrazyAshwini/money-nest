import { expect, test, type Page } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";

async function isolatedWorkspace(
  page: Page,
  authenticated = false,
  backend: "local" | "supabase" = "supabase",
) {
  let workspaceRequests = 0;
  const workspace = Object.fromEntries(
    Object.keys(cloneDemoData()).map((key) => [key, []]),
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const origin = new URL(test.info().project.use.baseURL!).origin;
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/workspace") {
      workspaceRequests++;
      return route.fulfill({
        status: authenticated ? 200 : 401,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          backend,
          authenticated,
          signupEnabled: false,
          ...(authenticated
            ? {
                userId: DEMO_USER_ID,
                profile: { displayName: "Synthetic authenticated profile" },
                workspace,
              }
            : {}),
        }),
      });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  return () => workspaceRequests;
}

test("signed-out profile has no fictional demo entry", async ({ page }) => {
  await isolatedWorkspace(page, false, "local");
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /fictional demo/i }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /fictional demo/i })).toHaveCount(
    0,
  );
  await expect(page.locator(".demo-strip")).toHaveCount(0);
});

test("session demo flag cannot skip authentication before or after reload", async ({
  page,
}) => {
  const requests = await isolatedWorkspace(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("finance-os:mode", "demo"),
  );
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-strip")).toHaveCount(0);
  expect(requests()).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("finance-os:mode")),
  ).toBeNull();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".demo-strip")).toHaveCount(0);
  expect(requests()).toBeGreaterThan(1);
});

test("session demo flag cannot override an authenticated server workspace", async ({
  page,
}) => {
  const requests = await isolatedWorkspace(page, true);
  await page.addInitScript(() => {
    sessionStorage.setItem("finance-os:mode", "demo");
    localStorage.setItem(
      "finance-os:fictional-demo:v1",
      JSON.stringify({ ignored: true }),
    );
  });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", {
      name: /^Good (morning|afternoon|evening), Synthetic$/,
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.locator(".user-card")).toContainText(
    "Synthetic authenticated profile",
  );
  await expect(page.locator(".demo-strip")).toHaveCount(0);
  await expect(
    page.getByText("No activity this month", { exact: true }),
  ).toBeVisible();
  expect(requests()).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("finance-os:mode")),
  ).toBeNull();
});
