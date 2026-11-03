import Decimal from "decimal.js";
import {
  CATEGORIES,
  type Transaction,
  type TransactionKind,
} from "@/lib/types";
import {
  getCategoryPlatformOptions,
  OTHER_PLATFORM,
} from "@/lib/category-platforms";
import { withSellerDescription } from "@/lib/seller-description";
import type { TransactionValues } from "./types";
export function transactionValues(
  record: Transaction | undefined,
  today: string,
  externalLender: string,
  kind: TransactionKind = "expense",
): TransactionValues {
  const legacyPlatform =
    record?.platform === undefined &&
    record?.merchant &&
    CATEGORIES.some((category) =>
      getCategoryPlatformOptions(category).some(
        (platform) =>
          platform !== OTHER_PLATFORM && platform === record.merchant,
      ),
    )
      ? record.merchant
      : "";
  return {
    description:
      record?.sourceSystem === "receipt_ai" && !legacyPlatform
        ? withSellerDescription(record.description, record.merchant)
        : record?.description || "",
    amount: record?.amount || "",
    occurredOn: record ? record.occurredOn || "" : today,
    kind: record?.kind || kind,
    category: record?.category || "Other",
    platform: record?.platform ?? legacyPlatform,
    merchant: record?.merchant || "",
    fromAccountId: record?.fromAccountId || "",
    toAccountId: record?.toAccountId || "",
    externalPayer: record?.externalPayer || "",
    externalReference: record?.externalReference || "",
    status: record?.status || "posted",
    refundOfTransactionId: record?.refundOfTransactionId || "",
    externalLender,
    externalRepayment: Boolean(externalLender),
    notes:
      record?.kind === "expense"
        ? record.notes || ""
        : record?.notes?.replace(/^Confirmed external lender: .*?\.\s*/, "") ||
          "",
  };
}
export function amount(value: FormDataEntryValue | null, optional = false) {
  const text = String(value || "").trim();
  if (optional && !text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text) || new Decimal(text).lt(0))
    throw new Error("Enter a valid amount with at most two decimal places.");
  return new Decimal(text).toFixed(2);
}
export const human = (s: string) => s.replaceAll("_", " ");
