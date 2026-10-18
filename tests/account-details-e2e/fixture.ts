import { expect, test, type Page } from "@playwright/test";
import { cloneDemoData, DEMO_USER_ID } from "../../src/lib/seed";
import type {
  Account,
  AccountSnapshot,
  Transaction,
  WorkspaceData,
} from "../../src/lib/types";

export const OWNER = DEMO_USER_ID;
export const OTHER_OWNER = "20000000-0000-4000-8000-000000000001";
export const TODAY = "2026-10-16";
export const MONTH = "2026-10";
export const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

export function fixture() {
  const account = (
    value: number,
    name: string,
    kind: Account["kind"],
    fields: Partial<Account> = {},
  ): Account => ({
    id: id(value),
    userId: OWNER,
    name,
    institution: "Synthetic Bank",
    kind,
    maskedSuffix: String(value).padStart(4, "0"),
    active: true,
    ...fields,
  });
  const bank = account(101, "Synthetic current", "bank", {
    institution: "State Bank of India",
    maskedSuffix: "1234567890121111",
  });
  const bankTwin = account(102, "Synthetic savings", "bank", {
    institution: "State Bank of India",
    maskedSuffix: "2222",
  });
  const unknownBank = account(103, "Synthetic unreported", "bank", {
    institution: "Unlisted Synthetic Bank",
  });
  const credit = account(104, "Synthetic card one", "credit_card", {
    institution: "HDFC Bank",
    creditLimit: "1000.00",
  });
  const creditTwin = account(105, "Synthetic card two", "credit_card", {
    institution: "HDFC Bank",
    creditLimit: "2000.00",
  });
  const payLater = account(106, "Synthetic Amazon one", "pay_later", {
    institution: "Amazon Pay Later",
    creditLimit: "1000.00",
  });
  const payLaterTwin = account(107, "Synthetic Amazon two", "pay_later", {
    institution: "Amazon Pay Later",
    creditLimit: "2000.00",
  });
  const partial = account(108, "Synthetic bill-only provider", "pay_later", {
    institution: "Unlisted Deferred",
    creditLimit: "500.00",
  });
  const foreign = account(109, "FOREIGN ACCOUNT MUST STAY HIDDEN", "bank", {
    userId: OTHER_OWNER,
    institution: "State Bank of India",
  });
  const snapshot = (
    value: number,
    selected: Account,
    fields: Partial<AccountSnapshot>,
  ): AccountSnapshot => ({
    id: id(value),
    userId: selected.userId,
    accountId: selected.id,
    asOf: "2026-10-14T08:00:00Z",
    source: "user_report",
    verifiedByUser: true,
    ...fields,
  });
  const bankReport = snapshot(201, bank, { reportedBalance: "1000.00" });
  const reports = [
    bankReport,
    snapshot(202, bankTwin, { reportedBalance: "2000.00" }),
    snapshot(204, credit, {
      reportedOutstanding: "150.00",
      reportedUtilized: "200.00",
      reportedAvailable: "800.00",
    }),
    snapshot(205, creditTwin, {
      reportedOutstanding: "250.00",
      reportedUtilized: "300.00",
      reportedAvailable: "1700.00",
    }),
    snapshot(206, payLater, {
      reportedOutstanding: "350.00",
      reportedUtilized: "400.00",
      reportedAvailable: "600.00",
    }),
    snapshot(207, payLaterTwin, {
      reportedOutstanding: "650.00",
      reportedUtilized: "700.00",
      reportedAvailable: "1300.00",
    }),
    snapshot(209, foreign, { reportedBalance: "99999.00" }),
  ];
  const transaction = (
    value: number,
    description: string,
    fields: Partial<Transaction> = {},
  ): Transaction => ({
    id: id(value),
    userId: OWNER,
    amount: "10.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-10-15",
    description,
    fromAccountId: bank.id,
    toAccountId: null,
    category: "Other",
    ...fields,
  });
  const transactions = [
    transaction(301, "Current bank expense"),
    transaction(302, "Same-day confirmed bank expense", {
      occurredOn: "2026-10-14",
      amount: "20.00",
      fromBalanceSnapshotId: bankReport.id,
    }),
    transaction(303, "Earlier bank income", {
      kind: "income",
      occurredOn: "2026-10-13",
      amount: "30.00",
      fromAccountId: null,
      toAccountId: bank.id,
    }),
    transaction(304, "Pending bank purchase", {
      status: "pending_review",
      occurredOn: "2026-10-12",
      amount: "40.00",
    }),
    transaction(305, "Voided bank purchase", {
      status: "voided",
      occurredOn: "2026-10-11",
      amount: "50.00",
    }),
    transaction(306, "Older bank history", {
      occurredOn: "2026-09-29",
      amount: "70.00",
    }),
    transaction(307, "Undated bank review", {
      status: "pending_review",
      occurredOn: null,
      amount: "80.00",
    }),
    transaction(308, "Future bank payment", {
      occurredOn: "2026-10-20",
      amount: "90.00",
    }),
    transaction(309, "Other SBI account payment", {
      fromAccountId: bankTwin.id,
      amount: "21.00",
    }),
    transaction(310, "FOREIGN TRANSACTION MUST STAY HIDDEN", {
      userId: OTHER_OWNER,
      amount: "9999.00",
    }),
    transaction(311, "Current card purchase", {
      fromAccountId: credit.id,
      amount: "45.00",
    }),
    transaction(312, "Other HDFC card payment", {
      fromAccountId: creditTwin.id,
      amount: "22.00",
    }),
    transaction(313, "Current Amazon purchase", {
      fromAccountId: payLater.id,
      amount: "25.00",
    }),
    transaction(314, "Amazon refund", {
      kind: "refund",
      fromAccountId: null,
      toAccountId: payLater.id,
      occurredOn: "2026-10-16",
      amount: "5.00",
    }),
    transaction(315, "Other Amazon account purchase", {
      fromAccountId: payLaterTwin.id,
      amount: "23.00",
    }),
    transaction(316, "Old Amazon history", {
      fromAccountId: payLater.id,
      occurredOn: "2026-08-15",
      amount: "33.00",
    }),
    transaction(317, "Old card history", {
      fromAccountId: credit.id,
      occurredOn: "2026-08-10",
      amount: "15.00",
    }),
  ];
  const data: WorkspaceData = {
    ...cloneDemoData(),
    accounts: [
      bank,
      bankTwin,
      unknownBank,
      credit,
      creditTwin,
      payLater,
      payLaterTwin,
      partial,
      foreign,
    ],
    snapshots: reports,
    transactions,
    bills: [
      {
        id: id(401),
        userId: OWNER,
        accountId: partial.id,
        statementAmount: "170.00",
        statementDate: "2026-10-01",
        dueDate: "2026-10-20",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      },
    ],
    allocations: [],
    fixedDeposits: [],
    loans: [],
    emis: [],
    emiAllocations: [],
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
    unknownBank,
    credit,
    creditTwin,
    payLater,
    payLaterTwin,
    partial,
    foreign,
  };
}

