import { describe, expect, it } from "vitest";
import {
  detectReceiptMediaType,
  findReceiptDuplicates,
  MAX_RECEIPT_BYTES,
  MAX_HOSTED_RECEIPT_BYTES,
  receiptUploadMaxBytes,
  MAX_RECEIPT_TRANSACTIONS,
  normalizeReceiptExtraction,
  receiptDraft,
  receiptGenerationSchema,
  receiptBatchGenerationSchema,
  validateReceiptFile,
  type ReceiptExtraction,
} from "./receipt-scan";
import type { Transaction } from "./types";

const extraction = (
  changes: Partial<ReceiptExtraction> = {},
): ReceiptExtraction => ({
  documentType: "payment",
  amount: "125.50",
  currency: "INR",
  occurredOn: "2026-10-09",
  merchant: "Synthetic Cafe",
  description: "Lunch",
  kind: "expense",
  category: "Food",
  externalReference: "SYNTHETIC-REF-1",
  accountHint: "Bank ending 1234",
  paymentStatus: "successful",
  confidence: "high",
  warnings: [],
  ...changes,
});
const transaction = (changes: Partial<Transaction> = {}): Transaction => ({
  id: "synthetic-transaction",
  userId: "synthetic-owner",
  amount: "125.50",
  currency: "INR",
  kind: "expense",
  status: "posted",
  occurredOn: "2026-10-09",
  description: "Lunch",
  merchant: "Synthetic Cafe",
  fromAccountId: "synthetic-account",
  toAccountId: null,
  externalReference: "SYNTHETIC-REF-1",
  ...changes,
});

