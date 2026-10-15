import { describe, expect, it } from "vitest";
import { accountUsage, usageBand, usageSummary } from "./usage";
import { accountBalance, monthlySummary } from "./finance";
import type { Account, AccountSnapshot, Bill, Transaction, WorkspaceData } from "./types";

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

function addTransaction(data: WorkspaceData, values: Partial<Transaction> = {}): Transaction {
  const transaction: Transaction = {
    id: `transaction-${data.transactions.length}`,
    userId: OWNER,
    amount: "45.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: AS_OF,
    description: "Synthetic payment",
    fromAccountId: null,
    toAccountId: null,
    ...values,
  };
  data.transactions.push(transaction);
  return transaction;
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

  it("does not invent used or available credit from transactions without a baseline", () => {
    const data = fixture();
    const account = addAccount(data);
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
      available: null,
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
      available: null,
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

describe("current credit movement and evidence", () => {
  it.each(["credit_card", "pay_later"] as const)("keeps utilization, outstanding and available credit distinct for %s", (kind) => {
    const data = fixture();
    const card = addAccount(data, { kind });
    const bank = addAccount(data, { kind: "bank", creditLimit: null });
    const report = addSnapshot(data, card.id, {
      asOf: "2026-10-08T08:00:00Z",
      reportedUtilized: "300.00",
      reportedOutstanding: "200.00",
      reportedAvailable: "650.00",
    });
    addSnapshot(data, bank.id, { asOf: "2026-10-08T08:00:00Z", reportedBalance: "1000.00" });
    const purchase = addTransaction(data, { fromAccountId: card.id });
    addTransaction(data, { amount: "25.00", kind: "bill_payment", fromAccountId: bank.id, toAccountId: card.id });
    addTransaction(data, { amount: "10.00", kind: "refund", toAccountId: card.id, refundOfTransactionId: purchase.id });
    expect(monthlySummary(data, "2026-10")).toMatchObject({ gross: "45.00", refunds: "10.00" });
    for (const values of [
      { status: "pending_review" as const },
      { status: "voided" as const },
      { occurredOn: "2026-10-10" },
      { occurredOn: null },
      { userId: "another-owner" },
    ]) addTransaction(data, { fromAccountId: card.id, ...values });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({
      used: "310.00",
      currentOutstanding: "210.00",
      issuerReportedOutstanding: "200.00",
      ledgerCalculatedOutstanding: "210.00",
      available: "640.00",
      availableCredit: "640.00",
      confirmedRepayments: "25.00",
      confirmedRefunds: "10.00",
      pendingAuthorizations: null,
      movementsSinceSnapshot: 3,
    });
    expect(accountBalance(data, bank.id, AS_OF).current).toBe("975.00");
    expect(report.reportedOutstanding).toBe("200.00");
    purchase.amount = "50.00";
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "315.00", currentOutstanding: "215.00", available: "635.00" });
  });

  it("requires an exact same-day confirmation and absorbs it into a newer report", () => {
    const data = fixture();
    const card = addAccount(data);
    const report = addSnapshot(data, card.id, { asOf: `${AS_OF}T08:00:00Z`, reportedUtilized: "300.00", reportedOutstanding: "200.00", reportedAvailable: "700.00" });
    const transaction = addTransaction(data, { fromAccountId: card.id, createdAt: `${AS_OF}T12:00:00Z` });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "300.00", currentOutstanding: "200.00", available: "700.00" });
    transaction.fromBalanceSnapshotId = report.id;
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "345.00", currentOutstanding: "245.00", available: "655.00", movementsSinceSnapshot: 1 });
    addSnapshot(data, card.id, { asOf: `${AS_OF}T09:00:00Z`, reportedUtilized: "345.00", reportedOutstanding: "245.00", reportedAvailable: "655.00" });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "345.00", currentOutstanding: "245.00", available: "655.00", movementsSinceSnapshot: 0 });
  });

  it("absorbs the old confirmation when reports share an identical timestamp", () => {
    const data = fixture();
    const card = addAccount(data);
    const report = addSnapshot(data, card.id, { reportedOutstanding: "200.00" });
    addTransaction(data, { fromAccountId: card.id, fromBalanceSnapshotId: report.id });
    addSnapshot(data, card.id, { reportedOutstanding: "245.00" });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "245.00", currentOutstanding: "245.00", movementsSinceSnapshot: 0 });
  });

  it("preserves overpayments through subsequent purchases and restores available credit", () => {
    const data = fixture();
    const card = addAccount(data);
    const bank = addAccount(data, { kind: "bank", creditLimit: null });
    addSnapshot(data, card.id, { asOf: "2026-10-08", reportedOutstanding: "100.00" });
    addTransaction(data, { kind: "bill_payment", amount: "250.00", fromAccountId: bank.id, toAccountId: card.id });
    addTransaction(data, { amount: "20.00", fromAccountId: card.id });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "0.00", currentOutstanding: "0.00", availableCredit: "1130.00" });
    addTransaction(data, { amount: "150.00", fromAccountId: card.id });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "20.00", currentOutstanding: "20.00", availableCredit: "980.00" });
  });

  it("does not turn pending receipt review into an issuer hold or lower availability", () => {
    const data = fixture();
    const card = addAccount(data);
    addSnapshot(data, card.id, { reportedUtilized: "200.00" });
    addTransaction(data, { fromAccountId: card.id, amount: "80.00", status: "pending_review", sourceSystem: "receipt_ai" });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({
      used: "200.00", available: "800.00", availableCredit: "800.00",
      pendingAuthorizations: null, issuerReportedOutstanding: null,
      currentOutstanding: null, ledgerCalculatedOutstanding: null,
      availableCreditStatus: "estimated", balanceVerificationStatus: "unconfirmed",
    });
  });

  it("uses newer usage evidence instead of stale available credit, while retaining current issuer availability", () => {
    const data = fixture();
    const card = addAccount(data);
    addSnapshot(data, card.id, { asOf: "2026-10-07", reportedAvailable: "1000.00" });
    addSnapshot(data, card.id, { asOf: "2026-10-08", reportedUtilized: "500.00" });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "500.00", availableCredit: "500.00", availableCreditStatus: "estimated" });
    addSnapshot(data, card.id, { reportedUtilized: "550.00", reportedAvailable: "400.00" });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "550.00", availableCredit: "400.00", availableCreditStatus: "verified" });
  });

  it("retains the latest actual outstanding report when newer utilization differs", () => {
    const data = fixture();
    const card = addAccount(data);
    addSnapshot(data, card.id, { asOf: "2026-10-07", reportedOutstanding: "200.00" });
    addSnapshot(data, card.id, { asOf: "2026-10-08", reportedUtilized: "500.00" });
    addTransaction(data, { fromAccountId: card.id });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ used: "545.00", issuerReportedOutstanding: "200.00", currentOutstanding: "245.00" });
  });

  it("filters payment counters by date, ownership, status and bank/wallet source", () => {
    const data = fixture();
    const card = addAccount(data);
    const bank = addAccount(data, { kind: "bank" });
    const otherCard = addAccount(data);
    addTransaction(data, { kind: "bill_payment", fromAccountId: bank.id, toAccountId: card.id });
    addTransaction(data, { kind: "transfer", amount: "20.00", fromAccountId: bank.id, toAccountId: card.id, status: "pending_review" });
    addTransaction(data, { kind: "refund", amount: "10.00", toAccountId: card.id });
    for (const values of [
      { occurredOn: "2026-10-10" }, { occurredOn: null },
      { status: "voided" as const }, { userId: "another-owner" },
    ]) {
      addTransaction(data, { kind: "bill_payment", fromAccountId: bank.id, toAccountId: card.id, ...values });
      addTransaction(data, { kind: "refund", toAccountId: card.id, ...values });
    }
    addTransaction(data, { kind: "transfer", fromAccountId: otherCard.id, toAccountId: card.id });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ confirmedRepayments: "45.00", pendingRepayments: "20.00", confirmedRefunds: "10.00" });
  });

  it("keeps bill-only exposure partial and does not apply future allocations to today's due", () => {
    const data = fixture();
    const card = addAccount(data, { kind: "pay_later" });
    const bank = addAccount(data, { kind: "bank" });
    const bill = addBill(data, card.id);
    addBill(data, card.id, { userId: "another-owner", statementDate: "2026-10-08", statementAmount: "900.00" });
    const payment = addTransaction(data, { kind: "bill_payment", amount: "170.00", fromAccountId: bank.id, toAccountId: card.id, occurredOn: "2026-10-10" });
    data.allocations.push({ id: "allocation", userId: OWNER, billId: bill.id, transactionId: payment.id, amount: "170.00", verified: true });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({
      used: "170.00", billedAmount: "170.00", currentOutstanding: null,
      availableCredit: null, estimatedAvailableCredit: "830.00", creditUtilization: null,
      balanceVerificationStatus: "partial", latestBill: bill,
    });
    expect(accountUsage(data, card.id, "2026-10-10")).toMatchObject({ used: null, billedAmount: "0.00", currentOutstanding: null, balanceVerificationStatus: "unconfirmed" });
  });

  it("shows an issuer-reported unbilled amount and next statement date without inventing missing history", () => {
    const data = fixture();
    const card = addAccount(data);
    addBill(data, card.id);
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ unbilledAmount: null, statementGenerationDate: null });
    addSnapshot(data, card.id, { asOf: "2026-10-08T08:00:00Z", reportedUnbilled: "85.00", nextStatementDate: "2026-10-20" });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ unbilledAmount: "85.00", statementGenerationDate: "2026-10-20" });
    addTransaction(data, { kind: "refund", toAccountId: card.id, amount: "20.00" });
    expect(accountUsage(data, card.id, AS_OF).unbilledAmount).toBeNull();
  });

  it("recognizes verified timestamped reports on the workspace calendar day", () => {
    const data = fixture();
    const card = addAccount(data);
    const report = addSnapshot(data, card.id, { asOf: "2026-10-08T19:00:00Z", reportedOutstanding: "200.00", reportedAvailable: "800.00" });
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ balanceVerificationStatus: "verified", availableCreditStatus: "verified" });
    report.verifiedByUser = false;
    expect(accountUsage(data, card.id, AS_OF)).toMatchObject({ balanceVerificationStatus: "estimated", availableCreditStatus: "estimated" });
    expect(accountUsage(data, card.id, "2026-10-10")).toMatchObject({ balanceVerificationStatus: "estimated", availableCreditStatus: "estimated" });
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
