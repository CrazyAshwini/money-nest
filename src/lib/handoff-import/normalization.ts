import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { isoDateSchema } from "../validation";
import type { Account, Transaction } from "../types";
import type { Raw } from "./types";

export const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
export const normalized = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export const asRaw = (value: unknown): Raw => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The handoff contains an invalid object.");
  return value as Raw;
};
export const rows = (source: Raw, key: string) => {
  const value = source[key] ?? [];
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error(`The handoff ${key} collection is invalid.`);
  return value.map(asRaw);
};
export const money = (value: unknown): string | null => {
  if (value == null) return null;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value))
  )
    throw new Error("The handoff has an invalid monetary amount.");
  return new Decimal(value).toFixed(2);
};
export const requiredMoney = (value: unknown) => {
  const amount = money(value);
  if (amount == null || new Decimal(amount).lte(0))
    throw new Error("A handoff transaction needs a positive amount.");
  return amount;
};
export const date = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  const parsed = isoDateSchema.safeParse(value);
  if (!parsed.success) throw new Error("The handoff has an invalid date.");
  return parsed.data;
};
export const notionId = (value: unknown): string => {
  const found = text(value).match(
    /(?:^|\/)([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:[?#]|$)/i,
  )?.[1];
  if (!found)
    throw new Error("A handoff source needs a stable Notion page identity.");
  const compact = found.replace(/-/g, "").toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
};
export const stableId = (owner: string, collection: string, source: string) => {
  const hash = createHash("sha256")
    .update(`money-nest-handoff:v1:${owner}:${collection}:${source}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
export const note = (value: string, limit = 500) => value.slice(0, limit);
export const cleanOptionalFields = <T extends object>(record: T): T => {
  const clean = { ...record } as Raw;
  // SQL uses NULL for absent optional metadata; the shared client model uses omission.
  if (clean.notes == null) delete clean.notes;
  if (clean.accent == null) delete clean.accent;
  return clean as T;
};
export const withSourceNote = (
  existing: string | null | undefined,
  sourceId: string,
): string | undefined => {
  const pointer = `Notion: https://www.notion.so/${sourceId.replace(/-/g, "")}`;
  if (existing?.includes(pointer)) return existing;
  if (existing && existing.length + pointer.length + 1 > 2000) return existing;
  return existing ? `${existing}\n${pointer}` : pointer;
};
export const suffix = (value: unknown) =>
  text(value).match(/(?:[•·]|\bXX)\s*(\d{1,4})\b/i)?.[1] ??
  text(value).match(/\b(\d{4})$/)?.[1] ??
  "";
export const bankReference = (value: unknown) => {
  const candidate = text(value);
  if (/^\d{6,30}$/.test(candidate)) return candidate;
  return (
    candidate.match(
      /\b(?:UPI|IMPS|UTR|RRN|bank reference)\s*[:#-]?\s*(\d{6,30})\b/i,
    )?.[1] ?? null
  );
};
export const kinds: Record<string, Transaction["kind"]> = {
  Expense: "expense",
  Income: "income",
  Transfer: "transfer",
  Refund: "refund",
  "Bill Payment": "bill_payment",
  Adjustment: "adjustment",
};
export const accountKinds: Record<string, Account["kind"]> = {
  Bank: "bank",
  Wallet: "wallet",
  "Credit Card": "credit_card",
  "Pay Later": "pay_later",
};
export const identityFields = [
  "amount",
  "currency",
  "kind",
  "status",
  "occurredOn",
  "fromAccountId",
  "toAccountId",
] as const;
