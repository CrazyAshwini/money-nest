import { z } from "zod";
import Decimal from "decimal.js";
import { CATEGORIES, TRANSACTION_KINDS, type Transaction } from "./types";
import { isoDateSchema, positiveMoneySchema } from "./validation";
import { withSellerDescription } from "./seller-description";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_RECEIPT_IMAGES = 3;
export const MAX_RECEIPT_TRANSACTIONS = 20;
export const RECEIPT_GATEWAY_MODELS = [
  { id: "openai/gpt-5.4-nano", label: "Everyday receipts" },
  { id: "openai/gpt-6-luna", label: "Advanced receipts" },
  { id: "openai/gpt-6.1-sol", label: "Hard-to-read receipts" },
] as const;
export const RECEIPT_GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Everyday receipts" },
] as const;
export const RECEIPT_AI_MODELS = [
  ...RECEIPT_GEMINI_MODELS.map((model) => ({
    ...model,
    provider: "gemini" as const,
  })),
  ...RECEIPT_GATEWAY_MODELS.map((model) => ({
    ...model,
    provider: "gateway" as const,
  })),
] as const;
export type ReceiptAIProvider = "gemini" | "gateway";
export const DEFAULT_RECEIPT_AI_MODEL = RECEIPT_GEMINI_MODELS[0].id;
export const DEFAULT_RECEIPT_GATEWAY_MODEL = RECEIPT_GATEWAY_MODELS[0].id;
const optionalText = (max: number) => z.string().max(max).nullable();
const receiptPlatformSchema = optionalText(100).describe(
  "Ordering app or marketplace visibly used, e.g. Swiggy; null if not shown. Never put a restaurant or seller here.",
);
/** All absent/uncertain fields must be null. No account IDs or ownership come from AI. */
export const receiptExtractionSchema = z.object({
  documentType: z.enum(["payment", "receipt", "unknown"]),
  amount: optionalText(40).describe(
    "Final transaction total as a positive decimal string, or null.",
  ),
  currency: optionalText(12).describe(
    "Visible ISO currency, e.g. INR; null if not shown.",
  ),
  occurredOn: optionalText(20).describe(
    "YYYY-MM-DD, null if the date or year cannot be established.",
  ),
  platform: receiptPlatformSchema.optional(),
  merchant: optionalText(120).describe(
    "Actual restaurant, store or seller, not the ordering app or marketplace.",
  ),
  description: optionalText(250),
  kind: z.enum(TRANSACTION_KINDS).nullable(),
  category: z.enum(CATEGORIES).nullable(),
  externalReference: optionalText(150).describe(
    "Transaction/UPI reference, not account or card number.",
  ),
  accountHint: optionalText(80).describe(
    "Bank or payment method and masked last four digits only, if visible.",
  ),
  paymentStatus: z.enum(["successful", "pending", "failed", "unknown"]),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string().max(250)).max(8),
});
/** New provider calls explicitly emit platform; older saved scan responses may omit it. */
export const receiptGenerationSchema = receiptExtractionSchema.extend({
  platform: receiptPlatformSchema,
});
/** One image may contain several payments/orders; bill line items remain one transaction. */
export const receiptBatchGenerationSchema = z.object({
  extractions: z
    .array(receiptGenerationSchema)
    .min(1)
    .max(MAX_RECEIPT_TRANSACTIONS),
});
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
export interface ReceiptScanResult {
  extraction: ReceiptExtraction;
  fingerprint: string;
  /** Older saved responses and clients only supplied the first-transaction aliases. */
  extractions?: ReceiptExtraction[];
  fingerprints?: string[];
  provider: string;
  model: string;
}
export interface ReceiptAISettings {
  configured: boolean;
  provider: string;
  model: string;
  requiresRedaction: boolean;
  models?: ReadonlyArray<{ id: string; label: string }>;
}

const clean = (text: string | null): string | null =>
  text
    // eslint-disable-next-line no-control-regex -- Remove control characters from untrusted OCR/model text.
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;

