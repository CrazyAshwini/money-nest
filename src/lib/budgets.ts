import Decimal from "decimal.js";
import { formatMoney } from "./finance";

export type CategoryBudgets = Record<string, string>;

export const BUDGETS_STORAGE_PREFIX = "moneynest:budgets:";

export function getCategoryBudgets(userId: string): CategoryBudgets {
  if (typeof window === "undefined" || !userId) return {};
  try {
    const raw = localStorage.getItem(`${BUDGETS_STORAGE_PREFIX}${userId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as CategoryBudgets;
    }
  } catch {
    // Gracefully ignore storage failures
  }
  return {};
}

export function saveCategoryBudgets(
  userId: string,
  budgets: CategoryBudgets,
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.setItem(
      `${BUDGETS_STORAGE_PREFIX}${userId}`,
      JSON.stringify(budgets),
    );
  } catch {
    // Gracefully ignore storage failures
  }
}

export interface BudgetStatus {
  limit: string;
  spent: string;
  remaining: string;
  percentage: number;
  isOver: boolean;
  isWarning: boolean;
  statusLabel: string;
}

export function computeBudgetStatus(
  spentMoney: string | number | null | undefined,
  limitMoney: string | null | undefined,
): BudgetStatus | null {
  if (!limitMoney || limitMoney.trim() === "" || Number(limitMoney) <= 0) {
    return null;
  }
  const spentDec = new Decimal(spentMoney || "0");
  const limitDec = new Decimal(limitMoney);
  if (limitDec.isZero() || limitDec.isNegative()) return null;

  const percentage = Math.min(
    999,
    spentDec.div(limitDec).times(100).toNumber(),
  );
  const remainingDec = limitDec.minus(spentDec);
  const isOver = remainingDec.isNegative();
  const isWarning = !isOver && percentage >= 80;

  const remaining = isOver ? "0.00" : remainingDec.toFixed(2);
  const overAmount = isOver ? spentDec.minus(limitDec).toFixed(2) : "0.00";

  const statusLabel = isOver
    ? `Over by ${formatMoney(overAmount, { decimals: 0 })}`
    : `${formatMoney(remaining, { decimals: 0 })} left`;

  return {
    limit: limitDec.toFixed(2),
    spent: spentDec.toFixed(2),
    remaining,
    percentage: Math.round(percentage),
    isOver,
    isWarning,
    statusLabel,
  };
}
