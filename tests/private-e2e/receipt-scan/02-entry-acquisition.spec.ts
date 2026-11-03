import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  test,
  expect,
  mockSettings,
  transactions,
  openEditor,
  chooseBank,
  assertNoOverflow,
  receipt,
  png,
  openScanner,
  closeEditor,
  syntheticModel,
  profileName,
  email,
  owner,
  scanResult,
  redactionLabel,
} from "./fixtures";

test("expense categories offer matching platforms and custom Stationery saves without extra inputs", async ({
  page,
}) => {
  await mockSettings(page, false);
  await page.setViewportSize({ width: 320, height: 800 });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  const category = dialog.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  const platform = dialog.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(
    category.getByRole("option", { name: "Stationery", exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.locator("summary", { hasText: "More details" }),
  ).toHaveCount(0);
  await category.selectOption("Food");
  for (const source of ["Swiggy", "Zomato", "Domino's", "Other"])
    await expect(
      platform.getByRole("option", { name: source, exact: true }),
    ).toHaveCount(1);
  await platform.selectOption("Swiggy");
  await category.selectOption("Stationery");
  await expect(platform).toHaveValue("");
  await expect(
    platform.getByRole("option", { name: "Swiggy", exact: true }),
  ).toHaveCount(0);
  await expect(
    platform.getByRole("option", {
      name: "Local stationery shop",
      exact: true,
    }),
  ).toHaveCount(1);
  await platform.selectOption("Other");
  const customSource = "Synthetic Paper Shop";
  await dialog
    .getByLabel("Other platform / source", { exact: true })
    .fill(customSource);
  await dialog
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Synthetic stationery expense");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("18.45");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-10-09");
  await chooseBank(dialog);
  await assertNoOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await dialog.screenshot({
    path: path.resolve("artifacts/expense-platform-mobile.png"),
  });
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (await transactions(page)).find(
    (row) => row.description === "Synthetic stationery expense",
  );
  expect(await transactions(page)).toHaveLength(before.length + 1);
  expect(saved).toMatchObject({
    category: "Stationery",
    platform: customSource,
    merchant: null,
    amount: "18.45",
    status: "posted",
  });
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill("Synthetic stationery expense");
  await page
    .getByRole("button", {
      name: "Edit Synthetic stationery expense",
      exact: true,
    })
    .click();
  const editDialog = page.locator(".transaction-modal");
  await expect(
    editDialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Stationery");
  await editDialog.getByLabel("Amount · ₹", { exact: true }).fill("19.45");
  await editDialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(editDialog).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved?.id),
  ).toMatchObject({
    category: "Stationery",
    platform: customSource,
    merchant: null,
    amount: "19.45",
  });
});

