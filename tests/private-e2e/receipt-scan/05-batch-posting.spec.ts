import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import { formatMoney } from "../../../src/lib/finance";
import type { WorkspaceData } from "../../../src/lib/types";
import {
  test,
  expect,
  mockSettings,
  batchScanResult,
  mockScan,
  transactions,
  receipt,
  png,
  reviewLabel,
  bankName,
  openEditor,
  upload,
  assertNoOverflow,
  chooseBank,
  baseURL,
} from "./fixtures";

test("two receipt transactions require separate reviews and a lost save response retries the same ID", async ({
  page,
}) => {
  await mockSettings(page);
  const result = batchScanResult(
    [
      { amount: "1084.00", occurredOn: "2026-10-11" },
      { amount: "178.00", occurredOn: "2026-10-11" },
    ],
    "c",
  );
  await mockScan(page, result);
  const before = await transactions(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.locator(".transaction-modal");
  await dialog.getByRole("button", { name: "Scan receipt", exact: true }).click();
  await receipt(dialog).getByLabel("Payment screenshot or shopping receipt").setInputFiles({
    name: "synthetic-payment.png", mimeType: "image/png", buffer: png,
  });
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  for (const index of [1, 2])
    await expect(
      sheet.getByRole("checkbox", {
        name: `Select transaction ${index}`,
        exact: true,
      }),
    ).toBeChecked();
  await expect(sheet.getByLabel("AI receipt review")).toContainText(
    "INR 1084.00",
  );
  await expect(sheet.getByLabel("AI receipt review")).toContainText(
    "INR 178.00",
  );
  expect((await transactions(page)).length).toBe(before.length);
  await sheet.getByRole("button", { name: /^Use / }).click();
  await expect(
    dialog.getByText("Transaction 1 of 2", { exact: true }),
  ).toBeVisible();
  const saveAndNext = dialog.getByRole("button", {
    name: "Save and next",
    exact: true,
  });
  const confirmation = dialog.getByRole("checkbox", {
    name: reviewLabel,
    exact: true,
  });
  const fromAccount = dialog.getByRole("button", {
    name: "Paid from",
    exact: true,
  });
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "1084.00",
  );
  await expect(fromAccount).toHaveText("Choose account");
  await expect(confirmation).not.toBeChecked();
  await expect(saveAndNext).toBeDisabled();
  await confirmation.check();
  await saveAndNext.click();
  await expect(dialog.getByRole("alert")).toContainText("Choose an account");
  expect((await transactions(page)).length).toBe(before.length);
  await fromAccount.click();
  await page.getByRole("option", { name: new RegExp(bankName) }).click();
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();

  const submittedIds: string[] = [];
  let loseFirstResponse = true;
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as {
      collection: string;
      record: WorkspaceData["transactions"][number];
    };
    if (
      body.collection !== "transactions" ||
      !result.fingerprints?.includes(body.record.sourceObjectId ?? "")
    ) {
      await route.continue();
      return;
    }
    submittedIds.push(body.record.id);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      // The server committed; only its browser response is lost.
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic response lost after saving." },
      });
      return;
    }
    await route.continue();
  });
  await saveAndNext.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic response lost after saving.",
  );
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "1084.00",
  );
  expect((await transactions(page)).length).toBe(before.length + 1);
  await saveAndNext.click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "178.00",
  );
  await expect(
    dialog.getByText("Transaction 2 of 2", { exact: true }),
  ).toBeVisible();
  await expect(fromAccount).toHaveText("Choose account");
  await expect(confirmation).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save expense", exact: true }),
  ).toBeDisabled();
  await fromAccount.click();
  await page.getByRole("option", { name: new RegExp(bankName) }).click();
  await confirmation.check();
  await dialog
    .getByRole("button", { name: "Save expense", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 2);
  const saved = result.fingerprints!.map((sourceObjectId) => {
    const matches = after.filter(
      (row) => row.sourceObjectId === sourceObjectId,
    );
    expect(matches).toHaveLength(1);
    return matches[0];
  });
  expect(saved[0]).toMatchObject({
    amount: "1084.00",
    status: "posted",
    platform: "Amazon",
  });
  expect(saved[1]).toMatchObject({
    amount: "178.00",
    status: "posted",
    platform: "Amazon",
  });
  expect(saved[0].id).not.toBe(saved[1].id);
  expect(submittedIds).toEqual([saved[0].id, saved[0].id, saved[1].id]);
  await page.reload();
  expect(
    (await transactions(page)).filter((row) =>
      result.fingerprints!.includes(row.sourceObjectId ?? ""),
    ),
  ).toHaveLength(2);
});

test("more than two extracted transactions can exclude one and keep an uncertain payment in review", async ({
  page,
}) => {
  await mockSettings(page);
  await page.setViewportSize({ width: 360, height: 800 });
  const result = batchScanResult(
    [
      { amount: "40.25" },
      { amount: "55.50" },
      { amount: "61.25" },
      { amount: "96.75", paymentStatus: "failed" },
    ],
    "d",
  );
  await mockScan(page, result);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await upload(dialog);
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  for (const index of [1, 2, 3, 4])
    await expect(
      sheet.getByRole("checkbox", {
        name: `Select transaction ${index}`,
        exact: true,
      }),
    ).toBeChecked();
  for (const amount of ["40.25", "55.50", "61.25", "96.75"])
    await expect(sheet.getByLabel("AI receipt review")).toContainText(
      `INR ${amount}`,
    );
  await sheet
    .getByRole("checkbox", { name: "Select transaction 2", exact: true })
    .uncheck();
  await assertNoOverflow(page);
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await page.screenshot({
    path: path.resolve("artifacts/receipt-batch-review-mobile.png"),
  });
  expect((await transactions(page)).length).toBe(before.length);
  await sheet.getByRole("button", { name: /^Use / }).click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "40.25",
  );
  await chooseBank(dialog);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "61.25",
  );
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("");
  await chooseBank(dialog);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "96.75",
  );
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByText(/This transaction will stay in Needs review/),
  ).toBeVisible();
  await assertNoOverflow(page);
  await chooseBank(dialog);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 3);
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![0]),
  ).toMatchObject({ amount: "40.25", status: "posted" });
  expect(
    after.some((row) => row.sourceObjectId === result.fingerprints![1]),
  ).toBe(false);
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![2]),
  ).toMatchObject({ amount: "61.25", status: "posted" });
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![3]),
  ).toMatchObject({ amount: "96.75", status: "pending_review" });
});

