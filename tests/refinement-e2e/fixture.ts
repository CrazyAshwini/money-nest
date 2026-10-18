import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { Account, Transaction, WorkspaceData } from "../../src/lib/types";

export const userId = "10000000-0000-4000-8000-000000000001";
export const syntheticId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const fixedTime = "2026-10-18T06:30:00Z";

export function workspaceFixture(count = 6): WorkspaceData {
  const accounts: Account[] = [];
  const snapshots: WorkspaceData["snapshots"] = [];
  const transactions: Transaction[] = [];
  const bills: WorkspaceData["bills"] = [];
  for (const [kind, offset, label] of [
    ["bank", 100, "bank"],
    ["credit_card", 200, "card"],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const account: Account = {
        id: syntheticId(offset + i),
        userId,
        active: true,
        kind,
        name: `Synthetic ${label} ${i + 1}`,
        institution: `QA ${label === "bank" ? "Bank" : "Issuer"} ${i + 1}`,
        maskedSuffix: String(9100 + offset + i),
        creditLimit: kind === "credit_card" ? "10000.00" : null,
      };
      accounts.push(account);
      if (i !== 2)
        snapshots.push({
          id: syntheticId(1000 + offset + i),
          userId,
          accountId: account.id,
          asOf: "2026-10-17",
          source: "user_report",
          verifiedByUser: true,
          ...(kind === "bank"
            ? { reportedBalance: `${1000 + i * 100}.00` }
            : {
                reportedOutstanding: `${1000 + i * 100}.00`,
                reportedUtilized: `${1000 + i * 100}.00`,
              }),
        });
      if (kind === "credit_card")
        bills.push({
          id: syntheticId(2000 + offset + i),
          userId,
          accountId: account.id,
          statementAmount: `${200 + i * 10}.00`,
          statementDate: "2026-10-01",
          dueDate: "2026-10-25",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
        });
      for (let j = 0; j < 7; j++)
        transactions.push({
          id: syntheticId(3000 + offset * 10 + i * 10 + j),
          userId,
          amount: `${10 + i + j}.00`,
          currency: "INR",
          kind: j === 4 ? "refund" : j === 5 ? "transfer" : "expense",
          status: j === 1 ? "pending_review" : j === 2 ? "voided" : "posted",
          occurredOn: `2026-10-${String(10 + j).padStart(2, "0")}`,
          description: `Synthetic ${label} ${i + 1} activity ${j + 1}`,
          merchant: null,
          fromAccountId: j === 4 ? null : account.id,
          toAccountId: j === 4 ? account.id : null,
          category: "Shopping",
        });
    }
  }
  accounts.push({
    id: syntheticId(300),
    userId,
    active: true,
    kind: "pay_later",
    name: "Synthetic deferred provider",
    institution: "QA Deferred",
    maskedSuffix: "9300",
    creditLimit: "5000.00",
  });
  accounts.push({
    id: syntheticId(400),
    userId,
    active: true,
    kind: "wallet",
    name: "Synthetic wallet",
    institution: "QA Wallet",
    maskedSuffix: "9400",
  });
  accounts.push({
    id: syntheticId(500),
    userId,
    active: false,
    kind: "bank",
    name: "Synthetic archived bank",
    institution: "QA Archived",
    maskedSuffix: "9500",
  });
  return {
    accounts,
    snapshots,
    transactions: transactions.reverse(),
    bills,
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
}

export async function mockWorkspace(
  context: BrowserContext,
  page: Page,
  baseURL: string,
  data = workspaceFixture(),
  options: { backend?: "local" | "supabase" } = {},
) {
  const origin = new URL(baseURL).origin;
  const writes: { collection: string; record: Transaction }[] = [];
  const unexpectedApis: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(fixedTime) });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/workspace") {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as {
          collection: string;
          record: Transaction;
        };
        if (body.collection !== "transactions") {
          unexpectedApis.push(
            `${request.method()} ${url.pathname}: ${body.collection}`,
          );
          return route.fulfill({
            status: 400,
            json: { error: "Unexpected synthetic write" },
          });
        }
        writes.push(body);
        data.transactions.push(body.record);
        return route.fulfill({ status: 200, json: { record: body.record } });
      }
      return route.fulfill({
        status: 200,
        json: {
          configured: true,
          authenticated: true,
          backend: options.backend || "local",
          userId,
          profile: {
            id: userId,
            displayName: "Alex Synthetic",
            currency: "INR",
            timezone: "Asia/Kolkata",
            createdAt: "2026-10-01T00:00:00Z",
          },
          workspace: data,
        },
      });
    }
    if (url.pathname === "/api/ai/settings")
      return route.fulfill({
        status: 200,
        json: { available: false, configured: false, ownerManaged: true },
      });
    if (url.pathname.startsWith("/api/")) {
      unexpectedApis.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 401,
        json: { error: "Only mocked synthetic operations are allowed" },
      });
    }
    return route.continue();
  });
  return { data, writes, unexpectedApis, errors };
}

export async function ready(page: Page) {
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".loading-screen")).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
