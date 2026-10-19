import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  mockWorkspace,
  workspaceFixture,
  syntheticId,
  userId,
} from "../refinement-e2e/fixture";

for (const width of [390, 1440]) {
  test(`matched analytics and card captures at ${width}px`, async ({
    context,
    page,
    baseURL,
  }) => {
    const data = workspaceFixture(3);
    data.snapshots.push({
      id: syntheticId(88300),
      userId,
      accountId: syntheticId(300),
      asOf: "2026-10-17",
      source: "user_report",
      verifiedByUser: true,
      reportedOutstanding: "1250.00",
      reportedAvailable: "3750.00",
    });
    const fixture = await mockWorkspace(context, page, baseURL!, data);
    await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
    const phase = process.env.ANALYTICS_CAPTURE_PHASE || "after";
    const root = path.resolve("artifacts/analytics-cards", phase, `${width}px`);
    await mkdir(root, { recursive: true });
    const capture = async (name: string) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: path.join(root, `${name}.png`),
        animations: "disabled",
      });
    };
    await page.goto("/analytics");
    await expect(
      page.getByRole("heading", { name: "Analytics", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
    await capture("analytics");
    const chart = page.locator(".recharts-surface").first();
    if (phase === "before") {
      await chart.focus();
      await page.keyboard.press("ArrowRight");
      await capture("analytics-focused-chart");
      await writeFile(
        path.join(root, "daily-popup-not-implemented.txt"),
        "Baseline has no daily spending popup; no synthetic before-popup was fabricated.\n",
      );
    } else {
      await page.locator('[data-date="2026-10-10"]').first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture("daily-spending-popup");
      await page.keyboard.press("Escape");
      await chart.focus();
      await page.keyboard.press("ArrowRight");
      await capture("analytics-focused-chart");
    }
    const evidence = await chart.evaluate((svg) => {
      const computed = getComputedStyle(svg);
      return {
        tag: svg.tagName,
        role: svg.getAttribute("role"),
        tabindex: svg.getAttribute("tabindex"),
        outline: computed.outline,
        box: svg.getBoundingClientRect().toJSON(),
        activeElement: document.activeElement?.outerHTML.slice(0, 500),
        cursor: document.querySelector(".recharts-tooltip-cursor")?.outerHTML,
      };
    });
    await writeFile(
      path.join(root, "focus-diagnosis.json"),
      JSON.stringify(evidence, null, 2),
    );
    await page.goto("/dashboard");
    for (const [button, dialog, name] of [
      ["Credit cards details", "Credit card details", "credit-dialog"],
      ["Pay Later details", "Pay Later details", "pay-later-dialog"],
    ]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: dialog, exact: true }),
      ).toBeVisible();
      await capture(name);
      await page.keyboard.press("Escape");
    }
    await page.goto("/accounts");
    await page.getByRole("button", { name: /^Cards$/i, exact: true }).click();
    await capture("accounts-cards");
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
  });
}
