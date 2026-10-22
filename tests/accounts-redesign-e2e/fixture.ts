import { expect, type BrowserContext, type Page } from "@playwright/test";
import type {
  Account,
  AccountSnapshot,
  EmiAgreement,
  Transaction,
  WorkspaceData,
  WorkspaceDataWithEmi,
} from "../../src/lib/types";
import { workspaceFixture } from "../refinement-e2e/fixture";

export const OWNER = "10000000-0000-4000-8000-000000000001";
export const OTHER_OWNER = "20000000-0000-4000-8000-000000000001";
export const TODAY = "2026-10-22";
export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Fictional account names deliberately avoid provider-specific legacy fixtures. */
export function fixture() {
  const account = (
    n: number,
    name: string,
    kind: Account["kind"],
    fields: Partial<Account> = {},
  ): Account => ({
    id: id(91000 + n),
    userId: OWNER,
    active: true,
    name,
    kind,
    institution:
      kind === "bank"
        ? "QA Bank"
        : kind === "wallet"
          ? "QA Wallet"
          : "QA Issuer",
    maskedSuffix: `${4100 + n}`,
    ...fields,
  });
  const bank = account(1, "QA Current", "bank", {
    maskedSuffix: "1234567890120425",
  });
  const bankTwin = account(2, "QA Savings", "bank", {
    openingBalance: "2000.00",
    openingBalanceDate: "2026-10-01",
  });
  const card = account(3, "QA Rewards", "credit_card", {
    creditLimit: "5000.00",
  });
  const cardTwin = account(4, "QA Everyday", "credit_card", {
    creditLimit: "10000.00",
  });
  const payLater = account(5, "QA Flex", "pay_later", {
    institution: "QA Deferred",
    creditLimit: "6000.00",
  });
  const payLaterTwin = account(6, "QA Split", "pay_later", {
    institution: "QA Deferred",
    creditLimit: "3000.00",
  });
  const wallet = account(7, "QA Daily wallet", "wallet", {
    openingBalance: "500.00",
    openingBalanceDate: "2026-10-01",
  });
  const walletTwin = account(8, "QA Spare wallet", "wallet", {
    maskedSuffix: "",
  });
  const archived = account(9, "QA Archived bank", "bank", { active: false });
  const foreign = account(10, "FOREIGN ACCOUNT MUST STAY HIDDEN", "bank", {
    userId: OTHER_OWNER,
  });
  const snapshot = (
    n: number,
    selected: Account,
    fields: Partial<AccountSnapshot>,
  ): AccountSnapshot => ({
    id: id(92000 + n),
    userId: selected.userId,
    accountId: selected.id,
    asOf: "2026-10-21T08:00:00Z",
    source: "app_screenshot",
    verifiedByUser: true,
    ...fields,
  });
  const transaction = (
    n: number,
    description: string,
    changes: Partial<Transaction> = {},
  ): Transaction => ({
    id: id(93000 + n),
    userId: OWNER,
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: TODAY,
    description,
    merchant: null,
    amount: "17.00",
    category: "Shopping",
    platform: "QA Marketplace",
    fromAccountId: bank.id,
    toAccountId: null,
    ...changes,
  });
  const twins = [
    transaction(1, "QA Twin purchase", { merchant: "QA Stationery Shop" }),
    transaction(2, "QA Twin purchase", { merchant: "QA Stationery Shop" }),
  ];
  const selfTransfer = transaction(3, "QA Same-account movement", {
    kind: "transfer",
    amount: "11.00",
    category: null,
    platform: null,
    toAccountId: bank.id,
  });
  const transfer = transaction(4, "QA Wallet transfer", {
    kind: "transfer",
    amount: "30.00",
    category: null,
    platform: null,
    toAccountId: wallet.id,
  });
  const emi: EmiAgreement = {
    id: id(94001),
    userId: OWNER,
    accountId: payLater.id,
    purchaseDate: "2026-10-20",
    merchant: "QA Marketplace",
    description: "QA Installment purchase",
    financedPrincipal: "600.00",
    totalScheduledInterest: "120.00",
    processingFee: "30.00",
    totalScheduledRepayment: "750.00",
    emiCount: 6,
    monthlyPayment: "125.00",
    principalOutstanding: "600.00",
    principalRepaid: "0.00",
    interestBilled: "0.00",
    interestPaid: "0.00",
    unbilledFutureInterest: "120.00",
    feesBilled: "0.00",
    feesPaid: "0.00",
    status: "active",
  };
  const data: WorkspaceDataWithEmi = {
    ...workspaceFixture(0),
    accounts: [
      bank,
      bankTwin,
      card,
      cardTwin,
      payLater,
      payLaterTwin,
      wallet,
      walletTwin,
      archived,
      foreign,
    ],
    snapshots: [
      snapshot(1, bank, { reportedBalance: "1000.00" }),
      snapshot(3, card, {
        reportedOutstanding: "350.00",
        reportedUtilized: "400.00",
        reportedAvailable: "4600.00",
      }),
      snapshot(4, cardTwin, {
        asOf: `${TODAY}T08:00:00Z`,
        reportedOutstanding: "900.00",
        reportedUtilized: "1100.00",
        reportedAvailable: "8900.00",
      }),
      snapshot(5, payLater, {
        asOf: `${TODAY}T08:00:00Z`,
        reportedOutstanding: "700.00",
        reportedUtilized: "800.00",
        reportedUnbilled: "730.00",
        nextStatementDate: "2026-11-01",
      }),
      snapshot(10, foreign, { reportedBalance: "99999.00" }),
    ],
    transactions: [
      ...twins,
      selfTransfer,
      transfer,
      transaction(5, "QA Purchase awaiting review", {
        status: "pending_review",
        amount: "900.00",
      }),
      transaction(6, "QA Savings income", {
        kind: "income",
        fromAccountId: null,
        toAccountId: bankTwin.id,
        amount: "10.00",
        category: null,
        platform: null,
      }),
      transaction(7, "QA Card purchase", {
        fromAccountId: card.id,
        amount: "40.00",
      }),
      transaction(8, "QA Card refund", {
        kind: "refund",
        fromAccountId: null,
        toAccountId: card.id,
        amount: "10.00",
      }),
      transaction(9, "QA Everyday purchase", {
        fromAccountId: cardTwin.id,
        amount: "25.00",
      }),
      transaction(10, "QA Flex purchase", {
        fromAccountId: payLater.id,
        amount: "600.00",
        occurredOn: "2026-10-20",
      }),
      transaction(11, "QA Split purchase", {
        fromAccountId: payLaterTwin.id,
        amount: "35.00",
      }),
      transaction(12, "QA Wallet purchase", {
        fromAccountId: wallet.id,
        amount: "20.00",
      }),
      transaction(13, "FOREIGN TRANSACTION MUST STAY HIDDEN", {
        userId: OTHER_OWNER,
        amount: "99999.00",
      }),
    ].reverse(),
    bills: [
      {
        id: id(95001),
        userId: OWNER,
        accountId: payLaterTwin.id,
        statementAmount: "100.00",
        statementDate: "2026-10-01",
        dueDate: "2026-10-28",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      },
    ],
    allocations: [],
    fixedDeposits: [],
    loans: [],
    emis: [],
    emiAllocations: [],
    emiAgreements: [emi],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
  };
  return {
    data,
    bank,
    bankTwin,
    card,
    cardTwin,
    payLater,
    payLaterTwin,
    wallet,
    walletTwin,
    archived,
    foreign,
    twins,
    selfTransfer,
    transfer,
  };
}

