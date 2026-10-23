import { test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fixture, mockWorkspace, openEditor } from "./fixture";

for (const width of [320, 390, 1440]) {
  test(`capture existing Add Expense at ${width}px`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = fixture();
    const state = await mockWorkspace(context, page, baseURL!, f.data);
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    const editor = await openEditor(page);
    await editor.locator('input[name="amount"]').fill("50.00");
    const dir = `artifacts/compact-expense/before/${width}px`;
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/add-expense.png` });
    state.unchanged();
  });
}
