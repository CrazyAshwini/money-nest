import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  analyticsFixture,
  mockWorkspace,
} from "../analytics-cards-e2e/fixture";

const phase =
  process.env.FINAL_UI_CAPTURE_BASELINE === "1" ? "before" : "after";

for (const width of [390, 1440]) {
  test(`${phase} ${width}px synthetic review screenshots`, async ({
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
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const directory = `docs/final-ui-review/screenshots/${phase}/${width}px`;
    await mkdir(directory, { recursive: true });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route("**/api/workspace", async (route) => {
      await blocked;
      await route.fallback();
    });
    await page.goto("/dashboard");
    await expect(
      page.locator("main.loading, main[data-workspace-loading]"),
    ).toBeVisible();
    await page.screenshot({
      path: `${directory}/loading.png`,
      animations: "disabled",
    });
    release();
    await expect(
      page.getByRole("button", { name: "Credit cards details", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${directory}/dashboard.png`,
      fullPage: true,
      animations: "disabled",
    });
    if (phase === "after" && width === 390) {
      await page.evaluate(() => {
        const credit = document.querySelector(".dashboard-card-credit")!;
        window.scrollTo({
          top: window.scrollY + credit.getBoundingClientRect().top - 140,
          behavior: "instant",
        });
      });
      const creditBox = (await page
        .locator(".dashboard-card-credit")
        .boundingBox())!;
      const navBox = (await page
        .getByRole("navigation", { name: "Mobile navigation", exact: true })
        .boundingBox())!;
      expect(creditBox.y + creditBox.height).toBeLessThanOrEqual(navBox.y);
      await page.screenshot({
        path: `${directory}/dashboard-compact.png`,
        animations: "disabled",
      });
    }
    for (const [label, file] of [
      ["Credit cards details", "credit-card"],
      ["Pay Later details", "pay-later"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        path: `${directory}/${file}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}
