import path from "node:path";
import {
  test,
  expect,
  mockSettings,
  mockScan,
  scanResult,
  openEditor,
  scan,
  receipt,
  chooseBank,
  reviewLabel,
  transactions,
  upload,
  closeEditor,
  assertNoOverflow,
} from "./fixtures";

test("failed payment remains Needs review without an expense status control", async ({
  page,
}) => {
  const description = "Synthetic failed payment at Synthetic Shopping Corner";
  await mockSettings(page);
  await mockScan(
    page,
    scanResult({
      description,
      paymentStatus: "failed",
      externalReference: "SYNTHETIC-FAILED-1",
    }),
  );
  const dialog = await openEditor(page);
  await scan(dialog);
  await expect(receipt(dialog).getByLabel("AI receipt review")).toContainText(
    "failed",
  );
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("checkbox", {
      name: "I confirmed that this payment was completed.",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    dialog.getByText(/The screenshot shows a failed payment/),
  ).toBeVisible();
  await chooseBank(dialog);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (await transactions(page)).find(
    (row) => row.description === description,
  );
  expect(saved?.status).toBe("pending_review");
  await page
    .getByRole("textbox", { name: "Search transactions", exact: true })
    .fill(description);
  await page
    .getByRole("button", { name: `Edit ${description}`, exact: true })
    .click();
  const editDialog = page.locator(".transaction-modal");
  await expect(
    editDialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await editDialog.getByLabel("Amount · ₹", { exact: true }).fill("126.25");
  await editDialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(editDialog).toHaveCount(0);
  expect(
    (await transactions(page)).find((row) => row.id === saved?.id),
  ).toMatchObject({ amount: "126.25", status: "pending_review" });
});

test("unknown date stays empty instead of becoming today and saves to Needs review", async ({
  page,
}) => {
  const description = "Synthetic undated shopping at Synthetic Shopping Corner";
  await mockSettings(page);
  await mockScan(
    page,
    scanResult({
      description,
      occurredOn: null,
      externalReference: null,
      documentType: "receipt",
      paymentStatus: "unknown",
    }),
  );
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue("");
  await chooseBank(dialog);
  await expect(
    dialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (await transactions(page)).find(
    (row) => row.description === description,
  );
  expect(saved?.occurredOn).toBeNull();
  expect(saved?.status).toBe("pending_review");
});

test("removing the image or cancelling ignores a late AI result and preserves manual fields", async ({
  page,
}) => {
  await mockSettings(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic untouched draft");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("42.81");

  for (const buttonName of ["Remove image", "Cancel scan"]) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let handled = false;
    await page.route("**/api/ai/receipt", async (route) => {
      await gate;
      // The browser abort is expected. Either fulfillment or an aborted-request
      // error finishes this mock without retrying or invoking a real provider.
      await route.fulfill({ status: 200, json: scanResult() }).catch(() => {});
      handled = true;
    });
    await upload(dialog);
    const requestStarted = page.waitForRequest("**/api/ai/receipt");
    await receipt(dialog)
      .getByRole("button", { name: "Scan with AI", exact: true })
      .click();
    await requestStarted;
    await expect(
      receipt(dialog).getByRole("button", { name: "Cancel scan", exact: true }),
    ).toBeVisible();
    await receipt(dialog)
      .getByRole("button", { name: buttonName, exact: true })
      .click();
    release();
    await expect.poll(() => handled).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
      "Synthetic untouched draft",
    );
    await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
      "42.81",
    );
    await page.unroute("**/api/ai/receipt");
  }
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("provider failure can be retried without overwriting a manual draft", async ({
  page,
}) => {
  await mockSettings(page);
  const failures = [
    {
      status: 422,
      code: "unreadable_receipt",
      error:
        "The receipt could not be interpreted. Try a clearer image or enter the transaction manually.",
    },
    {
      status: 503,
      code: "scan_unavailable",
      error: "Receipt scanning is temporarily unavailable.",
    },
  ];
  let failureIndex = 0;
  await page.route("**/api/ai/receipt", async (route) => {
    const failure = failures[Math.min(failureIndex++, failures.length - 1)];
    await route.fulfill({
      status: failure.status,
      json: { error: failure.error, code: failure.code },
    });
  });
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await dialog
    .locator('textarea[name="description"]')
    .fill("Synthetic draft before outage");
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("33.21");
  await upload(dialog);
  for (const failure of failures) {
    await receipt(dialog)
      .getByRole("button", { name: "Scan with AI", exact: true })
      .click();
    await expect(
      receipt(dialog).getByText(failure.error, { exact: true }),
    ).toBeVisible();
    await expect(
      receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
    ).toHaveCount(0);
    await expect(
      receipt(dialog).getByText(failure.code, { exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
      "Synthetic draft before outage",
    );
    await expect(dialog.getByLabel("Amount · ₹", { exact: true })).toHaveValue(
      "33.21",
    );
    expect((await transactions(page)).length).toBe(before.length);
  }
  await page.unroute("**/api/ai/receipt");
  await mockScan(page);
  await receipt(dialog)
    .getByRole("button", { name: "Scan with AI", exact: true })
    .click();
  await expect(
    receipt(dialog).getByRole("button", { name: "Use details", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('textarea[name="description"]')).toHaveValue(
    "Synthetic draft before outage",
  );
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});

test("receipt review fits a 360px screen and editing resets confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockSettings(page);
  await mockScan(page);
  const before = await transactions(page);
  const dialog = await openEditor(page);
  await scan(dialog);
  await assertNoOverflow(page);
  await receipt(dialog)
    .getByLabel("AI receipt review")
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.resolve("artifacts/receipt-review-mobile.png"),
  });
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await chooseBank(dialog);
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeEnabled();
  await dialog.getByLabel("Amount · ₹", { exact: true }).fill("128.49");
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Stationery");
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await dialog
    .getByRole("checkbox", { name: reviewLabel, exact: true })
    .check();
  await dialog
    .getByRole("combobox", { name: "Platform / Source", exact: true })
    .selectOption("Amazon");
  await expect(
    dialog.getByRole("checkbox", { name: reviewLabel, exact: true }),
  ).not.toBeChecked();
  await assertNoOverflow(page);
  await closeEditor(dialog);
  expect((await transactions(page)).length).toBe(before.length);
});
