import { expect, test, type Page } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";
import type { Transaction } from "../../src/lib/types";

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

test("a saved payment reports refresh failure and recovers without another debit", async ({
  page,
}) => {
  const template = cloneDemoData();
  const bank = template.accounts.find((account) => account.kind === "bank")!;
  const snapshot = template.snapshots.find((row) => row.accountId === bank.id)!;
  const workspace = {
    ...Object.fromEntries(Object.keys(template).map((key) => [key, []])),
    accounts: [bank],
    snapshots: [
      { ...snapshot, asOf: "2026-10-09", reportedBalance: "13456.04" },
    ],
    transactions: [] as Transaction[],
  };
  let writes = 0;
  let failReads = false;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
    if (url.pathname === "/api/workspace") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        expect(body.collection).toBe("transactions");
        writes++;
        workspace.transactions = [
          ...workspace.transactions.filter((row) => row.id !== body.record.id),
          body.record,
        ];
        failReads = true;
        return route.fulfill({ status: 200, json: { record: body.record } });
      }
      if (failReads)
        return route.fulfill({
          status: 503,
          json: {
            configured: true,
            authenticated: true,
            backend: "supabase",
            error: "Synthetic balance refresh failure",
          },
        });
      return route.fulfill({
        status: 200,
        json: {
          configured: true,
          authenticated: true,
          backend: "supabase",
          userId: DEMO_USER_ID,
          profile: { displayName: "Synthetic refresh tester" },
          workspace,
        },
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
  await page.goto("/dashboard");
  const balance = () =>
    page
      .getByRole("button", { name: "Total bank balance details", exact: true })
      .locator(":scope > strong");
  await expect(balance()).toHaveText("₹13,456.04");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await editor.getByLabel("Amount · ₹", { exact: true }).fill("45.00");
  await editor
    .getByLabel("Description", { exact: true })
    .fill("Synthetic saved payment with refresh failure");
  await editor.getByLabel("Date", { exact: true }).fill("2026-10-10");
  await editor
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption(bank.id);
  await editor
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Unable to load your workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Your change was saved, but balances could not be refreshed",
    }),
  ).toContainText(
    "Your change was saved, but balances could not be refreshed",
  );
  expect(writes).toBe(1);
  expect(workspace.transactions).toHaveLength(1);
  expect(workspace.transactions[0].status).toBe("posted");
  failReads = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".transaction-modal")).toHaveCount(0);
  await expect(balance()).toHaveText("₹13,411.04");
  await page.reload();
  await expect(balance()).toHaveText("₹13,411.04");
  expect(writes).toBe(1);
  expect(workspace.transactions).toHaveLength(1);
});