export async function mockWorkspace(
  context: BrowserContext,
  page: Page,
  baseURL: string,
  data: WorkspaceData,
  allowedWrites: string[] = [],
) {
  const origin = new URL(baseURL).origin;
  const initial = JSON.stringify(data);
  const writes: Array<{ collection: string; record: Record<string, unknown> }> =
    [];
  const errors: string[] = [];
  const unexpectedApis: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(`${TODAY}T06:30:00Z`) });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/workspace" && request.method() === "GET")
      return route.fulfill({
        status: 200,
        json: {
          configured: true,
          authenticated: true,
          backend: "supabase",
          signupEnabled: false,
          userId: OWNER,
          profile: {
            id: OWNER,
            displayName: "QA Account Reviewer",
            currency: "INR",
            timezone: "Asia/Kolkata",
          },
          workspace: data,
        },
      });
    if (url.pathname === "/api/workspace" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        collection: string;
        record: Record<string, unknown>;
      };
      if (allowedWrites.includes(body.collection)) {
        writes.push(body);
        const rows = data[
          body.collection as keyof WorkspaceData
        ] as unknown as Array<Record<string, unknown>>;
        const index = rows.findIndex((row) => row.id === body.record.id);
        if (index < 0) rows.push(body.record);
        else rows[index] = body.record;
        return route.fulfill({ status: 200, json: { record: body.record } });
      }
    }
    if (url.pathname === "/api/ai/settings")
      return route.fulfill({
        status: 200,
        json: { available: false, configured: false, ownerManaged: true },
      });
    if (url.pathname.startsWith("/api/")) {
      unexpectedApis.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 400,
        json: { error: "Unexpected synthetic operation" },
      });
    }
    return route.continue();
  });
  return {
    data,
    writes,
    errors,
    unexpectedApis,
    unchanged() {
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      expect(unexpectedApis).toEqual([]);
      expect(JSON.stringify(data)).toBe(initial);
    },
  };
}

export async function ready(page: Page) {
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".loading-screen")).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
