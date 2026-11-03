import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  test,
  expect,
  mockSettings,
  scanResult,
  transactions,
  baseURL,
  receiptDescription,
  merchant,
  mockScan,
  openEditor,
  scan,
  receipt,
  closeEditor,
  upload,
  assertNoOverflow,
  chooseBank,
  reviewLabel,
  bankName,
  chooseBalanceTreatments,
} from "./fixtures";

test("possible duplicates warn before review and cancellation adds nothing", async ({
  page,
}) => {
  await mockSettings(page);
  const result = scanResult();
  const template = (await transactions(page)).find(
    (row) =>
      row.kind === "expense" && row.status === "posted" && row.fromAccountId,
  );
  expect(template).toBeTruthy();
  const seedResponse = await page.request.post("/api/workspace", {
    headers: { Origin: baseURL },
    data: {
      collection: "transactions",
      record: {
        ...template!,
        id: randomUUID(),
        description: receiptDescription,
        merchant,
        amount: result.extraction.amount,
        occurredOn: result.extraction.occurredOn,
        externalReference: result.extraction.externalReference,
        sourceSystem: "receipt_ai",
        sourceObjectId: result.fingerprint,
      },
    },
  });
  expect(seedResponse.ok()).toBe(true);
  await mockScan(page, result);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await expect(
    receipt(dialog).getByText("Possible duplicate transactions", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    receiptDescription,
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("foreign currency stays in review and cannot populate the INR form", async ({
  page,
}) => {
  await mockSettings(page);
  await mockScan(page, scanResult({ currency: "USD", amount: "9.95" }));
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog.locator('textarea[name="description"]').fill("Manual INR draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("77.89");
  await upload(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "USD 9.95",
  );
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeDisabled();
  await expect(
    receipt(dialog).getByText(/these details cannot be applied/),
  ).toBeVisible();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Manual INR draft",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "77.89",
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("receipt scanning keeps the seller in Description and Swiggy in Platform through saving and editing", async ({
  page,
}) => {
  const seller = "Bikkgane Biryani";
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSettings(page);
  await mockScan(page, {
    ...scanResult({
      merchant: seller,
      platform: "Swiggy",
      description: "Lunch",
      category: "Food",
      amount: "28.00",
      externalReference: "SYNTHETIC-SELLER-PLATFORM-1",
    }),
    fingerprint: "b".repeat(64),
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  const platform = dialog.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(platform).toHaveValue("Swiggy");
  await expect(
    platform.getByRole("option", { name: seller, exact: true }),
  ).toHaveCount(0);
  const description = dialog.getByRole("textbox", {
    name: "Description",
    exact: true,
  });
  await expect(description).toHaveValue(/Bikkgane Biryani/);
  await expect(description).toHaveValue(/Lunch/);
  await assertNoOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await dialog.screenshot({
    path: path.resolve("artifacts/receipt-seller-platform-mobile.png"),
  });
  await chooseBank(dialog);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after).toHaveLength(before.length + 1);
  const saved = after.find((row) => row.sourceObjectId === "b".repeat(64));
  expect(saved).toMatchObject({
    merchant: seller,
    platform: "Swiggy",
    amount: "28.00",
    category: "Food",
    status: "posted",
  });
  expect(saved?.description).toContain(seller);
  if (!saved)
    throw new Error("Synthetic seller/platform receipt was not saved.");
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill(saved.description);
  await page
    .getByRole("button", { name: `Edit ${saved.description}`, exact: true })
    .click();
  const edit = page.locator(".transaction-modal");
  await expect(
    edit.getByRole("combobox", { name: "Platform / Source", exact: true }),
  ).toHaveValue("Swiggy");
  await expect(
    edit.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue(saved.description);
  await edit.getByLabel("Amount · ₹", { exact: true }).fill("29.00");
  await edit
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(edit).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved.id),
  ).toMatchObject({
    merchant: seller,
    platform: "Swiggy",
    description: saved.description,
    amount: "29.00",
  });
});

test("a receipt seller alone never infers a delivery platform", async ({
  page,
}) => {
  const seller = "Bikkgane Biryani";
  await mockSettings(page);
  await mockScan(
    page,
    scanResult({
      merchant: seller,
      platform: null,
      description: "Lunch",
      category: "Food",
    }),
  );
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  const platform = dialog.getByRole("combobox", {
    name: "Platform / Source",
    exact: true,
  });
  await expect(platform).toHaveValue("");
  await expect(
    platform.getByRole("option", { name: seller, exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue(/Bikkgane Biryani/);
  await closeEditor(dialog);
  expect(await transactions(page)).toEqual(before);
});

for (const kind of ["income", "refund"] as const)
  test(`receipt autofill adopts ${kind} and requires a receiving account`, async ({
    page,
  }) => {
    const description = `Synthetic received ${kind} at Synthetic Shopping Corner`;
    await mockSettings(page);
    const result = {
      ...scanResult({
        kind,
        description,
        amount: "42.17",
        externalReference: `SYNTHETIC-RECEIVED-${kind}`,
      }),
      fingerprint: randomBytes(32).toString("hex"),
    };
    await mockScan(page, result);
    const before = await transactions(page);
    const dialog = await openEditor(page);
    await scan(dialog);
    await receipt(dialog)
      .getByRole("button", { name: "Use details", exact: true })
      .click();
    await expect(
      dialog.getByRole("combobox", { name: "Transaction type", exact: true }),
    ).toHaveValue(kind);
    await expect(
      dialog.getByRole("heading", {
        name: `Add New ${kind === "income" ? "Income" : "Refund"}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "From account", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: "To account", exact: true }),
    ).toHaveValue("");
    await expect(
      dialog.getByRole("combobox", { name: "Status", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("checkbox", { name: reviewLabel, exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(/account/i);
    expect(await transactions(page)).toEqual(before);
    await dialog
      .getByRole("combobox", { name: "To account", exact: true })
      .selectOption({ label: bankName });
    await chooseBalanceTreatments(dialog, "excluded");
    await dialog
      .getByRole("checkbox", { name: reviewLabel, exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const after = await transactions(page);
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((row) => row.description === description)).toMatchObject({
      kind,
      amount: "42.17",
      status: "posted",
      sourceSystem: "receipt_ai",
      fromAccountId: null,
      toAccountId: expect.any(String),
      sourceObjectId: result.fingerprint,
    });
  });
