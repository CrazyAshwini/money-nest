import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RECEIPT_AI_MODEL } from "../../../src/lib/receipt-scan";
import {
  test,
  expect,
  baseURL,
  png,
  testDirectory,
  mockSettings,
  transactions,
  openEditor,
  openScanner,
  receipt,
  upload,
  chooseBank,
} from "./fixtures";

test("real AI endpoints protect sessions and origins and reject user-owned configuration", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/ai/settings")).status()).toBe(401);
  expect(
    (
      await request.post("/api/ai/settings", {
        headers: { Origin: baseURL },
        data: { action: "remove" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/ai/receipt", { headers: { Origin: baseURL } })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/ai/settings", {
        data: { action: "remove" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/ai/receipt", {
        headers: { Origin: "https://example.invalid" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get("/api/ai/settings", {
        headers: { Host: "example.invalid" },
      })
    ).status(),
  ).toBe(403);
  const status = await page.request.get("/api/ai/settings");
  expect(status.status()).toBe(200);
  expect(status.headers()["cache-control"]).toContain("no-store");
  expect(await status.json()).toMatchObject({
    available: true,
    configured: false,
    ownerManaged: true,
    provider: "Google Gemini",
    requiresRedaction: true,
  });
  const noKey = await page.request.post("/api/ai/receipt", {
    headers: { Origin: baseURL },
    multipart: {
      consent: "true",
      provider: "gemini",
      model: DEFAULT_RECEIPT_AI_MODEL,
      image: { name: "synthetic.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(noKey.status()).toBe(409);
  expect((await noKey.json()).code).toBe("ai_not_configured");
  const envelopeBefore = await readFile(
    path.join(testDirectory, "profile.enc.json"),
    "utf8",
  );
  const key = `rejected-synthetic-key-${randomBytes(24).toString("hex")}`;
  const connected = await page.request.post("/api/ai/settings", {
    headers: { Origin: baseURL },
    data: { action: "connect", apiKey: key, model: DEFAULT_RECEIPT_AI_MODEL },
  });
  expect(connected.status()).toBe(403);
  const rejected = await connected.json();
  expect(rejected.code).toBe("owner_managed");
  expect(rejected).not.toHaveProperty("apiKey");
  expect(JSON.stringify(rejected).includes(key)).toBe(false);
  const removed = await page.request.post("/api/ai/settings", {
    headers: { Origin: baseURL },
    data: { action: "remove" },
  });
  expect(removed.status()).toBe(403);
  expect((await removed.json()).code).toBe("owner_managed");
  const metadata = await page.request.get("/api/ai/settings");
  expect((await metadata.json()).configured).toBe(false);
  const envelopeAfter = await readFile(
    path.join(testDirectory, "profile.enc.json"),
    "utf8",
  );
  expect(envelopeAfter === envelopeBefore).toBe(true);
  expect(envelopeAfter.includes(key)).toBe(false);
  // A user-supplied synthetic credential was rejected. Test environment keys
  // stay empty, so even the real endpoint checks cannot invoke a provider.
});

test("AI settings are read-only and offer no user key controls", async ({
  page,
}) => {
  // This uses the real metadata endpoint with the deliberately empty owner key.
  const settingsMethods: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/settings")
      settingsMethods.push(request.method());
  });
  await page.goto("/settings#ai");
  const panel = page.locator("#ai");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/app owner/).first()).toBeVisible();
  await expect(panel.getByText("Google Gemini", { exact: true })).toBeVisible();
  await expect(panel.getByText(/human reviewers/)).toBeVisible();
  await expect(panel.getByText(/Vercel AI Gateway|OpenAI/)).toHaveCount(0);
  await expect(panel.locator("input, select, textarea")).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: /Save.*(?:key|connection)|Connect AI|Remove.*(?:key|connection)/i,
    }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: /Get.*(?:API )?key|Gateway dashboard/i }),
  ).toHaveCount(0);
  await expect(
    panel.getByText(
      /AI_GATEWAY_API_KEY|AI_GATEWAY_MODEL|GEMINI_API_KEY|RECEIPT_AI_PROVIDER|\.env/,
    ),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await expect(panel.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect.poll(() => settingsMethods.length).toBeGreaterThanOrEqual(2);
  expect(settingsMethods.every((method) => method === "GET")).toBe(true);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await panel.screenshot({
    path: path.resolve("artifacts/receipt-ai-owner-settings.png"),
  });
});

test("unconfigured AI asks the owner to enable scanning without changing manual entries", async ({
  page,
}) => {
  await mockSettings(page, false);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await openScanner(dialog);
  await expect(
    receipt(dialog)
      .getByText(/app owner/)
      .first(),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByText("Connect AI", { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await expect(receipt(dialog).locator('input[type="password"]')).toHaveCount(
    0,
  );
  await upload(dialog);
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await receipt(dialog)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await dialog
    .locator('textarea[name="description"]')
    .fill("Manual synthetic payment");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("21.43");
  await chooseBank(dialog);
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 1);
  expect(
    after.find((row) => row.description === "Manual synthetic payment")?.amount,
  ).toBe("21.43");
});
