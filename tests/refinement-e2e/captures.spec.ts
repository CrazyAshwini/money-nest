import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { mockWorkspace } from "./fixture";

for (const width of [390, 1440]) {
  test(`matched synthetic capture at ${width}px`, async ({
    context,
    page,
    baseURL,
  }) => {
    const fixture = await mockWorkspace(context, page, baseURL!);
    await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
    const root = path.resolve(
      "artifacts/ui-refinement",
      process.env.REFINEMENT_CAPTURE_PHASE || "after",
      `${width}px`,
    );
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
    for (const [url, name] of [
      ["/dashboard", "home"],
      ["/accounts", "accounts-bank"],
      ["/accounts", "accounts-cards"],
      ["/analytics", "analytics"],
      ["/profile", "profile"],
    ]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (name === "accounts-bank")
        await page
          .getByRole("button", { name: /^bank$/i, exact: true })
          .click();
      if (name === "accounts-cards")
        await page
          .getByRole("button", {
            name: /^(Credit cards|Credit card|Cards)$/i,
            exact: true,
          })
          .click();
      await capture(name);
    }
    await page.goto("/dashboard");
    for (const [button, dialog, name] of [
      ["Total bank balance details", "Bank balance details", "bank-dialog"],
      ["Credit cards details", "Credit card details", "credit-dialog"],
    ]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: dialog, exact: true }),
      ).toBeVisible();
      await capture(name);
      await page.keyboard.press("Escape");
    }
    const bot = page.getByRole("button", {
      name: /^(Open Money Nest Bot|Open NestBot)$/,
      exact: true,
    });
    await bot.last().click();
    await expect(
      page.locator(".nestbot-chat-window, .nestbot-panel"),
    ).toBeVisible();
    await capture("bot-visible");
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedApis).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}
