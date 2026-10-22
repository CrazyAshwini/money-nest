import { test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fixture, mockWorkspace, ready } from "./fixture";

for (const width of [390, 1440]) {
  test(`capture existing Accounts pages at ${width}px`, async ({
    context,
    page,
    baseURL,
  }) => {
    const f = fixture();
    const state = await mockWorkspace(context, page, baseURL!, f.data);
    await page.setViewportSize({ width, height: 1000 });
    const dir = `docs/accounts-redesign-review/screenshots/before/${width}px`;
    await mkdir(dir, { recursive: true });
    await page.goto("/accounts");
    await ready(page);
    await page.screenshot({ path: `${dir}/overview.png`, fullPage: true });
    for (const [name, account] of [
      ["bank", f.bank],
      ["credit-card", f.card],
      ["pay-later", f.payLater],
      ["wallet", f.wallet],
    ] as const) {
      await page.goto(`/accounts/${account.id}`);
      await ready(page);
      await page.screenshot({
        path: `${dir}/${name}-details.png`,
        fullPage: true,
      });
    }
    state.unchanged();
  });
}
