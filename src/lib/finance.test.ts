import { describe, expect, it } from "vitest";
import {
  accountBalance,
  addMoney,
  billSummary,
  dailySpending,
  dashboardMetrics,
  emiSummary,
  estimatedFdValue,
  formatMoney,
  groupSummary,
  ledgerBalance,
  monthlySummary,
  sumMoney,
  transactionDirection,
  transactionNotionUrl,
  validateBillAllocation,
  validateEmiAllocation,
} from "./finance";
import {
  cloneDemoData,
  DEMO_ACCOUNT_IDS,
  DEMO_TODAY,
  DEMO_USER_ID,
} from "./seed";
import type { Bill, Transaction, WorkspaceData } from "./types";
import {
  accountSchema,
  isoDateSchema,
  snapshotSchema,
  transactionSchema,
  validateWorkspaceRecord,
} from "./validation";

function fixture(): WorkspaceData {
  const data = cloneDemoData();
  data.transactions = [];
  data.snapshots = [];
  data.bills = [];
  data.allocations = [];
  data.loans = [];
  data.emis = [];
  data.emiAllocations = [];
  data.groups = [];
  data.shares = [];
  data.settlements = [];
  data.accounts = data.accounts.map((account) => ({
    ...account,
    openingBalance: "1000.00",
    openingBalanceDate: "2026-10-01",
  }));
  return data;
}
let sequence = 20000;
function txn(
  data: WorkspaceData,
  values: Partial<Transaction> = {},
): Transaction {
  const transaction: Transaction = {
    id: `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    userId: DEMO_USER_ID,
    amount: "100.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-10-04",
    description: "Test entry",
    fromAccountId: DEMO_ACCOUNT_IDS.bank,
    toAccountId: null,
    ...values,
  };
  data.transactions.push(transaction);
  return transaction;
}
function addBill(
  data: WorkspaceData,
  accountId = DEMO_ACCOUNT_IDS.platinum,
  amount = "8000.00",
): Bill {
  const bill: Bill = {
    id: `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    userId: DEMO_USER_ID,
    accountId,
    statementAmount: amount,
    statementDate: "2026-10-01",
    dueDate: "2026-10-18",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
  };
  data.bills.push(bill);
  return bill;
}
describe("uncertain deposit values and transaction provenance", () => {
  it("does not calculate a deposit value until both contract dates and rate are confirmed", () => {
    expect(estimatedFdValue("100.00", "5", null, "2027-01-01")).toBeNull();
    expect(estimatedFdValue("100.00", "5", "2026-01-01", null)).toBeNull();
    expect(
      estimatedFdValue("100.00", null, "2026-01-01", "2027-01-01"),
    ).toBeNull();
    expect(estimatedFdValue("100.00", "5", "invalid", "2027-01-01")).toBeNull();
    expect(
      estimatedFdValue("100.00", "5", "2027-01-01", "2026-01-01"),
    ).toBeNull();
    expect(
      estimatedFdValue("100.00", "5", "2026-01-01", "2027-01-01", "2027-01-01"),
    ).toBe("105.00");
  });
  it("uses account direction for transfers and adjustments as well as purchases", () => {
    expect(
      transactionDirection({ fromAccountId: null, toAccountId: "wallet" }),
    ).toBe("incoming");
    expect(
      transactionDirection({ fromAccountId: "bank", toAccountId: null }),
    ).toBe("outgoing");
    expect(
      transactionDirection({ fromAccountId: "bank", toAccountId: "card" }),
    ).toBe("between_accounts");
    expect(
      transactionDirection({ fromAccountId: null, toAccountId: null }),
    ).toBe("unknown");
  });
  it("links only valid Notion page identities", () => {
    expect(
      transactionNotionUrl({
        sourceSystem: "notion",
        sourceObjectId: "11111111-2222-4333-8444-555555555555",
      }),
    ).toBe("https://www.notion.so/11111111222243338444555555555555");
    expect(
      transactionNotionUrl({
        sourceSystem: "notion",
        sourceObjectId: "11111111222243338444555555555555",
      }),
    ).toBe("https://www.notion.so/11111111222243338444555555555555");
    expect(
      transactionNotionUrl({
        sourceSystem: "manual",
        sourceObjectId: "11111111222243338444555555555555",
      }),
    ).toBeNull();
    expect(
      transactionNotionUrl({
        sourceSystem: "notion",
        sourceObjectId: "https://untrusted.invalid/",
      }),
    ).toBeNull();
    expect(
      transactionNotionUrl({ sourceSystem: "notion", sourceObjectId: null }),
    ).toBeNull();
  });
});
describe("exact ledger arithmetic", () => {
  it("sums decimal cents exactly and formats Indian currency", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(addMoney("1403.60", "0.40")).toBe("1404.00");
    expect(formatMoney("1234567.89")).toBe("₹12,34,567.89");
    expect(sumMoney(Array(1000).fill("0.01"))).toBe("10.00");
  });
  it("counts a card purchase once and makes the repayment reduce cash and debt", () => {
    const data = fixture();
    txn(data, { fromAccountId: DEMO_ACCOUNT_IDS.platinum });
    txn(data, { kind: "bill_payment", toAccountId: DEMO_ACCOUNT_IDS.platinum });
    expect(monthlySummary(data, "2026-10").gross).toBe("100.00");
    expect(ledgerBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY)).toBe(
      "900.00",
    );
    expect(ledgerBalance(data, DEMO_ACCOUNT_IDS.platinum, DEMO_TODAY)).toBe(
      "1000.00",
    );
  });
  it("does not count wallet funding or loan disbursal as spending or income", () => {
    const data = fixture();
    txn(data, {
      kind: "transfer",
      amount: "31.00",
      toAccountId: DEMO_ACCOUNT_IDS.wallet,
    });
    txn(data, { amount: "201.00", fromAccountId: DEMO_ACCOUNT_IDS.wallet });
    txn(data, {
      kind: "transfer",
      amount: "9700.00",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      externalPayer: "Fictional lender",
    });
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      gross: "201.00",
      income: "0.00",
      expenseCount: 1,
    });
    expect(ledgerBalance(data, DEMO_ACCOUNT_IDS.wallet, DEMO_TODAY)).toBe(
      "830.00",
    );
  });
  it("preserves reimbursement differences and separates returned transfers", () => {
    const data = fixture();
    const purchase = txn(data, { amount: "1403.60" });
    txn(data, {
      kind: "refund",
      amount: "1404.00",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      refundOfTransactionId: purchase.id,
    });
    const transfer = txn(data, { kind: "transfer", amount: "2000.00" });
    txn(data, {
      kind: "refund",
      amount: "2000.00",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      refundOfTransactionId: transfer.id,
    });
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      gross: "1403.60",
      refunds: "1403.60",
      unexplainedRefunds: "0.40",
      net: "0.00",
      income: "0.00",
    });
    expect(ledgerBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY)).toBe(
      "1000.40",
    );
  });
  it("caps multiple reimbursements at the purchase amount across calendar months", () => {
    const data = fixture();
    const purchase = txn(data, { occurredOn: "2026-09-20", amount: "100.00" });
    txn(data, {
      kind: "refund",
      occurredOn: "2026-09-25",
      amount: "60.00",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      refundOfTransactionId: purchase.id,
    });
    txn(data, {
      kind: "refund",
      occurredOn: "2026-10-02",
      amount: "50.00",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      refundOfTransactionId: purchase.id,
    });
    expect(monthlySummary(data, "2026-09")).toMatchObject({
      refunds: "60.00",
      unexplainedRefunds: "0.00",
    });
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      refunds: "40.00",
      unexplainedRefunds: "10.00",
    });
  });
  it("excludes undated, pending and voided entries from dated totals and balances", () => {
    const data = fixture();
    txn(data, { occurredOn: null });
    txn(data, { status: "pending_review" });
    txn(data, { status: "voided" });
    expect(monthlySummary(data, "2026-10").gross).toBe("0.00");
    expect(ledgerBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY)).toBe(
      "1000.00",
    );
  });
  it("reconciles to the reported date and keeps unknown opening balances unknown", () => {
    const data = fixture();
    txn(data, { occurredOn: "2026-10-03" });
    txn(data, { occurredOn: "2026-10-08", amount: "200.00" });
    data.snapshots.push({
      id: "snapshot",
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_IDS.bank,
      asOf: "2026-10-04T08:00:00Z",
      reportedBalance: "900.00",
      source: "bank_statement",
      verifiedByUser: true,
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      reported: "900.00",
      calculated: "900.00",
      difference: "0.00",
      calculatedAsOf: "2026-10-04",
      reconciliation: "matched",
    });
    data.accounts[0].openingBalance = null;
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY).reconciliation,
    ).toBe("unknown");
  });
});
describe("updated bank and wallet balances", () => {
  function report(
    data: WorkspaceData,
    accountId = DEMO_ACCOUNT_IDS.bank,
    reportedBalance = "900.10",
    asOf = "2026-10-04T08:00:00Z",
  ) {
    data.snapshots.push({
      id: `snapshot-${data.snapshots.length}`,
      userId: DEMO_USER_ID,
      accountId,
      asOf,
      reportedBalance,
      source: "user_report",
      verifiedByUser: true,
    });
  }
  it("updates bank cash after a posted expense without rewriting the report or reconciliation", () => {
    const data = fixture();
    txn(data, { occurredOn: "2026-10-03", amount: "100.00" });
    report(data);
    const originalSnapshots = JSON.stringify(data.snapshots);
    const baseline = accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY);
    const expense = txn(data, { occurredOn: "2026-10-05", amount: "0.20" });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      current: "899.90",
      currentSource: "snapshot",
      currentAsOf: DEMO_TODAY,
      movementsSinceSnapshot: 1,
      reported: baseline.reported,
      calculated: baseline.calculated,
      difference: baseline.difference,
      reconciliation: baseline.reconciliation,
    });
    expect(JSON.stringify(data.snapshots)).toBe(originalSnapshots);
    expense.amount = "0.30";
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY).current,
    ).toBe("899.80");
    expense.status = "voided";
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY).current,
    ).toBe("900.10");
  });
  it("does not count history or the snapshot calendar day twice, including later-entered history", () => {
    const data = fixture();
    report(data, DEMO_ACCOUNT_IDS.bank, "900.10", "2026-10-03T19:00:00Z");
    txn(data, { occurredOn: "2026-10-03", amount: "400.00" });
    txn(data, {
      occurredOn: "2026-10-04",
      amount: "500.00",
      createdAt: "2026-10-09T12:00:00Z",
    });
    txn(data, { occurredOn: "2026-10-05", amount: "0.20" });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      current: "899.90",
      movementsSinceSnapshot: 1,
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, "2026-10-04").current,
    ).toBe("900.10");
  });
  it("applies posted income, refunds, repayments and both sides of transfers with decimal arithmetic", () => {
    const data = fixture();
    report(data, DEMO_ACCOUNT_IDS.bank, "900.10");
    report(data, DEMO_ACCOUNT_IDS.savings, "100.20");
    report(data, DEMO_ACCOUNT_IDS.wallet, "20.10");
    const before = dashboardMetrics(data, "2026-10", DEMO_TODAY);
    const expense = txn(data, { occurredOn: "2026-10-05", amount: "0.20" });
    txn(data, {
      kind: "income",
      occurredOn: "2026-10-05",
      amount: "0.30",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
    });
    txn(data, {
      kind: "refund",
      occurredOn: "2026-10-05",
      amount: "0.10",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      refundOfTransactionId: expense.id,
    });
    txn(data, {
      kind: "bill_payment",
      occurredOn: "2026-10-05",
      amount: "0.40",
      toAccountId: DEMO_ACCOUNT_IDS.platinum,
    });
    txn(data, {
      kind: "transfer",
      occurredOn: "2026-10-06",
      amount: "10.05",
      toAccountId: DEMO_ACCOUNT_IDS.savings,
    });
    txn(data, {
      kind: "transfer",
      occurredOn: "2026-10-06",
      amount: "0.15",
      toAccountId: DEMO_ACCOUNT_IDS.wallet,
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY).current,
    ).toBe("889.70");
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.savings, DEMO_TODAY).current,
    ).toBe("110.25");
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.wallet, DEMO_TODAY).current,
    ).toBe("20.25");
    const after = dashboardMetrics(data, "2026-10", DEMO_TODAY);
    expect(after.bankBalance).toBe(addMoney(before.bankBalance, "-0.35"));
    expect(after.updatedBankCount).toBe(2);
  });
  it("excludes pending, voided, undated, future and other-user rows", () => {
    const data = fixture();
    report(data);
    for (const values of [
      { status: "pending_review" as const, occurredOn: "2026-10-05" },
      { status: "voided" as const, occurredOn: "2026-10-05" },
      { occurredOn: null },
      { occurredOn: "2026-10-10" },
      { occurredOn: "2026-10-05", userId: "another-user" },
    ])
      txn(data, values);
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      current: "900.10",
      movementsSinceSnapshot: 0,
    });
  });
  it("resets the baseline at a newer valid snapshot and ignores future or other-user snapshots", () => {
    const data = fixture();
    report(data);
    txn(data, { occurredOn: "2026-10-05", amount: "0.20" });
    report(data, DEMO_ACCOUNT_IDS.bank, "899.90", "2026-10-06T08:00:00Z");
    txn(data, { occurredOn: "2026-10-07", amount: "0.30" });
    report(data, DEMO_ACCOUNT_IDS.bank, "1.00", "2026-10-10T08:00:00Z");
    data.snapshots.push({
      ...data.snapshots[1],
      id: "foreign-snapshot",
      userId: "another-user",
      reportedBalance: "2.00",
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      reported: "899.90",
      current: "899.60",
      movementsSinceSnapshot: 1,
    });
  });
  it("keeps the latest known cash baseline when a newer snapshot reports only another field", () => {
    const data = fixture();
    for (const account of data.accounts) account.openingBalance = null;
    report(data);
    data.snapshots.push({
      id: "newer-other-field",
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_IDS.bank,
      asOf: "2026-10-06T08:00:00Z",
      reportedAvailable: "800.00",
      source: "user_report",
      verifiedByUser: true,
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      reported: null,
      calculated: null,
      difference: null,
      reconciliation: "unknown",
      asOf: "2026-10-06T08:00:00Z",
      current: "900.10",
      currentSource: "snapshot",
      currentAsOf: "2026-10-04T08:00:00Z",
      currentBaselineAsOf: "2026-10-04T08:00:00Z",
    });
    expect(dashboardMetrics(data, "2026-10", DEMO_TODAY)).toMatchObject({
      bankBalance: "900.10",
      bankAsOf: "2026-10-04",
      knownBankCount: 1,
      reportedBankCount: 0,
    });
    txn(data, { occurredOn: "2026-10-05", amount: "0.20" });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      reported: null,
      calculated: null,
      difference: null,
      asOf: "2026-10-06T08:00:00Z",
      current: "899.90",
      currentAsOf: DEMO_TODAY,
      currentBaselineAsOf: "2026-10-04T08:00:00Z",
      movementsSinceSnapshot: 1,
    });
  });
  it("uses a known opening ledger when no balance report exists and leaves missing baselines unknown", () => {
    const data = fixture();
    txn(data, { occurredOn: "2026-10-05", amount: "0.20" });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      reported: null,
      current: "999.80",
      currentSource: "opening",
    });
    data.accounts.find(
      (account) => account.id === DEMO_ACCOUNT_IDS.bank,
    )!.openingBalance = null;
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({ current: null, currentSource: "unknown" });
    expect(
      accountBalance(data, "missing-account", DEMO_TODAY).current,
    ).toBeNull();
    data.accounts.find(
      (account) => account.id === DEMO_ACCOUNT_IDS.savings,
    )!.openingBalanceDate = "2026-10-10";
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.savings, DEMO_TODAY).current,
    ).toBeNull();
  });
  it("keeps inactive accounts and wallets outside bank totals and leaves debt snapshots unchanged", () => {
    const data = fixture();
    for (const account of data.accounts) account.openingBalance = null;
    report(data, DEMO_ACCOUNT_IDS.bank, "900.10");
    report(data, DEMO_ACCOUNT_IDS.savings, "100.20");
    report(data, DEMO_ACCOUNT_IDS.wallet, "1000.00");
    data.accounts.find(
      (account) => account.id === DEMO_ACCOUNT_IDS.savings,
    )!.active = false;
    data.snapshots.push({
      id: "debt",
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_IDS.platinum,
      asOf: "2026-10-04T08:00:00Z",
      reportedOutstanding: "50.00",
      source: "user_report",
      verifiedByUser: true,
    });
    txn(data, {
      occurredOn: "2026-10-05",
      fromAccountId: DEMO_ACCOUNT_IDS.platinum,
      amount: "10.00",
    });
    txn(data, { occurredOn: "2026-10-05", amount: "0.10" });
    expect(dashboardMetrics(data, "2026-10", DEMO_TODAY)).toMatchObject({
      bankBalance: "900.00",
      knownBankCount: 1,
      totalBankCount: 1,
      cardOutstanding: "50.00",
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.platinum, DEMO_TODAY).current,
    ).toBe("50.00");
  });
});
describe("statement allocations", () => {
  it("derives partial, overdue and paid status from valid explicit allocations", () => {
    const data = fixture();
    const bill = addBill(data);
    const payment = txn(data, {
      kind: "bill_payment",
      amount: "3000.00",
      toAccountId: bill.accountId,
    });
    data.allocations.push({
      id: "allocation-1",
      userId: DEMO_USER_ID,
      billId: bill.id,
      transactionId: payment.id,
      amount: "3000.00",
      verified: true,
    });
    expect(billSummary(data, bill, DEMO_TODAY)).toMatchObject({
      paid: "3000.00",
      remaining: "5000.00",
      status: "partial",
    });
    expect(billSummary(data, bill, "2026-10-19").status).toBe("overdue");
    bill.statementAmount = "3000.00";
    expect(billSummary(data, bill, DEMO_TODAY).status).toBe("paid");
  });
  it("keeps provisional matches out of already paid and never invents a due date", () => {
    const data = fixture();
    const bill = addBill(data);
    const payment = txn(data, {
      kind: "bill_payment",
      amount: "3000.00",
      toAccountId: bill.accountId,
    });
    data.allocations.push({
      id: "allocation-1",
      userId: DEMO_USER_ID,
      billId: bill.id,
      transactionId: payment.id,
      amount: "3000.00",
      verified: false,
    });
    data.bills[0].dueDate = null;
    expect(billSummary(data, bill, DEMO_TODAY)).toMatchObject({
      paid: "0.00",
      provisional: "3000.00",
      remaining: "8000.00",
      status: "unknown",
    });
  });
  it("prevents over-allocation across statements and rejects wrong source/target/status", () => {
    const data = fixture();
    const bill = addBill(data);
    const other = addBill(data);
    const payment = txn(data, {
      kind: "bill_payment",
      amount: "3000.00",
      toAccountId: bill.accountId,
    });
    data.allocations.push({
      id: "allocation-1",
      userId: DEMO_USER_ID,
      billId: bill.id,
      transactionId: payment.id,
      amount: "2500.00",
      verified: true,
    });
    expect(
      validateBillAllocation(data, other.id, payment.id, "500.01").valid,
    ).toBe(false);
    expect(
      validateBillAllocation(data, other.id, payment.id, "500.00").valid,
    ).toBe(true);
    expect(
      validateBillAllocation(data, other.id, payment.id, "0.001").valid,
    ).toBe(false);
    payment.toAccountId = DEMO_ACCOUNT_IDS.rewards;
    expect(
      validateBillAllocation(data, other.id, payment.id, "100.00").valid,
    ).toBe(false);
    payment.toAccountId = bill.accountId;
    payment.status = "pending_review";
    expect(
      validateBillAllocation(data, other.id, payment.id, "100.00").valid,
    ).toBe(false);
    payment.status = "posted";
    payment.fromAccountId = DEMO_ACCOUNT_IDS.secured;
    expect(
      validateBillAllocation(data, other.id, payment.id, "100.00").valid,
    ).toBe(false);
  });
  it("rejects an allocation belonging to a different owner", () => {
    const data = fixture();
    const bill = addBill(data);
    const payment = txn(data, {
      kind: "bill_payment",
      toAccountId: bill.accountId,
      userId: "another-owner",
    });
    expect(
      validateBillAllocation(data, bill.id, payment.id, "100.00").valid,
    ).toBe(false);
  });
});
describe("installments, deposits, shared costs and input validation", () => {
  it("makes net chart days sum exactly to net monthly spending, allowing earlier-purchase refund days below zero", () => {
    const data = fixture();
    const previousPurchase = txn(data, {
      occurredOn: "2026-09-25",
      amount: "150.00",
    });
    txn(data, {
      occurredOn: "2026-10-02",
      kind: "refund",
      amount: "150.40",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      refundOfTransactionId: previousPurchase.id,
    });
    txn(data, { occurredOn: "2026-10-05", amount: "200.00" });
    const daily = dailySpending(data, "2026-10", { net: true });
    expect(daily[1].amount).toBe("-150.00");
    expect(sumMoney(daily.map((day) => day.amount))).toBe(
      monthlySummary(data, "2026-10").net,
    );
    expect(daily.at(-1)?.cumulative).toBe("50.00");
    expect(dailySpending(data, "2026-10")[1].amount).toBe("0.00");
  });
  it("uses the Indian calendar day for snapshots near midnight UTC", () => {
    const data = fixture();
    txn(data, { occurredOn: "2026-10-09" });
    data.snapshots.push({
      id: "snapshot",
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_IDS.bank,
      asOf: "2026-10-08T19:00:00Z",
      reportedBalance: "900.00",
      source: "user_report",
      verifiedByUser: true,
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, DEMO_TODAY),
    ).toMatchObject({
      calculatedAsOf: "2026-10-09",
      calculated: "900.00",
      reconciliation: "matched",
    });
    expect(
      accountBalance(data, DEMO_ACCOUNT_IDS.bank, "2026-10-08").reported,
    ).toBeNull();
  });
  it("rejects empty snapshots and statement edits that would hide reserved allocations", () => {
    const data = cloneDemoData();
    expect(
      snapshotSchema.safeParse({
        id: data.snapshots[0].id,
        userId: DEMO_USER_ID,
        accountId: DEMO_ACCOUNT_IDS.bank,
        asOf: "2026-10-09T12:00:00+05:30",
        source: "user_report",
        verifiedByUser: false,
      }).success,
    ).toBe(false);
    expect(() =>
      validateWorkspaceRecord(
        data,
        "bills",
        { ...data.bills[0], statementAmount: "9999.00" },
        DEMO_USER_ID,
      ),
    ).toThrow(/allocations/);
    expect(() =>
      validateWorkspaceRecord(
        data,
        "bills",
        { ...data.bills[0], statementCredits: "8800.01" },
        DEMO_USER_ID,
      ),
    ).toThrow(/allocations/);
    expect(() =>
      validateWorkspaceRecord(
        data,
        "bills",
        { ...data.bills[0], dueDate: "2026-09-01" },
        DEMO_USER_ID,
      ),
    ).toThrow(/due date/);
  });
  it("guards allocated payment edits at the shared provider boundary while allowing a note correction", () => {
    const data = cloneDemoData();
    const payment = data.transactions.find(
      (t) => t.id === data.allocations[0].transactionId,
    )!;
    expect(() =>
      validateWorkspaceRecord(
        data,
        "transactions",
        { ...payment, amount: "9000.00" },
        DEMO_USER_ID,
      ),
    ).toThrow(/allocations/);
    expect(() =>
      validateWorkspaceRecord(
        data,
        "transactions",
        { ...payment, status: "voided" },
        DEMO_USER_ID,
      ),
    ).toThrow(/allocations/);
    expect(
      validateWorkspaceRecord(
        data,
        "transactions",
        { ...payment, notes: "Reference verified." },
        DEMO_USER_ID,
      ).notes,
    ).toBe("Reference verified.");
  });
  it("rejects refund links to another owner or an unposted purchase", () => {
    const data = fixture();
    const original = txn(data, { status: "pending_review" });
    const refund = txn(data, {
      kind: "refund",
      fromAccountId: null,
      toAccountId: DEMO_ACCOUNT_IDS.bank,
      refundOfTransactionId: original.id,
    });
    expect(() =>
      validateWorkspaceRecord(data, "transactions", refund, DEMO_USER_ID),
    ).toThrow(/posted purchase/);
    original.status = "posted";
    original.userId = "20000000-0000-4000-8000-000000000001";
    expect(() =>
      validateWorkspaceRecord(data, "transactions", refund, DEMO_USER_ID),
    ).toThrow(/posted purchase/);
  });
  it("accepts a confirmed posted debit to an external lender and closes the remaining installment", () => {
    const data = cloneDemoData();
    const emi = data.emis[1];
    const payment = txn(data, {
      kind: "bill_payment",
      amount: "7300.00",
      toAccountId: null,
      notes: "Confirmed external lender: Willow Finance.",
    });
    expect(
      validateWorkspaceRecord(data, "transactions", payment, DEMO_USER_ID)
        .status,
    ).toBe("posted");
    expect(
      validateEmiAllocation(data, emi.id, payment.id, "7300.00").valid,
    ).toBe(true);
    data.emiAllocations.push({
      id: "00000000-0000-4000-8000-000000090001",
      userId: DEMO_USER_ID,
      emiId: emi.id,
      transactionId: payment.id,
      amount: "7300.00",
    });
    expect(emiSummary(data, emi, DEMO_TODAY)).toMatchObject({
      paid: "9800.00",
      remaining: "0.00",
      status: "paid",
    });
  });
  it("calculates EMI partial payments and enforces the confirmed source account", () => {
    const data = cloneDemoData();
    const emi = data.emis[1];
    const payment = data.transactions.find(
      (t) => t.description === "Willow Finance partial installment 2",
    )!;
    expect(emiSummary(data, emi, DEMO_TODAY)).toMatchObject({
      paid: "2500.00",
      remaining: "7300.00",
      status: "partial",
    });
    expect(emiSummary(data, emi, "2026-10-11").status).toBe("overdue");
    payment.fromAccountId = DEMO_ACCOUNT_IDS.savings;
    expect(
      validateEmiAllocation(data, emi.id, payment.id, "100.00").valid,
    ).toBe(false);
  });
  it("excludes fixed deposits and wallets from reported bank cash", () => {
    const data = cloneDemoData();
    const metrics = dashboardMetrics(data, "2026-10", DEMO_TODAY);
    const expected = sumMoney(
      data.accounts
        .filter((a) => a.kind === "bank")
        .map(
          (a) =>
            data.snapshots.find((s) => s.accountId === a.id)?.reportedBalance,
        ),
    );
    expect(metrics.bankBalance).toBe(expected);
    expect(metrics.reviewCount).toBe(3);
    expect(
      data.fixedDeposits.some(
        (fd) => fd.pledged && fd.backingAccountId === DEMO_ACCOUNT_IDS.secured,
      ),
    ).toBe(true);
  });
  it("keeps shared contributions distinct from income and tracks the unsettled share", () => {
    const data = cloneDemoData();
    expect(groupSummary(data, data.groups[0].id)).toMatchObject({
      total: "2520.00",
      ownerShare: "840.00",
      incoming: "1260.00",
      receivable: "420.00",
      unallocated: "0.00",
      unmatchedContributions: "0.00",
      sharesComplete: true,
    });
    expect(monthlySummary(data, "2026-10").income).toBe("62000.00");
  });
  it("does not invent receivables when group shares have not been confirmed", () => {
    const data = cloneDemoData();
    data.shares = [];
    expect(groupSummary(data, data.groups[0].id)).toMatchObject({
      receivable: "0.00",
      payable: "0.00",
      unallocated: "2520.00",
      unmatchedContributions: "1260.00",
      sharesComplete: false,
    });
  });
  it("rejects impossible dates, full account identifiers and undated posted rows", () => {
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    const data = cloneDemoData();
    expect(
      accountSchema.safeParse({
        ...data.accounts[0],
        maskedSuffix: "1234567890",
      }).success,
    ).toBe(false);
    expect(
      transactionSchema.safeParse({ ...data.transactions[0], occurredOn: null })
        .success,
    ).toBe(false);
    expect(
      transactionSchema.safeParse({
        ...data.transactions[0],
        status: "pending_review",
        occurredOn: null,
      }).success,
    ).toBe(true);
  });
});
