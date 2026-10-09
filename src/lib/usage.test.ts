import { describe, expect, it } from "vitest";
import { accountUsage, usageBand, usageSummary } from "./usage";
import type { Account, AccountSnapshot, Bill, WorkspaceData } from "./types";

const AS_OF = "2026-10-09";
const OWNER = "owner";

function fixture(): WorkspaceData {
  return {
    accounts: [],
    snapshots: [],
    transactions: [],
    bills: [],
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

function addAccount(
  data: WorkspaceData,
  values: Partial<Account> = {},
): Account {
  const account: Account = {
    id: `account-${data.accounts.length}`,
    userId: OWNER,
    name: "Test card",
    institution: "Test bank",
    kind: "credit_card",
    maskedSuffix: "1234",
    creditLimit: "1000.00",
    active: true,
    ...values,
  };
  data.accounts.push(account);
  return account;
}

function addSnapshot(
  data: WorkspaceData,
  accountId: string,
  values: Partial<AccountSnapshot> = {},
): AccountSnapshot {
  const snapshot: AccountSnapshot = {
    id: `snapshot-${data.snapshots.length}`,
    accountId,
    userId: OWNER,
    asOf: AS_OF,
    source: "user_report",
    verifiedByUser: true,
    ...values,
  };
  data.snapshots.push(snapshot);
  return snapshot;
}

function addBill(
  data: WorkspaceData,
  accountId: string,
  values: Partial<Bill> = {},
): Bill {
  const bill: Bill = {
    id: `bill-${data.bills.length}`,
    userId: OWNER,
    accountId,
    statementAmount: "170.00",
    statementDate: "2026-10-05",
    periodStart: "2026-10-05",
    periodEnd: "2026-10-05",
    dueDate: "2026-10-20",
    ...values,
  };
  data.bills.push(bill);
  return bill;
}

describe("usage bands", () => {
  it.each([
    [0, "smart"],
    [29.99, "smart"],
    [30, "medium"],
    [69.99, "medium"],
    [70, "high"],
    [100, "high"],
    [125, "high"],
    [null, "unknown"],
    [Number.NaN, "unknown"],
  ] as const)("classifies %s percent as %s", (percentage, band) => {
    expect(usageBand(percentage)).toBe(band);
  });
});

describe("account usage", () => {
  it("prefers reported utilized credit over outstanding and preserves zero", () => {
    const data = fixture();
    const account = addAccount(data);
    addSnapshot(data, account.id, {
      reportedUtilized: "0.00",
      reportedOutstanding: "600.00",
      reportedAvailable: "200.00",
    });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: "0.00",
      limit: "1000.00",
      percentage: 0,
      progress: 0,
      band: "smart",
      provenance: "reported",
      asOf: AS_OF,
    });
  });

  it("uses outstanding when utilized credit is not reported", () => {
    const data = fixture();
    const account = addAccount(data, { kind: "pay_later" });
    addSnapshot(data, account.id, { reportedOutstanding: "300.00" });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: "300.00",
      percentage: 30,
      band: "medium",
      provenance: "reported",
    });
  });

  it("retains an over-limit percentage while bounding the displayed progress", () => {
    const data = fixture();
    const account = addAccount(data);
    addSnapshot(data, account.id, { reportedUtilized: "1250.00" });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: "1250.00",
      percentage: 125,
      progress: 100,
      band: "high",
    });
  });

  it("infers used credit only from valid available credit and a positive limit", () => {
    const data = fixture();
    const account = addAccount(data, { creditLimit: "1000.10" });
    const snapshot = addSnapshot(data, account.id, {
      reportedAvailable: "700.00",
    });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: "300.10",
      provenance: "inferred",
      band: "medium",
    });
    snapshot.reportedAvailable = "1000.11";
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: null,
      percentage: null,
      band: "unknown",
      provenance: "unknown",
    });
  });

  it.each([null, undefined, "0.00", "-100.00", "invalid"])(
    "does not assign a healthy usage level to an unusable limit %s",
    (creditLimit) => {
      const data = fixture();
      const account = addAccount(data, { creditLimit });
      addSnapshot(data, account.id, { reportedOutstanding: "100.00" });
      expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
        used: "100.00",
        percentage: null,
        progress: 0,
        band: "unknown",
      });
    },
  );

  it("uses only owner reports at the cutoff, interpreted in the workspace timezone", () => {
    const data = fixture();
    const account = addAccount(data);
    addSnapshot(data, account.id, {
      asOf: "2026-10-08",
      reportedUtilized: "100.00",
    });
    addSnapshot(data, account.id, {
      asOf: "2026-10-09T18:20:00Z",
      reportedUtilized: "300.00",
    });
    addSnapshot(data, account.id, {
      asOf: "2026-10-09T18:40:00Z",
      reportedUtilized: "900.00",
    });
    addSnapshot(data, account.id, {
      userId: "another-owner",
      asOf: "2026-10-09T18:25:00Z",
      reportedUtilized: "800.00",
    });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: "300.00",
      asOf: "2026-10-09T18:20:00Z",
    });
    expect(accountUsage(data, account.id, "2026-10-08").used).toBe("100.00");
  });

  it("does not invent used credit from transactions or the opening balance", () => {
    const data = fixture();
    const account = addAccount(data, {
      openingBalance: "700.00",
      openingBalanceDate: "2026-10-01",
    });
    data.transactions.push({
      id: "expense",
      userId: OWNER,
      amount: "100.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-04",
      description: "Card purchase",
      fromAccountId: account.id,
      toAccountId: null,
    });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: null,
      percentage: null,
      band: "unknown",
      provenance: "unknown",
      asOf: null,
    });
  });

  it("shows a known unpaid Pay Later bill as minimum exposure without a total-use percentage", () => {
    const data = fixture();
    const account = addAccount(data, {
      kind: "pay_later",
      creditLimit: "2100.00",
    });
    addBill(data, account.id);
    // A foreign owner's bill cannot establish exposure in this account.
    addBill(data, account.id, {
      userId: "another-owner",
      statementAmount: "900.00",
    });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: "170.00",
      limit: "2100.00",
      percentage: null,
      progress: 0,
      band: "unknown",
      provenance: "partial",
      asOf: "2026-10-05",
    });
    expect(usageSummary(data, "pay_later", AS_OF)).toMatchObject({
      knownUsageCount: 1,
      knownLimitCount: 1,
      complete: false,
      percentage: null,
    });
  });

  it("does not infer a zero account balance when the only known bill is paid", () => {
    const data = fixture();
    const account = addAccount(data, { kind: "pay_later" });
    const bank = addAccount(data, { kind: "bank", creditLimit: null });
    const bill = addBill(data, account.id);
    data.transactions.push({
      id: "known-payment",
      userId: OWNER,
      amount: "170.00",
      currency: "INR",
      kind: "bill_payment",
      status: "posted",
      occurredOn: "2026-10-07",
      description: "Known order payment",
      fromAccountId: bank.id,
      toAccountId: account.id,
    });
    data.allocations.push({
      id: "known-allocation",
      userId: OWNER,
      billId: bill.id,
      transactionId: "known-payment",
      amount: "170.00",
      verified: true,
    });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: null,
      percentage: null,
      progress: 0,
      band: "unknown",
      provenance: "unknown",
      asOf: null,
    });
    // A later confirmed payment cannot reduce exposure at an earlier cutoff.
    expect(accountUsage(data, account.id, "2026-10-06")).toMatchObject({
      used: "170.00",
      provenance: "partial",
      percentage: null,
    });
  });

  it("excludes future bill dates and never treats a credit-card bill as full usage", () => {
    const data = fixture();
    const account = addAccount(data, { kind: "pay_later" });
    addBill(data, account.id, {
      statementDate: "2026-10-10",
      periodStart: "2026-10-10",
      periodEnd: "2026-10-10",
    });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: null,
      provenance: "unknown",
    });
    const card = addAccount(data);
    addBill(data, card.id);
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({
      used: null,
      provenance: "unknown",
    });
  });

  it("keeps an account-wide report authoritative over separate known bills", () => {
    const data = fixture();
    const account = addAccount(data, { kind: "pay_later" });
    addBill(data, account.id);
    addSnapshot(data, account.id, { reportedOutstanding: "0.00" });
    expect(accountUsage(data, account.id, AS_OF)).toMatchObject({
      used: "0.00",
      percentage: 0,
      provenance: "reported",
      band: "smart",
    });
  });
});

