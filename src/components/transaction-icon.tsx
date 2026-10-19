import {
  ArrowDownLeft,
  ArrowLeftRight,
  Info,
  Wallet,
  Utensils,
  ShoppingBasket,
  ShoppingBag,
  NotebookPen,
  Car,
  GraduationCap,
  House,
  Zap,
  CalendarDays,
  HeartPulse,
  Plane,
  Clapperboard,
} from "lucide-react";
import { transactionDirection } from "@/lib/finance";
import { analyticsCategoryColor as categoryColor } from "@/lib/analytics-presentation";
import type { Transaction } from "@/lib/types";

const categoryIcons = {
  food: Utensils,
  groceries: ShoppingBasket,
  shopping: ShoppingBag,
  stationery: NotebookPen,
  "stationery items": NotebookPen,
  transport: Car,
  education: GraduationCap,
  housing: House,
  utilities: Zap,
  subscriptions: CalendarDays,
  health: HeartPulse,
  travel: Plane,
  entertainment: Clapperboard,
};
export function CategoryIcon({
  category,
  size = 18,
}: {
  category: string;
  size?: number;
}) {
  const key = category.trim().toLowerCase();
  const Icon = Object.hasOwn(categoryIcons, key)
    ? categoryIcons[key as keyof typeof categoryIcons]
    : Wallet;
  return <Icon size={size} aria-hidden="true" />;
}
export function TransactionIcon({ transaction }: { transaction: Transaction }) {
  const direction = transactionDirection(transaction);
  return direction === "incoming" ? (
    <ArrowDownLeft size={18} aria-hidden="true" />
  ) : direction === "between_accounts" ||
    transaction.kind === "transfer" ||
    transaction.kind === "bill_payment" ? (
    <ArrowLeftRight size={18} aria-hidden="true" />
  ) : direction === "unknown" ? (
    <Info size={18} aria-hidden="true" />
  ) : (
    <CategoryIcon category={transaction.category || "Other"} />
  );
}
export function transactionIconColor(transaction: Transaction) {
  const direction = transactionDirection(transaction);
  return direction === "incoming"
    ? "#087f62"
    : direction === "between_accounts" ||
        transaction.kind === "transfer" ||
        transaction.kind === "bill_payment"
      ? "#6474c5"
      : direction === "unknown"
        ? "#697a73"
        : categoryColor(transaction.category || "Other");
}
