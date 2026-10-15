import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";
import type { Transaction } from "../../src/lib/types";

test("editing a receipt description preserves its older same-day credit confirmation", async ({
  page,
}) => {
  const template = cloneDemoData();
  const account = {
    ...template.accounts.find((row) => row.kind === "credit_card")!,
    name: "Synthetic receipt anchor card",
    creditLimit: "1000.00",
    openingBalance: null,
    openingBalanceDate: null,
  };
  const originalReport = {
    ...template.snapshots.find((row) => row.accountId === account.id)!,
    id: randomUUID(),
    asOf: "2026-10-09T08:00:00Z",
    reportedBalance: null,
    reportedOutstanding: "100.00",
    reportedUtilized: null,
    reportedAvailable: null,
    reportedUnbilled: null,
  };
  const newerReport = {
    ...originalReport,
    id: randomUUID(),
    asOf: "2026-10-09T09:00:00Z",
    reportedOutstanding: null,
    reportedUtilized: "145.00",
  };
  const originalTransaction: Transaction = {
    id: randomUUID(),
    userId: DEMO_USER_ID,
    amount: "45.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-10-09",
    description: "Synthetic receipt before description correction",
    category: "Shopping",
    fromAccountId: account.id,
    toAccountId: null,
    fromBalanceSnapshotId: originalReport.id,
    toBalanceSnapshotId: null,
    sourceSystem: "receipt_ai",
    sourceObjectId: "a".repeat(64),
  };
  const workspace = {
    ...Object.fromEntries(Object.keys(template).map((key) => [key, []])),
    accounts: [account],
    snapshots: [originalReport, newerReport],
    transactions: [originalTransaction],
  };
  const submitted: Transaction[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
    if (url.pathname === "/api/workspace") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as {
          collection: string;
          record: Transaction;
        };
        expect(body.collection).toBe("transactions");
        submitted.push(body.record);
        workspace.transactions = [body.record];
        return route.fulfill({ status: 200, json: { record: body.record } });
      }
      return route.fulfill({
        status: 200,
        json: {
          configured: true,
          backend: "supabase",
          authenticated: true,
          signupEnabled: false,
          userId: DEMO_USER_ID,
          profile: { displayName: "Synthetic anchor reviewer" },
          workspace,
        },
      });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });

  const creditCard = page
    .locator("a.credit-card")
    .filter({ hasText: account.name });
  const currentOutstanding = page
    .locator(".info-banner")
    .filter({ hasText: "Current outstanding:" });
  await page.goto("/accounts");
  await expect(creditCard.locator(".credit-amount > strong")).toHaveText(
    "₹145.00",
  );
  await creditCard.click();
  await expect(currentOutstanding).toContainText(
    "Current outstanding: ₹145.00",
  );
  await page
    .getByRole("button", {
      name: `Edit ${originalTransaction.description}`,
      exact: true,
    })
    .click();
  const editor = page.locator(".transaction-modal");
  await expect(
    editor.getByRole("combobox", {
      name: `Does the ${account.name} balance already include this payment?`,
      exact: true,
    }),
  ).toHaveCount(1);
  // Only the description changes; no new balance treatment is selected.
  const updatedDescription = "Synthetic receipt after description correction";
  await editor
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(updatedDescription);
  await editor
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({
    id: originalTransaction.id,
    amount: "45.00",
    status: "posted",
    description: updatedDescription,
    fromAccountId: account.id,
    toAccountId: null,
    fromBalanceSnapshotId: originalReport.id,
    toBalanceSnapshotId: null,
  });
  await expect(currentOutstanding).toContainText(
    "Current outstanding: ₹145.00",
  );
  await page.reload();
  await expect(currentOutstanding).toContainText(
    "Current outstanding: ₹145.00",
  );
  await page.goto("/accounts");
  await expect(creditCard.locator(".credit-amount > strong")).toHaveText(
    "₹145.00",
  );
  expect(workspace.transactions).toHaveLength(1);
  expect(workspace.transactions[0].fromBalanceSnapshotId).toBe(
    originalReport.id,
  );
  expect(submitted).toHaveLength(1);
});