describe("combined usage", () => {
  it("includes every active account of the requested kind without truncation", () => {
    const data = fixture();
    for (let index = 0; index < 8; index++) {
      const account = addAccount(data, { creditLimit: "0.10" });
      addSnapshot(data, account.id, { reportedUtilized: "0.03" });
    }
    const inactive = addAccount(data, { active: false });
    addSnapshot(data, inactive.id, { reportedUtilized: "950.00" });
    const otherKind = addAccount(data, { kind: "pay_later" });
    addSnapshot(data, otherKind.id, { reportedOutstanding: "750.00" });

    expect(usageSummary(data, "credit_card", AS_OF)).toMatchObject({
      count: 8,
      knownUsageCount: 8,
      knownLimitCount: 8,
      usedTotal: "0.24",
      limitTotal: "0.80",
      percentage: 30,
      progress: 30,
      band: "medium",
      complete: true,
    });
    expect(usageSummary(data, "credit_card", AS_OF).rows).toHaveLength(8);
    expect(usageSummary(data, "pay_later", AS_OF)).toMatchObject({
      count: 1,
      usedTotal: "750.00",
      percentage: 75,
      band: "high",
    });
  });

  it("keeps known totals while marking missing usage or limits as incomplete", () => {
    const data = fixture();
    const complete = addAccount(data);
    addSnapshot(data, complete.id, { reportedUtilized: "200.00" });
    const noLimit = addAccount(data, { creditLimit: null });
    addSnapshot(data, noLimit.id, { reportedOutstanding: "100.00" });
    addAccount(data, { creditLimit: "500.00" });
    const zeroLimit = addAccount(data, { creditLimit: "0.00" });
    addSnapshot(data, zeroLimit.id, { reportedUtilized: "0.00" });

    expect(usageSummary(data, "credit_card", AS_OF)).toMatchObject({
      usedTotal: "300.00",
      limitTotal: "1500.00",
      knownUsageCount: 3,
      knownLimitCount: 2,
      count: 4,
      complete: false,
      percentage: null,
      progress: 0,
      band: "unknown",
    });
  });

  it("does not label an empty account group as zero percent smart usage", () => {
    expect(usageSummary(fixture(), "pay_later", AS_OF)).toMatchObject({
      rows: [],
      count: 0,
      usedTotal: "0.00",
      limitTotal: "0.00",
      percentage: null,
      progress: 0,
      band: "unknown",
      complete: false,
    });
  });

  it("adds minimum known bill exposure to reported debt while keeping aggregate coverage partial", () => {
    const data = fixture();
    const reported = addAccount(data, {
      kind: "pay_later",
      creditLimit: "5000.00",
    });
    addSnapshot(data, reported.id, { reportedOutstanding: "246.80" });
    const partial = addAccount(data, {
      kind: "pay_later",
      creditLimit: "2100.00",
    });
    addBill(data, partial.id);
    expect(usageSummary(data, "pay_later", AS_OF)).toMatchObject({
      usedTotal: "416.80",
      limitTotal: "7100.00",
      knownUsageCount: 2,
      knownLimitCount: 2,
      count: 2,
      complete: false,
      percentage: null,
      progress: 0,
      band: "unknown",
    });
  });
});
