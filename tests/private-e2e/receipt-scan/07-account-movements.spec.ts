import { randomBytes, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { formatMoney } from "../../../src/lib/finance";
import type { WorkspaceData } from "../../../src/lib/types";
import { type ReceiptExtraction } from "../../../src/lib/receipt-scan";
import {
  test,
  expect,
  mockSettings,
  scanResult,
  mockScan,
  workspace,
  bankName,
  openEditor,
  scan,
  receipt,
  chooseBank,
  reviewLabel,
  chooseBalanceTreatments,
  transactions,
} from "./fixtures";

test("correcting a screenshot transaction type clears its accounts and requires a fresh review", async ({
  page,
}) => {
  await mockSettings(page);
  const result = scanResult({
    description: "Synthetic corrected screenshot refund",
    merchant: null,
    amount: "24.25",
  });
  await mockScan(page, result);
  const before = await workspace(page);
  const bank = before.accounts.find((account) => account.name === bankName)!;
  const dialog = await openEditor(page);
  await scan(dialog);
  await receipt(dialog)
    .getByRole("button", { name: "Use details", exact: true })
    .click();
  await chooseBank(dialog);
  const review = dialog.getByRole("checkbox", {
    name: reviewLabel,
    exact: true,
  });
  await review.check();
  await dialog
    .getByRole("combobox", { name: "Transaction type", exact: true })
    .selectOption("refund");
  await expect(
    dialog.getByRole("heading", { name: "Add New Refund", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveCount(0);
  const destination = dialog.getByRole("combobox", {
    name: "To account",
    exact: true,
  });
  await expect(destination).toHaveValue("");
  await expect(review).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await destination.selectOption({ label: bankName });
  await chooseBalanceTreatments(dialog, "excluded");
  await review.check();
  await dialog
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = (await transactions(page)).filter(
    (row) => row.sourceObjectId === result.fingerprint,
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    kind: "refund",
    status: "posted",
    amount: "24.25",
    fromAccountId: null,
    toAccountId: bank.id,
    fromBalanceSnapshotId: null,
    toBalanceSnapshotId: before.snapshots.find(
      (snapshot) => snapshot.accountId === bank.id,
    )!.id,
  });
});

const receiptMovementCases = [
  { name: "bank purchase", kind: "expense", from: bankName },
  { name: "wallet purchase", kind: "expense", from: "Pocket Wallet" },
  { name: "credit card purchase", kind: "expense", from: "Aster Platinum" },
  { name: "Pay Later purchase", kind: "expense", from: "Luma Pay Later" },
  { name: "bank income", kind: "income", to: bankName },
  { name: "wallet income", kind: "income", to: "Pocket Wallet" },
  { name: "bank refund", kind: "refund", to: bankName },
  { name: "credit card refund", kind: "refund", to: "Aster Platinum" },
  { name: "Pay Later refund", kind: "refund", to: "Luma Pay Later" },
  {
    name: "wallet funding",
    kind: "transfer",
    from: bankName,
    to: "Pocket Wallet",
  },
  {
    name: "credit card repayment",
    kind: "bill_payment",
    from: bankName,
    to: "Aster Platinum",
  },
  {
    name: "Pay Later repayment",
    kind: "bill_payment",
    from: bankName,
    to: "Luma Pay Later",
  },
] as const;

for (const movement of receiptMovementCases)
  test(`a successful screenshot posts one ${movement.name} with both account directions after reload`, async ({
    page,
  }) => {
    const from = "from" in movement ? movement.from : null;
    const to = "to" in movement ? movement.to : null;
    const description = `Synthetic screenshot ${movement.name}`;
    const fingerprint = randomBytes(32).toString("hex");
    const initial = await workspace(page);
    const involved = initial.accounts.filter(
      (account) => account.name === from || account.name === to,
    );
    expect(involved).toHaveLength(from && to ? 2 : 1);
    const cardAmount = (account: WorkspaceData["accounts"][number]) =>
      page
        .locator(
          account.kind === "bank" || account.kind === "wallet"
            ? "a.bank-card"
            : "a.credit-card",
        )
        .filter({ hasText: account.name })
        .locator(
          account.kind === "bank" || account.kind === "wallet"
            ? ":scope > strong"
            : ".credit-amount > strong",
        );
    const cardAvailable = (account: WorkspaceData["accounts"][number]) =>
      page
        .locator("a.credit-card")
        .filter({ hasText: account.name })
        .locator(".credit-meta > span")
        .filter({ hasText: /^Available/ })
        .locator("b");
    const expected = new Map<string, string>();
    const expectedAvailable = new Map<string, string>();
    await page.goto("/accounts");
    for (const account of involved) {
      const baseline = new Decimal(
        (await cardAmount(account).innerText()).replace(/[^\d.-]/g, ""),
      );
      const liability =
        account.kind === "credit_card" || account.kind === "pay_later";
      const outgoing = account.name === from;
      const delta = outgoing === liability ? "45.00" : "-45.00";
      expected.set(account.id, formatMoney(baseline.plus(delta).toFixed(2)));
      if (liability) {
        const availableText = await cardAvailable(account).innerText();
        expect(availableText).toMatch(/^₹/);
        const availableBaseline = new Decimal(
          availableText.replace(/[^\d.-]/g, ""),
        );
        expectedAvailable.set(
          account.id,
          formatMoney(
            availableBaseline.plus(outgoing ? "-45.00" : "45.00").toFixed(2),
          ),
        );
      }
    }
    await page.goto("/dashboard");
    const spendingCard = page
      .getByRole("button", {
        name: "This month's spending details",
        exact: true,
      })
      .locator(":scope > strong");
    const spendingBefore = new Decimal(
      (await spendingCard.innerText()).replace(/[^\d.-]/g, ""),
    );
    await mockSettings(page);
    await mockScan(page, {
      ...scanResult({
        kind: movement.kind,
        merchant: null,
        description,
        amount: "45.00",
        externalReference: `SYNTHETIC-${randomUUID()}`,
        occurredOn: "2026-10-09",
        accountHint: "Do not automatically select this synthetic account hint",
      }),
      fingerprint,
    });
    const dialog = await openEditor(page);
    await scan(dialog);
    await receipt(dialog)
      .getByRole("button", { name: "Use details", exact: true })
      .click();
    await expect(
      dialog.getByRole("combobox", { name: "Transaction type", exact: true }),
    ).toHaveValue(movement.kind);
    await expect(
      dialog.getByRole("checkbox", {
        name: "I confirmed that this payment was completed.",
        exact: true,
      }),
    ).toHaveCount(0);
    for (const [side, accountName] of [
      ["From account", from],
      ["To account", to],
    ] as const) {
      if (!accountName) continue;
      const account = dialog.getByRole("combobox", { name: side, exact: true });
      await expect(account).toHaveValue("");
      await account.selectOption({ label: accountName });
    }
    const treatments = dialog.getByRole("combobox", {
      name: /^Does the .+ balance already include this payment\?$/,
    });
    await expect(treatments).toHaveCount(involved.length);
    for (const treatment of await treatments.all())
      await expect(treatment).toHaveValue("");
    await chooseBalanceTreatments(dialog, "excluded");
    await dialog
      .getByRole("checkbox", { name: reviewLabel, exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const after = await workspace(page);
    const saved = after.transactions.filter(
      (row) => row.sourceObjectId === fingerprint,
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      kind: movement.kind,
      status: "posted",
      amount: "45.00",
      fromAccountId:
        involved.find((account) => account.name === from)?.id ?? null,
      toAccountId: involved.find((account) => account.name === to)?.id ?? null,
    });
    for (const account of involved) {
      const snapshot = initial.snapshots.find(
        (row) => row.accountId === account.id,
      );
      expect(snapshot).toBeTruthy();
      expect(
        saved[0][
          account.name === from
            ? "fromBalanceSnapshotId"
            : "toBalanceSnapshotId"
        ],
      ).toBe(snapshot!.id);
    }
    await page.goto("/accounts");
    for (const account of involved) {
      await expect(cardAmount(account)).toHaveText(expected.get(account.id)!);
      if (expectedAvailable.has(account.id))
        await expect(cardAvailable(account)).toHaveText(
          expectedAvailable.get(account.id)!,
        );
    }
    await page.reload();
    for (const account of involved) {
      await expect(cardAmount(account)).toHaveText(expected.get(account.id)!);
      if (expectedAvailable.has(account.id))
        await expect(cardAvailable(account)).toHaveText(
          expectedAvailable.get(account.id)!,
        );
    }
    expect(
      (await transactions(page)).filter(
        (row) => row.sourceObjectId === fingerprint,
      ),
    ).toHaveLength(1);
    await page.goto("/dashboard");
    await expect(spendingCard).toHaveText(
      formatMoney(
        spendingBefore
          .plus(movement.kind === "expense" ? "45.00" : "0.00")
          .toFixed(2),
      ),
    );
  });

const uncertainReceiptCases: Array<{
  name: string;
  extraction: Partial<ReceiptExtraction>;
}> = [
  { name: "unknown payment", extraction: { paymentStatus: "unknown" } },
  { name: "pending payment", extraction: { paymentStatus: "pending" } },
  { name: "failed payment", extraction: { paymentStatus: "failed" } },
  { name: "low confidence", extraction: { confidence: "low" } },
  { name: "unknown document", extraction: { documentType: "unknown" } },
];

for (const uncertainty of uncertainReceiptCases)
  test(`a ${uncertainty.name} screenshot requires fresh human completion confirmation before posting`, async ({
    page,
  }) => {
    await mockSettings(page);
    const fingerprint = randomBytes(32).toString("hex");
    await mockScan(page, {
      ...scanResult({
        ...uncertainty.extraction,
        description: `Synthetic confirmed ${uncertainty.name}`,
        merchant: null,
        externalReference: `SYNTHETIC-${randomUUID()}`,
      }),
      fingerprint,
    });
    const dialog = await openEditor(page);
    await scan(dialog);
    await receipt(dialog)
      .getByRole("button", { name: "Use details", exact: true })
      .click();
    const completed = dialog.getByRole("checkbox", {
      name: "I confirmed that this payment was completed.",
      exact: true,
    });
    const review = dialog.getByRole("checkbox", {
      name: reviewLabel,
      exact: true,
    });
    await expect(completed).not.toBeChecked();
    await chooseBank(dialog);
    await completed.check();
    await review.check();
    await dialog.getByLabel("Amount · ₹", { exact: true }).fill("46.25");
    await expect(completed).not.toBeChecked();
    await expect(review).not.toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Save transaction", exact: true }),
    ).toBeDisabled();
    await completed.check();
    await review.check();
    await dialog
      .getByRole("button", { name: "Save transaction", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const saved = (await transactions(page)).filter(
      (row) => row.sourceObjectId === fingerprint,
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ status: "posted", amount: "46.25" });
    await page.reload();
    expect(
      (await transactions(page)).filter(
        (row) => row.sourceObjectId === fingerprint,
      ),
    ).toHaveLength(1);
  });
