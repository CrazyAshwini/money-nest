import { describe, expect, it } from "vitest";
import {
  normalizeOrderExtraction,
  orderScanResultSchema,
  type OrderExtraction,
} from "./scan-orders";

const fingerprint = "a".repeat(64);
function row(
  overrides: Partial<OrderExtraction["orders"][number]> = {},
): OrderExtraction["orders"][number] {
  return {
    sourceType: "order_history_list",
    platform: "Test marketplace",
    merchant: "Test merchant",
    description: "Test purchase",
    orderReference: null,
    occurredOn: "2026-10-09",
    status: "completed",
    amount: "249",
    amountRole: "order_total",
    currency: "INR",
    paymentStatus: "unknown",
    financialEvent: "purchase",
    category: "Shopping",
    items: [],
    sourceImageIndices: [0],
    confidence: "high",
    warnings: [],
    expectedRefundAmount: null,
    expectedRefundBy: null,
    ...overrides,
  };
}
const normalize = (
  rows: OrderExtraction["orders"],
  options: Partial<Parameters<typeof normalizeOrderExtraction>[1]> = {},
) =>
  normalizeOrderExtraction(
    { sourceType: "order_history_list", orders: rows, warnings: [] },
    { fingerprint, ...options },
  );
describe("all visible order cards and grounded extraction", () => {
  it("keeps an ordering app separate from its seller and names the seller in the description", () => {
    const result = normalize([
      row({
        platform: "Swiggy",
        merchant: "Bikkgane Biryani",
        description: "Chicken biryani",
        category: "Food",
      }),
    ]);
    expect(result.orders[0]).toMatchObject({
      platform: "Swiggy",
      merchant: "Bikkgane Biryani",
      description: "Chicken biryani · Bikkgane Biryani",
      amount: "249.00",
      paymentStatus: "unknown",
    });
    const alreadyNamed = normalize([
      row({
        merchant: "Bikkgane Biryani",
        description: "Dinner at bikkgane biryani",
      }),
    ]);
    expect(alreadyNamed.orders[0].description).toBe(
      "Dinner at bikkgane biryani",
    );
  });
  it("never invents a platform from a known restaurant and bounds its seller description", () => {
    const result = normalize([
      row({
        platform: null,
        merchant: "Bikkgane Biryani",
        description: "Chicken biryani and delivery details ".repeat(5),
      }),
    ]);
    expect(result.orders[0].platform).toBeNull();
    expect(result.orders[0].description?.length).toBeLessThanOrEqual(200);
    expect(result.orders[0].description).toMatch(/· Bikkgane Biryani$/);
  });
  it("retains multiple visible orders and cancelled zero values as separate history candidates", () => {
    const result = normalize([
      row(),
      row({ description: "Second item", amount: "100.00" }),
      row({ status: "cancelled", amount: "0.00" }),
    ]);
    expect(result.orders).toHaveLength(3);
    expect(result.orders.map((order) => order.amount)).toEqual([
      "249.00",
      "100.00",
      "0.00",
    ]);
    expect(result.orders[2].warnings.join(" ")).toMatch(/cancellation/);
  });
  it("merges strong overlapping order identity and accumulates source evidence", () => {
    const result = normalize(
      [
        row({ orderReference: "SYNTHETIC-100", sourceImageIndices: [0] }),
        row({ orderReference: "SYNTHETIC-100", sourceImageIndices: [1] }),
      ],
      { referenceHashes: new Map([["SYNTHETIC-100", "b".repeat(64)]]) },
    );
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].sourceImageIndices).toEqual([0, 1]);
    expect(result.orders[0].orderReferenceMasked).toBe("••-100");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC-100");
  });
  it("does not merge identical-looking prices and merchants without a strong order identifier", () => {
    expect(
      normalize([row(), row({ sourceImageIndices: [1] })]).orders,
    ).toHaveLength(2);
  });
  it("preserves conflicting overlapping totals as unknown with a review warning", () => {
    const result = normalize(
      [
        row({ orderReference: "TEST-1" }),
        row({
          orderReference: "TEST-1",
          amount: "260",
          sourceImageIndices: [1],
        }),
      ],
      { referenceHashes: new Map([["TEST-1", "b".repeat(64)]]) },
    );
    expect(result.orders[0]).toMatchObject({ amount: null, confidence: "low" });
    expect(result.orders[0].warnings.join(" ")).toMatch(/disagree/);
  });
  it("never manufactures dates, malformed money or currency from unreadable text", () => {
    const result = normalize([
      row({
        occurredOn: "2026-02-30",
        amount: "1,23.45",
        currency: "rupees",
        expectedRefundBy: "tomorrow",
        expectedRefundAmount: "-20",
      }),
    ]);
    expect(result.orders[0]).toMatchObject({
      occurredOn: null,
      amount: null,
      currency: null,
      expectedRefundBy: null,
      expectedRefundAmount: null,
    });
  });
  it("accepts exact decimal grouped rupee amounts but never treats order total as proof of payment", () => {
    const result = normalize([row({ amount: "1,23,456.70" })]);
    expect(result.orders[0].amount).toBe("123456.70");
    expect(result.orders[0].paymentStatus).toBe("unknown");
    expect(result.orders[0].warnings.join(" ")).toMatch(
      /not a confirmed successful payment/,
    );
  });
  it("classifies nonorder financial/design images with zero orders", () => {
    const result = normalizeOrderExtraction(
      {
        sourceType: "design_reference_only",
        orders: [],
        warnings: ["This image is a layout example."],
      },
      { fingerprint },
    );
    expect(result.orders).toEqual([]);
    expect(result.sourceType).toBe("design_reference_only");
  });
  it("rejects false evidence indices and unsupported oversized batch results", () => {
    expect(() =>
      normalize([row({ sourceImageIndices: [2] })], { imageCount: 1 }),
    ).toThrow(/evidence/);
    expect(() => normalize(Array.from({ length: 61 }, () => row()))).toThrow();
    expect(
      orderScanResultSchema.safeParse({
        extraction: { sourceType: "unknown", orders: "bad", warnings: [] },
        fingerprint,
        provider: "Google Gemini",
        model: "test",
      }).success,
    ).toBe(false);
  });
  it("retains item-specific cancellation and pending refund information without confirming receipt", () => {
    const result = normalize([
      row({
        sourceType: "cancellation_refund",
        financialEvent: "refund",
        status: "refund_received",
        expectedRefundAmount: "29.10",
        expectedRefundBy: "2026-10-12",
        items: [
          {
            title: "Test shirt",
            quantity: "1",
            amount: "29.10",
            status: "cancelled",
          },
        ],
      }),
    ]);
    expect(result.orders[0]).toMatchObject({
      financialEvent: "refund",
      expectedRefundAmount: "29.10",
      paymentStatus: "unknown",
    });
    expect(result.orders[0].items[0]).toMatchObject({
      title: "Test shirt",
      status: "cancelled",
    });
  });
});
