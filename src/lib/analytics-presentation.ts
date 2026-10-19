import {
  dailySpending,
  monthlySummary,
  subtractMoney,
} from "./finance";
import type { Money, Transaction, WorkspaceData } from "./types";

export type SpendingMode = "gross" | "net";

/** Defense in depth for every analytics collection, without modifying the workspace. */
export function ownedAnalyticsData(data: WorkspaceData, userId: string): WorkspaceData {
  return Object.fromEntries(
    Object.entries(data).map(([key, records]) => [
      key,
      (records as { userId: string }[]).filter((record) => record.userId === userId),
    ]),
  ) as unknown as WorkspaceData;
}

export function analyticsTransactionsHref(filters: {
  date?: string;
  month?: string;
  category?: string;
}): string {
  const query = new URLSearchParams({ period: filters.month && !filters.date ? "month" : "all" });
  if (filters.date) query.set("date", filters.date);
  if (filters.month) query.set("month", filters.month);
  if (filters.category) {
    query.set("category", filters.category);
    query.set("kind", "expense");
    query.set("status", "posted");
  }
  return `/transactions?${query}`;
}

export interface DailySpendingDetail {
  date: string;
  gross: Money;
  refunds: Money;
  net: Money;
  expenses: Transaction[];
  refundRows: { transaction: Transaction; matched: Money }[];
}

/**
 * Presentation only: all amounts, including capped cross-month refund attribution,
 * come from the existing financial selectors. No independent reconciliation rule.
 */
export function dailySpendingDetail(
  data: WorkspaceData,
  month: string,
  date: string,
): DailySpendingDetail | null {
  const grossPoint = dailySpending(data, month).find((point) => point.date === date);
  const netPoint = dailySpending(data, month, { net: true }).find(
    (point) => point.date === date,
  );
  if (!grossPoint || !netPoint) return null;
  const expenses = data.transactions
    .filter((row) => row.occurredOn === date && row.kind === "expense" && row.status === "posted")
    .sort((a, b) => a.id.localeCompare(b.id));
  const refunds = data.transactions
    .filter((row) => row.kind === "refund" && row.status === "posted" && row.occurredOn)
    .sort((a, b) => a.occurredOn!.localeCompare(b.occurredOn!) || a.id.localeCompare(b.id));
  const refundRows: DailySpendingDetail["refundRows"] = [];
  const originals = new Map<string, Map<string, Transaction>>();
  for (const transaction of data.transactions) {
    if (transaction.kind !== "expense" || transaction.status !== "posted" || !transaction.occurredOn) continue;
    const owned = originals.get(transaction.userId) ?? new Map<string, Transaction>();
    // Keep the canonical selector's first qualifying original if malformed data repeats an ID.
    if (!owned.has(transaction.id)) owned.set(transaction.id, transaction);
    originals.set(transaction.userId, owned);
  }
  const groups = new Map<Transaction, { refunds: Transaction[]; previous: Money }>();
  for (const refund of refunds.filter((row) => row.occurredOn! <= date)) {
    const original = refund.refundOfTransactionId
      ? originals.get(refund.userId)?.get(refund.refundOfTransactionId)
      : undefined;
    if (!original) {
      if (refund.occurredOn === date) refundRows.push({ transaction: refund, matched: "0.00" });
      continue;
    }
    const group = groups.get(original) ?? { refunds: [], previous: "0.00" };
    group.refunds.push(refund);
    groups.set(original, group);
    // Refund caps belong to one original purchase. Ask the same canonical selector
    // about that purchase's prefix, avoiding full-ledger scans for every refund.
    const atCutoff = (inclusive: boolean) => monthlySummary({
      ...data,
      transactions: [original, ...group.refunds].filter((row) =>
        !row.occurredOn || (inclusive ? row.occurredOn <= date : row.occurredOn < date),
      ),
    }, month).refunds;
    const current = subtractMoney(atCutoff(true), atCutoff(false));
    const matched = subtractMoney(current, group.previous);
    if (refund.occurredOn === date || matched !== "0.00") {
      refundRows.push({ transaction: refund, matched });
    }
    group.previous = current;
  }
  return {
    date,
    gross: grossPoint.amount,
    refunds: subtractMoney(grossPoint.amount, netPoint.amount),
    net: netPoint.amount,
    expenses,
    refundRows,
  };
}

const categoryTones = ["#e47957", "#159874", "#8d67cc", "#d8a125", "#399bb7", "#6474c5"];
const categoryColorIndex: Readonly<Record<string, number>> = {
  food: 0, groceries: 1, shopping: 2, stationery: 5, transport: 4,
  education: 3, housing: 5, utilities: 4, subscriptions: 2, health: 1,
  travel: 3, entertainment: 0, other: 5,
};

/** Same stable category palette used throughout the existing workspace. */
export function analyticsCategoryColor(category: string): string {
  const normalized = category.trim().toLowerCase();
  const index = Object.hasOwn(categoryColorIndex, normalized)
    ? categoryColorIndex[normalized]
    : Array.from(normalized).reduce((sum, character) => sum + character.codePointAt(0)!, 0) % categoryTones.length;
  return categoryTones[index];
}
