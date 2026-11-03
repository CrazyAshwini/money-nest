import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  test,
  expect,
  mockSettings,
  syntheticModel,
  scanResult,
  transactions,
  openEditor,
  openScanner,
  receipt,
  assertNoOverflow,
  upload,
  redactionLabel,
  closeEditor,
  mockScan,
  ReceiptProvider,
} from "./fixtures";

test("Gemini requires redaction confirmation, resets it for a replacement image, and scans only the acknowledged upload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockSettings(page, true, "Google Gemini");
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const contentType = route.request().headers()["content-type"];
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": contentType },
      },
    ).formData();
    expect(form.getAll("consent")).toEqual(["true"]);
    expect(form.getAll("redacted")).toEqual(["true"]);
    expect(form.getAll("provider")).toEqual(["gemini"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Google Gemini")]);
    expect([...form.keys()].sort()).toEqual([
      "consent",
      "image",
      "model",
      "provider",
      "redacted",
    ]);
    await route.fulfill({
      status: 200,
      json: scanResult(
        { externalReference: null, accountHint: null },
        "Google Gemini",
      ),
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic Gemini manual draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("41.28");
  await openScanner(dialog);
  await expect(
    receipt(dialog).getByText(/Google may use uploads and responses/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByText(/human reviewers may review/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByText(/Remove names, addresses, phone\/email/),
  ).toBeVisible();
  await expect(receipt(dialog).getByText(/QR codes\/barcodes/)).toBeVisible();
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway|OpenAI/),
  ).toHaveCount(0);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-reference-desktop.png"),
  });
  await page.setViewportSize({ width: 360, height: 850 });
  await assertNoOverflow(page);
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-reference-mobile.png"),
  });
  await upload(dialog);
  const confirmation = receipt(dialog).getByRole("checkbox", {
    name: redactionLabel,
    exact: true,
  });
  const scanButton = receipt(dialog).getByRole("button", {
    name: "Scan with AI",
    exact: true,
  });
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  expect(scanRequests).toBe(0);
  await confirmation.check();
  await expect(scanButton).toBeEnabled();
  await upload(dialog, "replacement-synthetic-image.png");
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  expect(scanRequests).toBe(0);
  await confirmation.check();
  await assertNoOverflow(page);
  await confirmation.scrollIntoViewIfNeeded();
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-gemini-redaction-mobile.png"),
  });
  await scanButton.click();
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "INR 125.50",
  );
  expect(scanRequests).toBe(1);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic Gemini manual draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "41.28",
  );
  expect((await transactions(page)).length).toBe(before.length);
  await receipt(dialog)
    .getByRole("button", { name: "Remove image", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await upload(dialog, "new-synthetic-image.png");
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("provider changes clear Gemini acknowledgement and Gateway keeps its original scan flow", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  const dialog = await openEditor(page);
  await upload(dialog);
  await receipt(dialog)
    .getByRole("checkbox", { name: redactionLabel, exact: true })
    .check();
  await receipt(dialog)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.unroute("**/api/ai/settings");
  await mockSettings(page);
  await mockScan(page);
  await openScanner(dialog);
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway and OpenAI/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeEnabled();
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  await receipt(dialog)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.unroute("**/api/ai/settings");
  await mockSettings(page, true, "Google Gemini");
  await openScanner(dialog);
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toHaveCount(0);
  await closeEditor(dialog);
});

test("stale provider rejection preserves the draft and requires fresh provider acknowledgement", async ({
  page,
}) => {
  let switchedProvider = false;
  await page.route("**/api/ai/settings", async (route) => {
    const provider: ReceiptProvider = switchedProvider
      ? "Google Gemini"
      : "Vercel AI Gateway";
    await route.fulfill({
      status: 200,
      json: {
        configured: true,
        provider,
        model: syntheticModel(provider),
        requiresRedaction: switchedProvider,
      },
    });
  });
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": route.request().headers()["content-type"] },
      },
    ).formData();
    expect(form.getAll("provider")).toEqual(["gateway"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Vercel AI Gateway")]);
    switchedProvider = true;
    await route.fulfill({
      status: 409,
      json: {
        code: "provider_changed",
        error:
          "Receipt AI settings changed. Refresh availability and try again.",
      },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic stale provider draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("61.82");
  await upload(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI settings changed. Refresh availability and try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic stale provider draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "61.82",
  );
  expect(scanRequests).toBe(1);
  expect((await transactions(page)).length).toBe(before.length);
  await receipt(dialog)
    .getByRole("button", { name: "Retry receipt AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(/Google may use uploads and responses/),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await closeEditor(dialog);
});

test("unknown or incomplete provider metadata fails closed without a misleading disclosure", async ({
  page,
}) => {
  let metadataState: "incomplete" | "unknown" | "valid" = "incomplete";
  await page.route("**/api/ai/settings", async (route) => {
    await route.fulfill({
      status: 200,
      json:
        metadataState === "valid"
          ? {
              configured: true,
              provider: "Google Gemini",
              model: "synthetic-gemini-model",
              requiresRedaction: true,
            }
          : metadataState === "unknown"
            ? {
                configured: true,
                provider: "Unknown synthetic provider",
                model: "synthetic-model",
                requiresRedaction: false,
              }
            : {
                configured: true,
                provider: "Google Gemini",
                model: "synthetic-gemini-model",
              },
    });
  });
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected synthetic request." },
    });
  });
  const dialog = await openEditor(page);
  await upload(dialog);
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway|OpenAI|Google may use/),
  ).toHaveCount(0);
  expect(scanRequests).toBe(0);
  await upload(dialog, "synthetic-metadata-replacement.png");
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await receipt(dialog)
    .getByRole("button", { name: "Remove image", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await upload(dialog, "synthetic-metadata-new.png");
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  metadataState = "unknown";
  await receipt(dialog)
    .getByRole("button", { name: "Retry receipt AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByText(/Vercel AI Gateway|OpenAI|Google may use/),
  ).toHaveCount(0);
  expect(scanRequests).toBe(0);
  metadataState = "valid";
  await receipt(dialog)
    .getByRole("button", { name: "Retry receipt AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("checkbox", {
      name: redactionLabel,
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    receipt(dialog).getByText(
      "Receipt AI provider information could not be confirmed. Try again.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await closeEditor(dialog);
});
