import { describe, expect, it } from "vitest";
import { accountDetailView } from "./account-detail-view";
import type { Account, AccountSnapshot, Bill, Transaction, WorkspaceData } from "./types";

const OWNER = "owner";
const TODAY = "2026-10-15";
const MONTH = "2026-10";

function fixture() {
  const bank: Account = { id: "bank", userId: OWNER, name: "Bank", institution: "Synthetic bank", kind: "bank", maskedSuffix: "1234", active: true, openingBalance: "1000.00", openingBalanceDate: "2026-10-01" };
  const other: Account = { ...bank, id: "other", name: "Other bank" };
  const later: Account = { id: "later", userId: OWNER, name: "Pay Later", institution: "Synthetic provider", kind: "pay_later", maskedSuffix: "", active: true, creditLimit: "1000.00" };
  const data: WorkspaceData = {
    accounts: [bank, other, later], snapshots: [], transactions: [], bills: [], allocations: [],
    fixedDeposits: [], loans: [], emis: [], emiAllocations: [], groups: [], shares: [], settlements: [], reminders: [], auditEvents: [],
  };
  return { data, bank, other, later };
}

function transaction(data: WorkspaceData, values: Partial<Transaction> = {}) {
  const row: Transaction = {
    id: `transaction-${data.transactions.length}`, userId: OWNER, amount: "10.00", currency: "INR",
    kind: "expense", status: "posted", occurredOn: "2026-10-08", description: "Synthetic activity",
    fromAccountId: "bank", toAccountId: null, ...values,
  };
  data.transactions.push(row);
  return row;
}

function bill(data: WorkspaceData, values: Partial<Bill> = {}) {
  const row: Bill = {
    id: `bill-${data.bills.length}`, userId: OWNER, accountId: "later", statementAmount: "100.00",
    statementDate: "2026-10-01", dueDate: "2026-10-20", periodStart: "2026-09-01", periodEnd: "2026-09-30", ...values,
  };
  data.bills.push(row);
  return row;
}

function snapshot(data: WorkspaceData, values: Partial<AccountSnapshot> = {}) {
  const row: AccountSnapshot = {
    id: `snapshot-${data.snapshots.length}`, userId: OWNER, accountId: "bank", asOf: "2026-10-01",
    source: "user_report", verifiedByUser: true, ...values,
  };
  data.snapshots.push(row);
  return row;
}

