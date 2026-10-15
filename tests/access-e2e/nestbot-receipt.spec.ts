import { expect, test } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";

for (const width of [1440, 390])
  test(`NestBot opens the shared receipt review without sending images to chat at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const workspace = Object.fromEntries(
      Object.keys(cloneDemoData()).map((key) => [key, []]),
    );
    let botPosts = 0;
    let receiptPosts = 0;
    let workspaceWrites = 0;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
        return route.abort();
      if (url.pathname === "/api/workspace") {
        if (route.request().method() !== "GET") workspaceWrites++;
        return route.fulfill({
          status: 200,
          json: {
            configured: true,
            backend: "supabase",
            authenticated: true,
            signupEnabled: false,
            userId: DEMO_USER_ID,
            profile: { displayName: "Synthetic receipt reviewer" },
            workspace,
          },
        });
      }
      if (url.pathname === "/api/ai/settings")
        return route.fulfill({
          status: 200,
          json: {
            available: true,
            configured: true,
            ownerManaged: true,
            provider: "Vercel AI Gateway",
            model: "synthetic-gateway-model",
            requiresRedaction: false,
          },
        });
      if (url.pathname === "/api/ai/bot") {
        if (route.request().method() === "POST") botPosts++;
        return route.abort();
      }
      if (url.pathname === "/api/ai/receipt") {
        receiptPosts++;
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers()["content-type"]).toContain(
          "multipart/form-data",
        );
        return route.fulfill({
          status: 200,
          json: {
            provider: "Vercel AI Gateway",
            model: "synthetic-gateway-model",
            fingerprint: "f".repeat(64),
            extraction: {
              documentType: "payment",
              amount: "45.00",
              currency: "INR",
              occurredOn: "2026-10-09",
              merchant: "Synthetic receipt seller",
              description: "Synthetic NestBot receipt",
              kind: "expense",
              category: "Shopping",
              externalReference: null,
              accountHint: null,
              paymentStatus: "successful",
              confidence: "high",
              warnings: [],
            },
          },
        });
      }
      if (url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open Money Nest Bot" }).click();
    const chat = page.locator(".nestbot-chat-window");
    await expect(chat).toBeVisible();
    await expect(chat.locator('input[type="file"]')).toHaveCount(0);
    const receiptButton = chat.getByRole("button", {
      name: "Upload receipt screenshot",
      exact: true,
    });
    await expect(receiptButton).toHaveAttribute("title", "Open receipt scanner");
    await receiptButton.click();
    await expect(chat).toHaveCount(0);
    const editor = page.locator(".transaction-modal");
    await expect(
      editor.getByRole("heading", { name: "Add New Expense", exact: true }),
    ).toBeVisible();
    await expect(editor.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
      "",
    );
    const scanner = page.locator(".receipt-modal");
    if (!(await scanner.isVisible()))
      await editor.getByRole("button", { name: "Upload Image", exact: true }).click();
    await expect(scanner).toBeVisible();
    await scanner.getByLabel("Payment screenshot or shopping receipt").setInputFiles({
      name: "synthetic-nestbot-receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await scanner.getByRole("button", { name: "Scan with AI", exact: true }).click();
    await expect(scanner.getByLabel("AI receipt review")).toContainText(
      "INR 45.00",
    );
    expect(receiptPosts).toBe(1);
    expect(botPosts).toBe(0);
    expect(workspaceWrites).toBe(0);
  });
