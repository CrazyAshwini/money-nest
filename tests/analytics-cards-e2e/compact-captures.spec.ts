import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { analyticsFixture, mockWorkspace } from "./fixture";

for (const width of [390, 1440]) {
  test(`compact debt dashboard and card captures at ${width}px`, async ({
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
    await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
    const phase = process.env.COMPACT_CARDS_CAPTURE_PHASE || "after";
    const root = path.resolve(
      "docs/compact-credit-review/screenshots",
      phase,
      `${width}px`,
    );
    await mkdir(root, { recursive: true });
    const capture = async (name: string) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({
        path: path.join(root, `${name}.png`),
        animations: "disabled",
      });
    };
    await page.goto("/dashboard");
    const credit = page.getByRole("button", {
      name: "Credit cards details",
      exact: true,
    });
    await expect(credit).toBeVisible();
    await credit.scrollIntoViewIfNeeded();
    await capture("dashboard");
    for (const [button, title, name] of [
      ["Credit cards details", "Credit card details", "credit-dialog"],
      ["Pay Later details", "Pay Later details", "pay-later-dialog"],
    ]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      if (phase !== "before") {
        const face = dialog.locator(
          '[data-selected="true"] .virtual-account-face',
        );
        await expect(face.locator('[data-metric="outstanding"]')).toBeVisible();
        await expect(face.locator('[data-metric="available"]')).toBeVisible();
      }
      await capture(name);
      await page.keyboard.press("Escape");
    }
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}