describe("receipt extraction boundaries", () => {
  it("bounds multi-transaction output and requires a separate platform value for every entry", () => {
    const row = extraction({ platform: null });
    expect(
      receiptBatchGenerationSchema.safeParse({ extractions: [row, row] })
        .success,
    ).toBe(true);
    expect(
      receiptBatchGenerationSchema.safeParse({ extractions: [] }).success,
    ).toBe(false);
    expect(
      receiptBatchGenerationSchema.safeParse({
        extractions: Array.from(
          { length: MAX_RECEIPT_TRANSACTIONS + 1 },
          () => row,
        ),
      }).success,
    ).toBe(false);
    expect(
      receiptBatchGenerationSchema.safeParse({
        extractions: [row, extraction()],
      }).success,
    ).toBe(false);
  });
  it("separates the visible ordering platform and includes the seller in the description", () => {
    const result = normalizeReceiptExtraction(
      extraction({
        platform: " Swiggy ",
        merchant: "Bikkgane Biryani",
        description: "Chicken biryani",
      }),
    );
    expect(receiptDraft(result)).toMatchObject({
      platform: "Swiggy",
      merchant: "Bikkgane Biryani",
      description: "Chicken biryani · Bikkgane Biryani",
      amount: "125.50",
      status: "pending_review",
    });
    expect(
      receiptDraft(
        extraction({
          merchant: "Bikkgane Biryani",
          description: "Dinner at bikkgane biryani",
        }),
      ).description,
    ).toBe("Dinner at bikkgane biryani");
  });
  it("accepts older scans but never infers a platform from a seller", () => {
    const result = normalizeReceiptExtraction(
      extraction({ merchant: "Bikkgane Biryani" }),
    );
    expect(result.platform).toBeNull();
    expect(receiptDraft(result).platform).toBeNull();
    expect(receiptGenerationSchema.safeParse(extraction()).success).toBe(false);
    expect(
      receiptGenerationSchema.safeParse(extraction({ platform: null })).success,
    ).toBe(true);
    expect(
      receiptDraft(
        extraction({ platform: null, merchant: null, description: "Lunch" }),
      ),
    ).toMatchObject({ platform: null, merchant: null, description: "Lunch" });
  });
  it("bounds seller descriptions without dropping the seller or changing financial facts", () => {
    const draft = receiptDraft(
      extraction({
        description: "Chicken biryani and delivery details ".repeat(6),
        merchant: "Bikkgane Biryani",
        platform: "Swiggy",
      }),
    );
    expect(draft.description?.length).toBeLessThanOrEqual(200);
    expect(draft.description).toMatch(/· Bikkgane Biryani$/);
    expect(draft).toMatchObject({
      amount: "125.50",
      occurredOn: "2026-10-09",
      fromAccountId: null,
      toAccountId: null,
    });
    expect(draft).not.toHaveProperty("currency");
  });
  it("preserves exact cents and valid Indian/Western digit grouping", () => {
    expect(
      normalizeReceiptExtraction(extraction({ amount: "1,23,456.7" })).amount,
    ).toBe("123456.70");
    expect(
      normalizeReceiptExtraction(extraction({ amount: "123,456.70" })).amount,
    ).toBe("123456.70");
    expect(
      normalizeReceiptExtraction(extraction({ amount: "0.01" })).amount,
    ).toBe("0.01");
  });
  it("never turns an identifier, zero, negative, malformed grouping, or excess precision into money", () => {
    for (const amount of [
      "0",
      "-10",
      "1,2",
      "123.456",
      "UPI12345",
      "9999999999999",
    ]) {
      const result = normalizeReceiptExtraction(extraction({ amount }));
      expect(result.amount).toBeNull();
      expect(
        result.warnings.some((warning) => warning.includes("total amount")),
      ).toBe(true);
    }
  });
  it("keeps missing or impossible dates unknown instead of using today", () => {
    for (const occurredOn of [null, "2026-02-30", "09/10/2026", "Oct 9"]) {
      const result = normalizeReceiptExtraction(extraction({ occurredOn }));
      expect(result.occurredOn).toBeNull();
      expect(receiptDraft(result).occurredOn).toBeNull();
    }
  });
  it("retains foreign currency and warns instead of relabeling as INR", () => {
    const result = normalizeReceiptExtraction(extraction({ currency: "usd" }));
    expect(result.currency).toBe("USD");
    expect(
      result.warnings.some((warning) => warning.includes("not in INR")),
    ).toBe(true);
    expect(
      normalizeReceiptExtraction(extraction({ currency: null })).currency,
    ).toBeNull();
  });
  it("flags failed/pending/unknown payments and low confidence", () => {
    for (const paymentStatus of ["failed", "pending", "unknown"] as const) {
      const result = normalizeReceiptExtraction(
        extraction({ paymentStatus, confidence: "low" }),
      );
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(receiptDraft(result).status).toBe("pending_review");
    }
  });
  it("never selects financial accounts from model output", () => {
    expect(receiptDraft(extraction())).toMatchObject({
      fromAccountId: null,
      toAccountId: null,
      externalPayer: null,
      status: "pending_review",
    });
  });
  it("normalizes text and rejects unbounded/invalid structured output", () => {
    const result = normalizeReceiptExtraction(
      extraction({
        merchant: "  Synthetic\nCafe  ",
        warnings: ["Check", "Check"],
      }),
    );
    expect(result.merchant).toBe("Synthetic Cafe");
    expect(result.warnings).toEqual(["Check"]);
    expect(() =>
      normalizeReceiptExtraction(extraction({ description: "x".repeat(251) })),
    ).toThrow();
    expect(() =>
      normalizeReceiptExtraction({
        ...extraction(),
        paymentStatus: "paid-ish",
      }),
    ).toThrow();
  });
  it("keeps normalized warnings bounded and normalization idempotent", () => {
    const first = normalizeReceiptExtraction(
      extraction({
        amount: null,
        occurredOn: null,
        currency: null,
        paymentStatus: "failed",
        confidence: "low",
        warnings: Array.from(
          { length: 8 },
          (_, index) => `Model caution ${index}`,
        ),
      }),
    );
    expect(first.warnings.length).toBeLessThanOrEqual(8);
    expect(first.warnings.some((warning) => warning.includes("failed"))).toBe(
      true,
    );
    expect(normalizeReceiptExtraction(first)).toEqual(first);
  });
});
describe("receipt duplicate checks", () => {
  it("finds matching fingerprints, references and exact amount/date/merchant without conflating other dates", () => {
    const rows = [
      transaction(),
      transaction({
        id: "other-day",
        occurredOn: "2026-10-08",
        externalReference: null,
      }),
      transaction({
        id: "same-image",
        amount: "999.00",
        externalReference: null,
        sourceSystem: "receipt_ai",
        sourceObjectId: "fingerprint",
      }),
    ];
    expect(
      findReceiptDuplicates(extraction(), rows, "fingerprint").map(
        (row) => row.id,
      ),
    ).toEqual(["synthetic-transaction", "same-image"]);
    expect(
      findReceiptDuplicates(
        extraction({ externalReference: " synthetic-ref-1 " }),
        [transaction({ amount: "150.00" })],
      ),
    ).toHaveLength(1);
  });
  it("does not match absent references, unknown amount/date, or voided transactions", () => {
    expect(
      findReceiptDuplicates(
        extraction({ amount: null, occurredOn: null, externalReference: null }),
        [transaction({ externalReference: null })],
      ),
    ).toEqual([]);
    expect(
      findReceiptDuplicates(extraction(), [transaction({ status: "voided" })]),
    ).toEqual([]);
  });
});
describe("receipt image bounds", () => {
  it("keeps hosted metadata within 4 MB and retains the local 5 MB limit", () => {
    expect(receiptUploadMaxBytes(true)).toBe(MAX_HOSTED_RECEIPT_BYTES);
    expect(receiptUploadMaxBytes(false)).toBe(MAX_RECEIPT_BYTES);
    for (const value of [
      MAX_RECEIPT_BYTES,
      Number.MAX_SAFE_INTEGER,
      -1,
      0,
      NaN,
      "untrusted",
    ])
      expect(receiptUploadMaxBytes(true, value)).toBe(MAX_HOSTED_RECEIPT_BYTES);
    const image = {
      name: "synthetic.png",
      type: "image/png",
      size: MAX_HOSTED_RECEIPT_BYTES + 1,
    };
    expect(validateReceiptFile(image, MAX_HOSTED_RECEIPT_BYTES)).toContain(
      "4 MB",
    );
    expect(validateReceiptFile(image)).toBeNull();
  });
  it("accepts supported nonempty images and rejects large, empty, PDF and mismatched extensions", () => {
    expect(
      validateReceiptFile({
        name: "receipt.JPG",
        type: "image/jpeg",
        size: 100,
      }),
    ).toBeNull();
    for (const file of [
      { name: "empty.png", type: "image/png", size: 0 },
      { name: "large.png", type: "image/png", size: MAX_RECEIPT_BYTES + 1 },
      { name: "receipt.pdf", type: "application/pdf", size: 10 },
      { name: "receipt.exe", type: "image/png", size: 10 },
    ])
      expect(validateReceiptFile(file)).toBeTruthy();
  });
  it("checks actual image signatures rather than trusting the declared MIME", () => {
    expect(
      detectReceiptMediaType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    ).toBe("image/png");
    expect(detectReceiptMediaType(new Uint8Array([255, 216, 255]))).toBe(
      "image/jpeg",
    );
    expect(
      detectReceiptMediaType(new TextEncoder().encode("RIFF0000WEBPdata")),
    ).toBe("image/webp");
    expect(
      detectReceiptMediaType(new TextEncoder().encode("<svg>script</svg>")),
    ).toBeNull();
    expect(detectReceiptMediaType(new Uint8Array())).toBeNull();
  });
});