export function normalizeReceiptExtraction(input: unknown): ReceiptExtraction {
  const parsed = receiptExtractionSchema.parse(input);
  const modelWarnings = parsed.warnings
    .map((warning) => clean(warning))
    .filter((warning): warning is string => Boolean(warning));
  const warnings: string[] = [];
  let amount = clean(parsed.amount);
  if (amount?.includes(",")) {
    const grouped =
      /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(
        amount,
      );
    amount = grouped ? amount.replaceAll(",", "") : null;
  }
  if (!amount || !positiveMoneySchema.safeParse(amount).success) {
    amount = null;
    warnings.push("Confirm the total amount; it could not be read reliably.");
  } else amount = new Decimal(amount).toFixed(2);
  const rawDate = clean(parsed.occurredOn);
  const occurredOn =
    rawDate && isoDateSchema.safeParse(rawDate).success ? rawDate : null;
  if (!occurredOn)
    warnings.push("Confirm the transaction date; it was not established.");
  let currency = clean(parsed.currency)?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) currency = null;
  if (!currency)
    warnings.push(
      "Currency was not shown. Confirm this is an INR transaction.",
    );
  else if (currency !== "INR")
    warnings.push(
      "This receipt is not in INR. Enter a confirmed INR amount manually.",
    );
  if (parsed.documentType === "unknown")
    warnings.push("Confirm that this image represents a transaction.");
  if (parsed.paymentStatus === "failed")
    warnings.push(
      "The payment appears to have failed. Keep it in review; it is not a completed payment.",
    );
  else if (parsed.paymentStatus === "pending")
    warnings.push("The payment is pending. Confirm completion before posting.");
  else if (
    parsed.documentType === "payment" &&
    parsed.paymentStatus === "unknown"
  )
    warnings.push("Payment completion could not be confirmed.");
  if (parsed.confidence === "low")
    warnings.push(
      "Some details are unclear. Check every field against the image.",
    );
  return {
    ...parsed,
    amount,
    occurredOn,
    currency,
    platform: clean(parsed.platform ?? null),
    merchant: clean(parsed.merchant),
    description: clean(parsed.description),
    externalReference: clean(parsed.externalReference),
    accountHint: clean(parsed.accountHint),
    warnings: Array.from(new Set([...warnings, ...modelWarnings])).slice(0, 8),
  };
}

export function receiptDraft(
  extraction: ReceiptExtraction,
): Partial<Transaction> {
  return {
    amount: extraction.amount ?? "",
    occurredOn: extraction.occurredOn,
    description: withSellerDescription(
      extraction.description,
      extraction.merchant,
    ),
    platform: extraction.platform ?? null,
    merchant: extraction.merchant,
    kind: extraction.kind ?? "expense",
    category: extraction.category ?? "Other",
    externalReference: extraction.externalReference,
    fromAccountId: null,
    toAccountId: null,
    externalPayer: null,
    status: "pending_review",
  };
}

const comparable = (text: string | null | undefined) =>
  clean(text ?? null)?.toLowerCase() ?? "";
const reference = (text: string | null | undefined) =>
  comparable(text).replace(/\s/g, "");
/** Local comparison only; existing financial records never go to the AI service. */
export function findReceiptDuplicates(
  extraction: ReceiptExtraction,
  transactions: Transaction[],
  fingerprint?: string,
): Transaction[] {
  return transactions.filter((transaction) => {
    if (transaction.status === "voided") return false;
    if (
      fingerprint &&
      transaction.sourceSystem === "receipt_ai" &&
      transaction.sourceObjectId === fingerprint
    )
      return true;
    if (
      reference(extraction.externalReference) &&
      reference(extraction.externalReference) ===
        reference(transaction.externalReference)
    )
      return true;
    const merchant = comparable(extraction.merchant);
    const description = comparable(extraction.description);
    return Boolean(
      extraction.amount &&
      extraction.occurredOn &&
      positiveMoneySchema.safeParse(transaction.amount).success &&
      new Decimal(extraction.amount).eq(transaction.amount) &&
      extraction.occurredOn === transaction.occurredOn &&
      ((merchant && merchant === comparable(transaction.merchant)) ||
        (description && description === comparable(transaction.description))),
    );
  });
}

export function validateReceiptFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!file.size)
    return "This image is empty. Choose a payment screenshot or receipt.";
  if (file.size > MAX_RECEIPT_BYTES) return "Use an image no larger than 5 MB.";
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    !/\.(?:png|jpe?g|webp)$/i.test(file.name)
  )
    return "Choose a PNG, JPG, or WebP image.";
  return null;
}
export function detectReceiptMediaType(
  bytes: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    )
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