export function ownedWorkspace(data: WorkspaceData): WorkspaceData {
  return Object.fromEntries(
    Object.entries(data).map(([key, rows]) => [
      key,
      rows.filter((row: { userId: string }) => row.userId === OWNER),
    ]),
  ) as unknown as WorkspaceData;
}

export async function mockWorkspace(page: Page, data: WorkspaceData) {
  const mutations: string[] = [];
  const unexpectedApis: string[] = [];
  const errors: string[] = [];
  const initial = JSON.stringify(data);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-16T06:30:00.000Z") });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL!).origin)
      return route.abort();
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
            displayName: "Synthetic account reviewer",
            timezone: "Asia/Kolkata",
          },
          workspace: ownedWorkspace(data),
        },
      });
    if (request.method() !== "GET" && url.pathname.startsWith("/api/"))
      mutations.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === "/api/ai/settings")
      return route.fulfill({
        status: 200,
        json: { available: true, configured: false, ownerManaged: true },
      });
    if (url.pathname.startsWith("/api/")) {
      unexpectedApis.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  return () => {
    expect(mutations).toEqual([]);
    expect(unexpectedApis).toEqual([]);
    expect(errors).toEqual([]);
    expect(JSON.stringify(data)).toBe(initial);
  };
}

export async function dashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Synthetic$/, level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".dashboard-card-bank")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

export async function noOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
}