test("receipt sheet offers camera and upload, and closing it preserves the expense draft", async ({
  page,
}) => {
  await mockSettings(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic camera draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("37.19");
  await dialog.getByRole("button", { name: "Take Photo", exact: true }).click();
  const sheet = receipt(dialog);
  await expect(
    sheet.getByRole("heading", { name: "Scan receipt", exact: true }),
  ).toBeVisible();
  const cameraInput = sheet.getByLabel("Take a receipt photo", { exact: true });
  await expect(cameraInput).toHaveAttribute("capture", "environment");
  await expect(cameraInput).toHaveAttribute(
    "accept",
    "image/png,image/jpeg,image/webp",
  );
  await expect(
    sheet.getByLabel("Payment screenshot or shopping receipt", { exact: true }),
  ).not.toHaveAttribute("capture");
  await expect(
    sheet.getByRole("checkbox", {
      name: "This receipt spans multiple photos (long bill)",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-camera-desktop.png"),
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await assertNoOverflow(page);
  await page.screenshot({
    path: path.resolve("artifacts/receipt-sheet-camera-mobile.png"),
  });
  const fileChooser = page.waitForEvent("filechooser");
  await sheet.getByRole("button", { name: "Camera", exact: true }).click();
  await (
    await fileChooser
  ).setFiles({
    name: "synthetic-camera.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic camera draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "37.19",
  );
  await openScanner(dialog);
  await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("long receipts send up to three ordered photos together and reset privacy acknowledgement when a photo changes", async ({
  page,
}) => {
  await mockSettings(page, true, "Google Gemini");
  const before = await transactions(page);
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    const form = await new Response(
      new Uint8Array(route.request().postDataBuffer() ?? []),
      {
        headers: { "Content-Type": route.request().headers()["content-type"] },
      },
    ).formData();
    const images = form.getAll("image") as File[];
    expect(images.map((image) => image.name)).toEqual([
      "synthetic-primary.png",
      "synthetic-page-2.png",
      "synthetic-page-3.png",
    ]);
    expect(images.map((image) => image.size)).toEqual([
      png.length,
      png.length,
      png.length,
    ]);
    expect(form.getAll("provider")).toEqual(["gemini"]);
    expect(form.getAll("model")).toEqual([syntheticModel("Google Gemini")]);
    expect(form.getAll("redacted")).toEqual(["true"]);
    expect(form.getAll("consent")).toEqual(["true"]);
    expect([...form.keys()].sort()).toEqual([
      "consent",
      "image",
      "image",
      "image",
      "model",
      "provider",
      "redacted",
    ]);
    const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
    expect(body.includes(profileName)).toBe(false);
    expect(body.toLowerCase().includes(email)).toBe(false);
    expect(body.includes(owner)).toBe(false);
    await route.fulfill({
      status: 200,
      json: scanResult(
        { externalReference: null, accountHint: null },
        "Google Gemini",
      ),
    });
  });
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic long receipt draft");
  const sheet = await openScanner(dialog);
  const longBill = sheet.getByRole("checkbox", {
    name: "This receipt spans multiple photos (long bill)",
    exact: true,
  });
  await longBill.check();
  const primary = sheet.getByLabel("Payment screenshot or shopping receipt", {
    exact: true,
  });
  await expect(primary).toHaveAttribute("multiple", "");
  const photos = [
    "synthetic-primary.png",
    "synthetic-page-2.png",
    "synthetic-page-3.png",
  ].map((name) => ({ name, mimeType: "image/png", buffer: png }));
  await primary.setInputFiles(photos);
  const confirmation = sheet.getByRole("checkbox", {
    name: new RegExp(redactionLabel),
  });
  await expect(
    sheet.getByText("Confirm this for every photo.", { exact: true }),
  ).toBeVisible();
  const scanButton = sheet.getByRole("button", {
    name: "Scan with AI",
    exact: true,
  });
  await confirmation.check();
  await expect(scanButton).toBeEnabled();
  await sheet
    .getByLabel("Receipt photo 2", { exact: true })
    .setInputFiles(photos[1]);
  await expect(confirmation).not.toBeChecked();
  await expect(scanButton).toBeDisabled();
  await confirmation.check();
  await sheet
    .getByRole("button", { name: "Remove photo 3", exact: true })
    .click();
  await expect(confirmation).not.toBeChecked();
  await sheet
    .getByLabel("Receipt photo 3", { exact: true })
    .setInputFiles(photos[2]);
  await confirmation.check();
  await scanButton.click();
  await expect(
    sheet.getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  expect(scanRequests).toBe(1);
  expect((await transactions(page)).length).toBe(before.length);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic long receipt draft",
  );
  await sheet.getByRole("button", { name: "Use details", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "125.50",
  );
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("too many photos or more than five megabytes combined stay local", async ({
  page,
}) => {
  await mockSettings(page);
  let scanRequests = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    scanRequests++;
    await route.fulfill({
      status: 500,
      json: { error: "Unexpected synthetic request." },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic large receipt draft");
  const sheet = await openScanner(dialog);
  await sheet
    .getByRole("checkbox", {
      name: "This receipt spans multiple photos (long bill)",
      exact: true,
    })
    .check();
  const primary = sheet.getByLabel("Payment screenshot or shopping receipt", {
    exact: true,
  });
  await primary.setInputFiles(
    [1, 2, 3, 4].map((pageNumber) => ({
      name: `synthetic-${pageNumber}.png`,
      mimeType: "image/png",
      buffer: png,
    })),
  );
  await expect(sheet.getByRole("alert")).toContainText(/3 photos|three photos/);
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  const paddedImage = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]);
  await primary.setInputFiles(
    [1, 2].map((pageNumber) => ({
      name: `synthetic-large-${pageNumber}.png`,
      mimeType: "image/png",
      buffer: paddedImage,
    })),
  );
  await expect(sheet.getByRole("alert")).toContainText(/5 MB/);
  await expect(
    sheet.getByRole("button", { name: "Scan with AI", exact: true }),
  ).toBeDisabled();
  expect(scanRequests).toBe(0);
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic large receipt draft",
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});
