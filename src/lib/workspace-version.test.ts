import { describe, expect, it } from "vitest";
import type { Transaction } from "./types";
import { matchesPersistedReceiptCreate } from "./workspace-version";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const bank = "33333333-3333-4333-8333-333333333333";
function attempted(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: owner,
    amount: "25.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-11-01",
    description: "Synthetic reviewed receipt",
    fromAccountId: bank,
    toAccountId: null,
    sourceSystem: "receipt_ai",
    sourceObjectId: "a".repeat(64),
    ...overrides,
  };
}
describe("read-only acknowledgement of a committed receipt creation", () => {
  it("accepts the same payload with server timestamps, decimal serialization and nullable DB defaults", () => {
    const input = attempted({
      amount: "25",
      description: " Synthetic reviewed receipt ",
    });
    const saved = {
      ...attempted(),
      createdAt: "2026-11-01T01:00:00.000000+00:00",
      updatedAt: "2026-11-01T01:00:00.123456+00:00",
      category: null,
      platform: null,
      categoryId: null,
      importBatchId: null,
    };
    const before = structuredClone({ input, saved });
    expect(matchesPersistedReceiptCreate(input, saved, owner)).toBe(true);
    expect({ input, saved }).toEqual(before);
  });
  it("compares recorded unknown metadata without depending on object key order", () => {
    const input = {
      ...attempted(),
      review: { source: "synthetic", sequence: 1 },
    };
    expect(
      matchesPersistedReceiptCreate(
        input,
        {
          ...attempted(),
          review: { sequence: 1, source: "synthetic" },
        } as Transaction,
        owner,
      ),
    ).toBe(true);
    expect(
      matchesPersistedReceiptCreate(
        input,
        {
          ...attempted(),
          review: { sequence: 2, source: "synthetic" },
        } as Transaction,
        owner,
      ),
    ).toBe(false);
  });
  it.each([
    ["amount", "26.00"],
    ["currency", "USD"],
    ["kind", "adjustment"],
    ["status", "voided"],
    ["occurredOn", "2026-11-02"],
    ["description", "Edited by another device"],
    ["fromAccountId", other],
    ["toAccountId", other],
    ["category", "Food"],
    ["subcategory", "Lunch"],
    ["platform", "Synthetic app"],
    ["merchant", "Synthetic seller"],
    ["externalPayer", "Synthetic payer"],
    ["externalReference", "another-reference"],
    ["sourceObjectId", "b".repeat(64)],
    ["receiptDocumentId", other],
    ["refundOfTransactionId", other],
    ["notes", "Changed evidence"],
    ["fromBalanceSnapshotId", other],
    ["toBalanceSnapshotId", other],
    ["categoryId", other],
    ["importBatchId", other],
    ["futureMetadata", "Changed evidence"],
  ])("does not acknowledge a changed %s", (key, value) => {
    expect(
      matchesPersistedReceiptCreate(
        attempted(),
        { ...attempted(), [key]: value },
        owner,
      ),
    ).toBe(false);
  });
  it("does not ignore a non-null attempted value that is missing from storage", () => {
    expect(
      matchesPersistedReceiptCreate(
        attempted({ notes: "Reviewed evidence" }),
        attempted(),
        owner,
      ),
    ).toBe(false);
  });
  it("rejects other identities, IDs, missing records, non-receipts and invalid fingerprints", () => {
    expect(matchesPersistedReceiptCreate(attempted(), undefined, owner)).toBe(
      false,
    );
    expect(
      matchesPersistedReceiptCreate(
        attempted(),
        attempted({ id: other }),
        owner,
      ),
    ).toBe(false);
    expect(
      matchesPersistedReceiptCreate(
        attempted(),
        attempted({ userId: other }),
        owner,
      ),
    ).toBe(false);
    expect(
      matchesPersistedReceiptCreate(
        attempted({ userId: other }),
        attempted({ userId: other }),
        owner,
      ),
    ).toBe(false);
    expect(
      matchesPersistedReceiptCreate(
        attempted({ sourceSystem: "manual" }),
        attempted({ sourceSystem: "manual" }),
        owner,
      ),
    ).toBe(false);
    expect(
      matchesPersistedReceiptCreate(
        attempted({ sourceObjectId: null }),
        attempted({ sourceObjectId: null }),
        owner,
      ),
    ).toBe(false);
    expect(
      matchesPersistedReceiptCreate(
        attempted({ sourceObjectId: "" }),
        attempted({ sourceObjectId: "" }),
        owner,
      ),
    ).toBe(false);
  });
});
