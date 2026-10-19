import { describe, expect, it } from "vitest";
import { dailySpending, monthlySummary, sumMoney } from "./finance";
import { analyticsCategoryColor, analyticsTransactionsHref, dailySpendingDetail, ownedAnalyticsData } from "./analytics-presentation";
import type { Transaction, WorkspaceData } from "./types";

const transaction = (id: string, values: Partial<Transaction> = {}): Transaction => ({
  id, userId: "a", amount: "100.00", currency: "INR", kind: "expense",
  status: "posted", occurredOn: "2026-10-09", description: id,
  fromAccountId: "card-a", toAccountId: null, category: "Food", ...values,
});
const workspace = (transactions: Transaction[]): WorkspaceData => ({ accounts: [], snapshots: [], transactions, bills: [], allocations: [], fixedDeposits: [], loans: [], emis: [], emiAllocations: [], groups: [], shares: [], settlements: [], reminders: [], auditEvents: [] });

describe("daily spending read-only presentation", () => {
  it("keeps posted expenses separate from pending, voided, repayment, transfer and undated records", () => {
    const data = workspace([
      transaction("purchase", { amount: "100.23" }),
      transaction("pending", { status: "pending_review" }),
      transaction("voided", { status: "voided" }),
      transaction("repayment", { kind: "bill_payment" }),
      transaction("transfer", { kind: "transfer" }),
      transaction("undated", { occurredOn: null }),
    ]);
    const unchanged = structuredClone(data);
    const detail = dailySpendingDetail(data, "2026-10", "2026-10-09")!;
    expect(detail.expenses.map((row) => row.id)).toEqual(["purchase"]);
    expect(detail).toMatchObject({ gross: "100.23", net: "100.23", refunds: "0.00" });
    expect(data).toEqual(unchanged);
    expect(dailySpendingDetail(data, "2026-10", "2026-10-10")).toMatchObject({ gross: "0.00", expenses: [], refundRows: [] });
    expect(dailySpendingDetail(data, "2026-10", "2026-09-09")).toBeNull();
    expect(dailySpendingDetail(data, "2026-10", "2026-10-32")).toBeNull();
  });

  it("preserves prior-month refund caps, recorded amounts and negative net days", () => {
    const data = workspace([
      transaction("original", { amount: "100.00", occurredOn: "2026-08-10" }),
      transaction("prior-refund", { kind: "refund", amount: "70.00", occurredOn: "2026-09-30", refundOfTransactionId: "original" }),
      transaction("refund-a", { kind: "refund", amount: "20.00", occurredOn: "2026-10-09", refundOfTransactionId: "original" }),
      transaction("refund-b", { kind: "refund", amount: "50.00", occurredOn: "2026-10-09", refundOfTransactionId: "original" }),
      transaction("unlinked", { kind: "refund", amount: "99.00", occurredOn: "2026-10-09" }),
      transaction("pending-refund", { kind: "refund", status: "pending_review", refundOfTransactionId: "original" }),
    ]);
    const detail = dailySpendingDetail(data, "2026-10", "2026-10-09")!;
    expect(detail).toMatchObject({ gross: "0.00", refunds: "30.00", net: "-30.00" });
    expect(detail.refundRows.map(({ transaction: row, matched }) => [row.id, row.amount, matched])).toEqual([
      ["refund-a", "20.00", "20.00"], ["refund-b", "50.00", "10.00"], ["unlinked", "99.00", "0.00"],
    ]);
    expect(monthlySummary(data, "2026-10").unexplainedRefunds).toBe("40.00");
  });

  it("matches every canonical chart point and month total, including a refund recorded before its purchase date", () => {
    const data = workspace([
      transaction("purchase", { amount: "150.00", occurredOn: "2026-10-10" }),
      transaction("early-refund", { kind: "refund", amount: "70.00", occurredOn: "2026-10-09", refundOfTransactionId: "purchase" }),
      transaction("later-refund", { kind: "refund", amount: "100.00", occurredOn: "2026-10-11", refundOfTransactionId: "purchase" }),
    ]);
    const canonical = dailySpending(data, "2026-10", { net: true });
    const details = canonical.map((point) => dailySpendingDetail(data, "2026-10", point.date)!);
    expect(details.map((detail) => detail.net)).toEqual(canonical.map((point) => point.amount));
    expect(sumMoney(details.map((detail) => detail.net))).toBe(monthlySummary(data, "2026-10").net);
    expect(details[9].refundRows.map(({ transaction: row, matched }) => [row.id, matched])).toEqual([["early-refund", "70.00"]]);
    expect(details[10].refundRows[0].matched).toBe("80.00");
  });

  it("keeps interleaved purchase caps independent while attributing an early refund on its purchase date", () => {
    const data = workspace([
      transaction("original-a", { amount: "100.00", occurredOn: "2026-08-10" }),
      transaction("original-b", { amount: "60.00", occurredOn: "2026-10-09" }),
      transaction("prior-a", { kind: "refund", amount: "70.00", occurredOn: "2026-09-30", refundOfTransactionId: "original-a" }),
      transaction("early-b", { kind: "refund", amount: "50.00", occurredOn: "2026-10-08", refundOfTransactionId: "original-b" }),
      transaction("refund-a-1", { kind: "refund", amount: "20.00", refundOfTransactionId: "original-a" }),
      transaction("refund-a-2", { kind: "refund", amount: "50.00", refundOfTransactionId: "original-a" }),
      transaction("refund-b-1", { kind: "refund", amount: "30.00", refundOfTransactionId: "original-b" }),
      transaction("wrong-owner", { kind: "refund", userId: "b", amount: "999.00", refundOfTransactionId: "original-a" }),
    ]);
    const detail = dailySpendingDetail(data, "2026-10", "2026-10-09")!;
    expect(detail).toMatchObject({ gross: "60.00", refunds: "90.00", net: "-30.00" });
    expect(detail.refundRows.map(({ transaction: row, matched }) => [row.id, matched])).toEqual([
      ["early-b", "50.00"], ["refund-a-1", "20.00"], ["refund-a-2", "10.00"],
      ["refund-b-1", "10.00"], ["wrong-owner", "0.00"],
    ]);
    expect(sumMoney(detail.refundRows.map((row) => row.matched))).toBe(detail.refunds);
    expect(detail.net).toBe(dailySpending(data, "2026-10", { net: true })[8].amount);
    expect(dailySpendingDetail(data, "2026-10", "2026-10-08")).toMatchObject({ refunds: "0.00", net: "0.00" });
  });

  it("isolates owners in every collection before selectors or account labels can read them", () => {
    const data = workspace([transaction("mine"), transaction("foreign", { userId: "b" })]);
    data.accounts = [
      { id: "mine", userId: "a", name: "Mine", institution: "A", kind: "bank", maskedSuffix: "1234", active: true },
      { id: "foreign", userId: "b", name: "Private", institution: "B", kind: "bank", maskedSuffix: "9876", active: true },
    ];
    expect(ownedAnalyticsData(data, "a").transactions.map((row) => row.id)).toEqual(["mine"]);
    expect(ownedAnalyticsData(data, "a").accounts.map((row) => row.id)).toEqual(["mine"]);
    expect(ownedAnalyticsData(data, "").transactions).toEqual([]);
    expect(data.transactions).toHaveLength(2);
  });

  it("preserves exact dates/categories in navigation and stable existing category colors", () => {
    const date = new URL(analyticsTransactionsHref({ date: "2026-10-09" }), "https://example.test").searchParams;
    expect(date.get("date")).toBe("2026-10-09");
    expect(date.get("period")).toBe("all");
    const category = new URL(analyticsTransactionsHref({ category: "Food & drink", month: "2026-10" }), "https://example.test").searchParams;
    expect(category.get("category")).toBe("Food & drink");
    expect(category.get("kind")).toBe("expense");
    expect(category.get("status")).toBe("posted");
    expect(category.get("month")).toBe("2026-10");
    expect(category.get("period")).toBe("month");
    expect(new URL(analyticsTransactionsHref({ date: "2026-10-09", month: "2026-10" }), "https://example.test").searchParams.get("period")).toBe("all");
    expect(analyticsCategoryColor("Food")).toBe("#e47957");
    expect(analyticsCategoryColor(" food ")).toBe(analyticsCategoryColor("Food"));
    expect(analyticsCategoryColor("Unlisted")).toBe(analyticsCategoryColor("Unlisted"));
  });
});