test("batch duplicate and foreign-currency warnings leave an independent INR transaction usable", async ({
  page,
}) => {
  await mockSettings(page);
  const result = batchScanResult(
    [
      { amount: "32.20" },
      { amount: "9.95", currency: "USD" },
      { amount: "68.40" },
    ],
    "e",
  );
  const template = (await transactions(page)).find(
    (row) =>
      row.kind === "expense" && row.status === "posted" && row.fromAccountId,
  );
  expect(template).toBeTruthy();
  const existing = {
    ...template!,
    id: randomUUID(),
    description: result.extractions![0].description!,
    amount: "32.20",
    occurredOn: "2026-10-09",
    externalReference: result.extractions![0].externalReference,
    sourceSystem: "receipt_ai",
    sourceObjectId: result.fingerprints![0],
  };
  const seedResponse = await page.request.post("/api/workspace", {
    headers: { Origin: baseURL },
    data: { collection: "transactions", record: existing },
  });
  expect(seedResponse.ok()).toBe(true);
  await mockScan(page, result);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await upload(dialog);
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 1", exact: true }),
  ).not.toBeChecked();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 2", exact: true }),
  ).toBeDisabled();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 3", exact: true }),
  ).toBeChecked();
  await expect(
    sheet.getByText("Possible duplicate transactions", { exact: true }),
  ).toBeVisible();
  await sheet
    .getByRole("button", { name: "Review transaction 2", exact: true })
    .click();
  await expect(
    sheet.getByText(/these details cannot be applied/),
  ).toBeVisible();
  expect((await transactions(page)).length).toBe(before.length);
  const apply = sheet.getByRole("button", { name: /^Use / });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "68.40",
  );
  await chooseBank(dialog);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 1);
  expect(
    after.filter((row) => row.sourceObjectId === result.fingerprints![0]),
  ).toHaveLength(1);
  expect(
    after.some((row) => row.sourceObjectId === result.fingerprints![1]),
  ).toBe(false);
  expect(
    after.find((row) => row.sourceObjectId === result.fingerprints![2]),
  ).toMatchObject({ amount: "68.40", status: "posted" });
});

test("unconfirmed orders debit a bank only after explicit payment confirmation and each draft resets it", async ({
  page,
}) => {
  await mockSettings(page);
  const result = batchScanResult(
    [{ amount: "11.25" }, { amount: "12.50" }, { amount: "13.75" }].map(
      (entry) => ({
        ...entry,
        documentType: "receipt" as const,
        paymentStatus: "unknown" as const,
        occurredOn: "2026-10-11",
      }),
    ),
    "f",
  );
  await mockScan(page, result);
  await page.goto("/accounts");
  const balance = page
    .locator("a.bank-card")
    .filter({ hasText: bankName })
    .locator(":scope > strong");
  const baselineText = await balance.innerText();
  const baseline = new Decimal(baselineText.replace(/[^\d.-]/g, ""));
  const before = await transactions(page);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const dialog = page.locator(".transaction-modal");
  await upload(dialog);
  const sheet = receipt(dialog);
  await sheet
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    sheet.getByRole("checkbox", { name: "Select transaction 3", exact: true }),
  ).toBeChecked();
  await sheet.getByRole("button", { name: /^Use / }).click();
  const paid = dialog.getByRole("checkbox", {
    name: "I confirmed that this payment was completed.",
    exact: true,
  });
  const review = dialog.getByRole("checkbox", {
    name: reviewLabel,
    exact: true,
  });
  const account = dialog.getByRole("combobox", {
    name: "From account",
    exact: true,
  });
  await expect(paid).not.toBeChecked();
  await account.selectOption({ label: bankName });
  await review.check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "12.50",
  );
  await expect(balance).toHaveText(baselineText);
  expect(
    (await transactions(page)).find(
      (row) => row.sourceObjectId === result.fingerprints![0],
    )?.status,
  ).toBe("pending_review");
  await expect(paid).not.toBeChecked();
  await account.selectOption({ label: bankName });
  await review.check();
  await paid.check();
  await expect(review).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save and next", exact: true }),
  ).toBeDisabled();
  await review.check();
  await dialog
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
    "13.75",
  );
  await expect(paid).not.toBeChecked();
  await expect(review).not.toBeChecked();
  await expect(account).toHaveValue("");
  await expect(balance).toHaveText(
    formatMoney(baseline.minus("12.50").toFixed(2)),
  );
  await account.selectOption({ label: bankName });
  await review.check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await transactions(page);
  expect(after.length).toBe(before.length + 3);
  expect(
    result.fingerprints!.map(
      (sourceObjectId) =>
        after.find((row) => row.sourceObjectId === sourceObjectId)?.status,
    ),
  ).toEqual(["pending_review", "posted", "pending_review"]);
  await expect(balance).toHaveText(
    formatMoney(baseline.minus("12.50").toFixed(2)),
  );
  await page.reload();
  await expect(balance).toHaveText(
    formatMoney(baseline.minus("12.50").toFixed(2)),
  );
});
