import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { Account, WorkspaceData } from "../../src/lib/types";
import {
  fixture as accountsFixture,
  mockWorkspace as mockAccountsWorkspace,
  noOverflow,
  OWNER,
  ready,
  TODAY,
} from "../accounts-redesign-e2e/fixture";

export { noOverflow, OWNER, ready, TODAY };

/** Fictional records only. No private exports, live credentials or financial data. */
export function fixture() {
  const f = accountsFixture();
  const bank: Account = {
    ...f.bank,
    name: "QA Everyday Savings",
    maskedSuffix: "0425",
    openingBalance: "1000.00",
    openingBalanceDate: "2026-10-01",
  };
  const card = { ...f.card, name: "QA Rewards Card", maskedSuffix: "3594" };
  const payLater = { ...f.payLater, name: "QA Flex Provider" };
  const wallet = { ...f.wallet, name: "QA Daily Wallet" };
  const archived = { ...f.archived, name: "QA Archived Account" };
  const data: WorkspaceData = {
    ...f.data,
    accounts: [bank, card, payLater, wallet, archived],
    snapshots: [],
    transactions: [],
    bills: [],
    auditEvents: [],
  };
  return { data, bank, card, payLater, wallet, archived };
}

export async function mockWorkspace(
  context: BrowserContext,
  page: Page,
  baseURL: string,
  data: WorkspaceData,
  allowTransactions = false,
) {
  return mockAccountsWorkspace(
    context,
    page,
    baseURL,
    data,
    allowTransactions ? ["transactions"] : [],
  );
}

export async function openEditor(page: Page) {
  await page.goto("/dashboard");
  await ready(page);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const editor = page.locator(".transaction-modal");
  await expect(editor).toBeVisible();
  return editor;
}
