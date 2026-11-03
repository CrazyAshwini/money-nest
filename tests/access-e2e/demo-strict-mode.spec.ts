import { expect, test } from "@playwright/test";

test("demo entry remains usable when development replays its initialization effect", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL!).origin) return route.abort();
    if (url.pathname === "/api/auth") {
      expect(route.request().postDataJSON()).toMatchObject({
        action: "login",
        email: "demo@moneynest.com",
      });
      // The local server deliberately has no real Auth configuration. Preserve
      // its real fictional workspace endpoint while simulating only entry Auth.
      await page.context().addCookies([
        {
          name: "money-nest-demo-session",
          value: "1",
          url: baseURL!,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.continue();
  });
  // The legacy query uses a client transition from the ready signed-out page.
  // In a development server StrictMode replays the newly mounted demo effect.
  await page.goto("/login?demo=1");
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 90_000 });
  await expect(page.locator(".demo-strip")).toBeVisible();
  await page.goto("/profile");
  await page
    .getByRole("button", { name: "Reset Demo Data", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "Demo account reset to default state.",
  );
  await expect(
    page.getByRole("button", { name: "Save profile", exact: true }),
  ).toBeDisabled();
});
