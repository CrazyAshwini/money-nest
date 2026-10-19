import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { mockWorkspace, transactionsFixture } from "./fixture";

for (const width of [390, 1440]) {
  test(`capture baseline Transactions ${width}px`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = await mockWorkspace(
      context,
      page,
      baseURL!,
      transactionsFixture(),
    );
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.goto("/transactions");
    await expect(
      page.getByRole("heading", { name: "Transactions", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".transaction-table")).toContainText(
      "QA Lunch order",
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const directory = `docs/transactions-review/screenshots/before/${width}px`;
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/transactions.png`,
      fullPage: true,
    });
    expect(f.writes).toEqual([]);
    expect(f.unexpectedApis).toEqual([]);
    expect(f.errors).toEqual([]);
  });
}
