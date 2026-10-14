import { test, expect } from "@playwright/test";
import { cloneDemoData } from "../../src/lib/seed";
import type { Transaction } from "../../src/lib/types";

test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("The synthetic mobile fixture needs a local baseURL.");
  const origin = new URL(baseURL).origin;
  const data = cloneDemoData();
  // Every API is a local synthetic fixture, independent of signed-in sessions,
  // private persistence, Supabase credentials, and the optional demo test flag.
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      await route.abort();
      return;
    }
    if (url.pathname === "/api/workspace") {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { collection: string; record: Transaction };
        if (body.collection !== "transactions") {
          await route.fulfill({ status: 400, json: { error: "Unexpected synthetic collection." } });
          return;
        }
        data.transactions.push(body.record);
        await route.fulfill({ status: 200, json: { record: body.record } });
      } else {
        await route.fulfill({ status: 200, json: {
          configured: true,
          authenticated: true,
          backend: "local",
          userId: data.accounts[0].userId,
          profile: {
            id: data.accounts[0].userId,
            displayName: "Synthetic mobile profile",
            currency: "INR",
            timezone: "Asia/Kolkata",
            createdAt: "2026-10-01T00:00:00.000Z",
          },
          workspace: data,
        } });
      }
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 401, json: { error: "No real API may be called by this fixture." } });
      return;
    }
    await route.continue();
  });
});

for (const width of [320, 390]) {
  test(`${width}px navigation restores the actual opener and exposes expansion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    // Dialog modality hides background controls from the accessibility tree;
    // retain their locators while checking the opener's expanded state.
    const more = page.getByRole("button", { name: "More navigation options", exact: true, includeHidden: true });
    const header = page.getByRole("button", { name: "Open navigation", exact: true, includeHidden: true });
    const drawer = page.getByRole("dialog", { name: "Workspace menu", exact: true });

    for (const opener of [more, header]) {
      await expect(opener).toHaveAttribute("aria-expanded", "false");
      await expect(opener).toHaveAttribute("aria-haspopup", "dialog");
      await opener.click();
      await expect(drawer).toBeVisible();
      await expect(opener).toHaveAttribute("aria-expanded", "true");
      await expect(drawer).toHaveAttribute("id", (await opener.getAttribute("aria-controls"))!);
      for (let index = 0; index < 5; index++) {
        await page.keyboard.press("Tab");
        expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute("aria-expanded", "false");
    }

    await more.click();
    await drawer.getByRole("link", { name: "Bills & payments", exact: true }).click();
    await expect(page).toHaveURL(/\/bills$/);
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Bills & payments", exact: true })).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "false");
  });

  test(`${width}px expense dialog paints above navigation and saves`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await page.locator(".quick-actions-bar").getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add New Expense", exact: true });
    await dialog.locator('input[name="amount"]').fill("12.34");
    await dialog.locator('textarea[name="description"]').fill(`Synthetic mobile expense ${width}`);
    await dialog.locator('select[name="fromAccountId"]').selectOption(cloneDemoData().accounts[0].id);
    await dialog.locator('input[name="occurredOn"]').fill("2026-10-14");
    const save = dialog.getByRole("button", { name: "Save transaction", exact: true });
    await save.scrollIntoViewIfNeeded();

    for (const button of [save, dialog.getByRole("button", { name: "Cancel", exact: true })]) {
      const paintedOnTop = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const navigation = document.querySelector<HTMLElement>(".mobile-bottom-bar")!;
        const previous = navigation.style.pointerEvents;
        // Radix suppresses outside pointer events, which previously allowed a
        // click through the bar even while it visibly covered Save/Cancel.
        // Temporarily include the bar in hit-testing to verify painting order.
        navigation.style.pointerEvents = "auto";
        try {
          const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { inViewport: rect.bottom <= innerHeight && rect.top >= 0, buttonOnTop: element.contains(top) };
        } finally {
          navigation.style.pointerEvents = previous;
        }
      });
      expect(paintedOnTop).toEqual({ inViewport: true, buttonOnTop: true });
    }
    await testInfo.attach(`expense-sheet-${width}px`, { body: await page.screenshot(), contentType: "image/png" });
    await save.click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link", { name: "Transactions", exact: true }).click();
    await expect(page.getByText(`Synthetic mobile expense ${width}`, { exact: true })).toBeVisible();
  });

  test(`${width}px quick filters announce selection and stay synchronized`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/transactions");
    const filters = page.getByRole("group", { name: "Quick filters", exact: true });
    const all = filters.getByRole("button", { name: "All", exact: true });
    const expenses = filters.getByRole("button", { name: "Expenses", exact: true });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(expenses).toHaveAttribute("aria-pressed", "false");
    await expenses.focus();
    await page.keyboard.press("Enter");
    await expect(expenses).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Transaction type", { exact: true })).toHaveValue("expense");
    const expected = cloneDemoData().transactions.filter((row) => row.kind === "expense" && (!row.occurredOn || row.occurredOn.startsWith("2026-10"))).length;
    await expect(page.locator(".filter-row > span")).toHaveText(`${expected} transactions`);

    await page.getByLabel("Transaction type", { exact: true }).selectOption("income");
    await expect(filters.getByRole("button", { name: "Income", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(expenses).toHaveAttribute("aria-pressed", "false");
    await page.getByLabel("Transaction type", { exact: true }).selectOption("refund");
    await expect(filters.locator('[aria-pressed="true"]')).toHaveCount(0);
    for (const button of await filters.locator("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
}