describe("selected account detail presentation", () => {
  it("totals posted account legs exactly without calling transfers income or spending", () => {
    const { data, bank, other, later } = fixture();
    transaction(data, { kind: "income", amount: "100.00", fromAccountId: null, toAccountId: bank.id });
    transaction(data, { amount: "30.00" });
    transaction(data, { kind: "transfer", amount: "25.00", toAccountId: other.id });
    transaction(data, { kind: "refund", amount: "5.00", fromAccountId: null, toAccountId: bank.id });
    transaction(data, { kind: "bill_payment", amount: "40.00", toAccountId: later.id });
    transaction(data, { kind: "transfer", amount: "10.00", fromAccountId: other.id, toAccountId: bank.id });
    transaction(data, { kind: "adjustment", amount: "0.10", fromAccountId: null, toAccountId: bank.id });
    transaction(data, { kind: "transfer", amount: "90.00", toAccountId: bank.id });
    for (const values of [
      { status: "pending_review" as const }, { status: "voided" as const },
      { occurredOn: null }, { occurredOn: "2026-10-16" }, { occurredOn: "2026-09-20" }, { userId: "foreign-owner" },
    ]) transaction(data, { amount: "100.00", ...values });
    transaction(data, { fromAccountId: other.id, merchant: "Bank", platform: "Bank", description: "Bank purchase" });
    const view = accountDetailView(data, bank, MONTH, TODAY);
    expect(view.monthly).toEqual({ credits: "115.10", debits: "95.00", count: 7 });
    expect(view.balance.current).toBe("1020.10");
    expect(view.usage).toBeNull();
  });

  it("keeps a self-transfer once in recent activity and out of both monthly totals", () => {
    const { data, bank } = fixture();
    const self = transaction(data, { kind: "transfer", fromAccountId: bank.id, toAccountId: bank.id });
    const view = accountDetailView(data, bank, MONTH, TODAY);
    expect(view.recent).toEqual([self]);
    expect(view.monthly).toEqual({ credits: "0.00", debits: "0.00", count: 0 });
  });

  it("shows the latest five exact associated records without status or seller inference", () => {
    const { data, bank, other } = fixture();
    for (let day = 1; day <= 7; day++) transaction(data, { id: `day-${day}`, occurredOn: `2026-10-0${day}`, status: day === 7 ? "pending_review" : day === 6 ? "voided" : "posted" });
    transaction(data, { occurredOn: "2026-10-16" });
    transaction(data, { occurredOn: null });
    transaction(data, { occurredOn: TODAY, userId: "foreign-owner" });
    transaction(data, { occurredOn: TODAY, fromAccountId: other.id, description: "Bank", merchant: "Bank", platform: "Bank" });
    const view = accountDetailView(data, bank, MONTH, TODAY);
    expect(view.recent.map((row) => row.id)).toEqual(["day-7", "day-6", "day-5", "day-4", "day-3"]);
    expect(view.recent.map((row) => row.status)).toEqual(["pending_review", "voided", "posted", "posted", "posted"]);
  });

  it("orders undated activity last and keeps previous-month records in recent activity", () => {
    const { data, bank } = fixture();
    transaction(data, { id: "undated-b", occurredOn: null, status: "pending_review" });
    transaction(data, { id: "older", occurredOn: "2026-09-30" });
    transaction(data, { id: "undated-a", occurredOn: null, status: "voided" });
    transaction(data, { id: "dated-b", occurredOn: "2026-10-10" });
    transaction(data, { id: "dated-a", occurredOn: "2026-10-10" });
    expect(accountDetailView(data, bank, MONTH, TODAY).recent.map((row) => row.id)).toEqual(["dated-a", "dated-b", "older", "undated-a", "undated-b"]);
  });

  it.each(["bank", "wallet"] as const)("uses the actual %s balance report when a newer unrelated field is reported", (kind) => {
    const { data, bank } = fixture();
    bank.kind = kind;
    bank.openingBalance = null;
    bank.openingBalanceDate = null;
    const baseline = snapshot(data, { reportedBalance: "1000.00" });
    snapshot(data, { asOf: "2026-10-05", reportedAvailable: "900.00" });
    transaction(data, { amount: "45.00" });
    const view = accountDetailView(data, bank, MONTH, TODAY);
    expect(view.snapshot).toBe(baseline);
    expect(view.balance).toMatchObject({ current: "955.00", currentSource: "snapshot", currentBaselineAsOf: baseline.asOf });
  });

  it("passes through distinct Pay Later usage, outstanding and availability", () => {
    const { data, bank, later } = fixture();
    const report = snapshot(data, { accountId: later.id, reportedUtilized: "300.00", reportedOutstanding: "200.00", reportedAvailable: "650.00" });
    transaction(data, { fromAccountId: later.id, amount: "45.00" });
    transaction(data, { kind: "bill_payment", fromAccountId: bank.id, toAccountId: later.id, amount: "25.00" });
    transaction(data, { kind: "refund", fromAccountId: null, toAccountId: later.id, amount: "10.00" });
    const view = accountDetailView(data, later, MONTH, TODAY);
    expect(view.snapshot).toBe(report);
    expect(view.balance.current).toBe("210.00");
    expect(view.usage).toMatchObject({ used: "310.00", currentOutstanding: "210.00", issuerReportedOutstanding: "200.00", availableCredit: "640.00" });
    expect(view.monthly).toEqual({ credits: "35.00", debits: "45.00", count: 3 });
  });

  it("keeps bill-only exposure partial instead of fabricating overall outstanding", () => {
    const { data, later } = fixture();
    bill(data, { statementAmount: "170.00" });
    const view = accountDetailView(data, later, MONTH, TODAY);
    expect(view.usage).toMatchObject({ used: "170.00", provenance: "partial", currentOutstanding: null, creditUtilization: null, availableCredit: null });
    expect(view.dues).toEqual({ amount: "170.00", nextDueDate: "2026-10-20", hasUnknownDate: false, unpaidCount: 1 });
  });

  it("combines known unpaid bills, retains unknown dates and ignores future payments until posted date", () => {
    const { data, bank, later } = fixture();
    const older = bill(data, { dueDate: "2026-10-10" });
    bill(data, { statementDate: "2026-10-04", statementAmount: "40.00", dueDate: "2026-10-25" });
    bill(data, { statementDate: "2026-10-03", statementAmount: "20.00", dueDate: null });
    const paid = bill(data, { statementDate: "2026-10-05", statementAmount: "30.00", dueDate: "2026-10-12" });
    bill(data, { statementDate: "2026-10-20", statementAmount: "999.00" });
    bill(data, { userId: "foreign-owner", statementAmount: "999.00" });
    bill(data, { accountId: bank.id, statementAmount: "999.00" });
    const payment = transaction(data, { kind: "bill_payment", toAccountId: later.id, amount: "30.00", occurredOn: "2026-10-10" });
    const late = transaction(data, { kind: "bill_payment", toAccountId: later.id, amount: "100.00", occurredOn: "2026-10-18" });
    data.allocations.push(
      { id: "paid", userId: OWNER, billId: paid.id, transactionId: payment.id, amount: "30.00", verified: true },
      { id: "late", userId: OWNER, billId: older.id, transactionId: late.id, amount: "100.00", verified: true },
    );
    const view = accountDetailView(data, later, MONTH, TODAY);
    expect(view.statements).toHaveLength(4);
    expect(view.statements[0].bill).toBe(paid);
    expect(view.usage?.billedAmount).toBe("0.00");
    expect(view.dues).toEqual({ amount: "160.00", nextDueDate: "2026-10-10", hasUnknownDate: true, unpaidCount: 3 });
    expect(accountDetailView(data, later, MONTH, "2026-10-18").dues).toEqual({ amount: "60.00", nextDueDate: "2026-10-25", hasUnknownDate: true, unpaidCount: 2 });
  });

  it("keeps provisional allocations out of paid dues and excludes unposted or undated allocation payments", () => {
    const { data, later } = fixture();
    const statement = bill(data);
    for (const [id, amount, status, occurredOn, verified] of [
      ["confirmed", "20.00", "posted", "2026-10-10", true],
      ["provisional", "30.00", "posted", "2026-10-10", false],
      ["pending", "20.00", "pending_review", "2026-10-10", true],
      ["undated", "10.00", "posted", null, true],
      ["voided", "10.00", "voided", "2026-10-10", true],
      ["future", "10.00", "posted", "2026-10-18", true],
    ] as const) {
      const payment = transaction(data, { id, kind: "bill_payment", toAccountId: later.id, amount, status, occurredOn });
      data.allocations.push({ id: `allocation-${id}`, userId: OWNER, billId: statement.id, transactionId: payment.id, amount, verified });
    }
    const view = accountDetailView(data, later, MONTH, TODAY);
    expect(view.statements[0].summary).toMatchObject({ paid: "20.00", provisional: "30.00", remaining: "80.00" });
    expect(view.dues.amount).toBe("80.00");
  });

  it("distinguishes no statements from recorded paid statements without inferring a facility balance", () => {
    const { data, later } = fixture();
    expect(accountDetailView(data, later, MONTH, TODAY).dues).toEqual({ amount: null, nextDueDate: null, hasUnknownDate: false, unpaidCount: 0 });
    bill(data, { statementCredits: "100.00", dueDate: null });
    const view = accountDetailView(data, later, MONTH, TODAY);
    expect(view.dues).toEqual({ amount: "0.00", nextDueDate: null, hasUnknownDate: false, unpaidCount: 0 });
    expect(view.usage).toMatchObject({ used: null, currentOutstanding: null, provenance: "unknown" });
  });

  it("rejects an unassociated owner and prevents same-ID foreign associations from leaking", () => {
    const { data, bank } = fixture();
    data.accounts.unshift({ ...bank, userId: "foreign-owner", openingBalance: "9999.00" });
    snapshot(data, { userId: "foreign-owner", reportedBalance: "9999.00", asOf: TODAY });
    transaction(data, { userId: "foreign-owner", amount: "999.00" });
    const view = accountDetailView(data, bank, MONTH, TODAY);
    expect(view.account).toBe(bank);
    expect(view.balance.current).toBe("1000.00");
    expect(view.recent).toEqual([]);
    expect(() => accountDetailView(data, { ...bank, userId: "missing-owner" }, MONTH, TODAY)).toThrow("Account not found");
  });

  it("does not mutate or reorder input collections", () => {
    const { data, later } = fixture();
    bill(data, { statementDate: "2026-10-01" });
    bill(data, { statementDate: "2026-10-05" });
    transaction(data, { toAccountId: later.id, kind: "bill_payment" });
    transaction(data, { fromAccountId: later.id, occurredOn: "2026-10-10" });
    const original = JSON.stringify(data);
    for (const collection of Object.values(data)) {
      Object.freeze(collection);
      for (const row of collection) Object.freeze(row);
    }
    accountDetailView(data, later, MONTH, TODAY);
    expect(JSON.stringify(data)).toBe(original);
  });

});
