import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  test,
  expect,
  mockSettings,
  transactions,
  openEditor,
  openScanner,
  receipt,
  closeEditor,
  mockScan,
  scan,
  merchant,
  reference,
  receiptDescription,
  reviewLabel,
  chooseBank,
  fingerprint,
} from "./fixtures";

test("invalid or oversized images stay local and preserve manual form values", async ({
  page,
}) => {
  await mockSettings(page);
  let providerRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    providerRequests++;
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected synthetic request." },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Manual draft stays intact");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("81.27");
  await openScanner(dialog);
  const fileInput = receipt(dialog).getByLabel(
    "Payment screenshot or shopping receipt",
    { exact: false },
  );
  await fileInput.setInputFiles({
    name: "synthetic-receipt.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await expect(
    receipt(dialog).getByText("Choose a PNG, JPG, or WebP image.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await fileInput.setInputFiles({
    name: "oversized-synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(6 * 1024 * 1024),
  });
  await expect(receipt(dialog).getByText(/5 MB/).last()).toBeVisible();
  await expect(
    receipt(dialog).getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Manual draft stays intact",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "81.27",
  );
  expect(providerRequests).toBe(0);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("AI scan fills a reviewed draft only, then a chosen account saves to the real synthetic ledger", async ({
  page,
}) => {
  await mockSettings(page);
  await mockScan(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "INR 125.50",
  );
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    merchant,
  );
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    reference,
  );
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-review-desktop.png"),
  });
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue("");
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "",
  );
  expect((await transactions(page)).length).toBe(before.length);

  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    receiptDescription,
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "125.50",
  );
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-10-09",
  );
  await expect(
    dialog.getByRole("checkbox", {
      name: "I confirmed that this payment was completed.",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.locator("summary", { hasText: "More details" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Bank reference", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Choose an account or name the external payer.", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await transactions(page)).length).toBe(before.length);
  await chooseBank(dialog);
  // Editing fields after confirmation requires another deliberate review.
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 1);
  const saved = after.find((row) => row.description === receiptDescription);
  expect(saved).toMatchObject({
    amount: "125.50",
    merchant,
    platform: null,
    occurredOn: "2026-10-09",
    currency: "INR",
    externalReference: reference,
    status: "posted",
    sourceSystem: "receipt_ai",
    sourceObjectId: fingerprint,
  });
  expect(Boolean(saved?.fromAccountId)).toBe(true);
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill(receiptDescription);
  await expect(
    page.getByRole("button", { name: receiptDescription, exact: true }),
  ).toHaveCount(1);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage.includes(receiptDescription)).toBe(false);
  expect(storage.includes(reference)).toBe(false);
  await page
    .getByRole("button", { name: `Edit ${receiptDescription}`, exact: true })
    .click();
  const editDialog = page.locator(".transaction-modal");
  await expect(
    editDialog.getByRole("button", { name: "Upload Image", exact: true }),
  ).toHaveCount(0);
  await expect(
    editDialog.getByRole("button", { name: "Take Photo", exact: true }),
  ).toHaveCount(0);
  await expect(
    editDialog.getByLabel("Amount · ₹", { exact: true }),
  ).toHaveValue("125.50");
  await editDialog.getByLabel("Amount · ₹", { exact: true }).fill("126.75");
  await editDialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(editDialog).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved?.id),
  ).toMatchObject({
    amount: "126.75",
    merchant,
    platform: null,
    externalReference: reference,
    status: "posted",
    sourceSystem: "receipt_ai",
    sourceObjectId: fingerprint,
  });
});
