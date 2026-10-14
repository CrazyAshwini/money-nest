import { describe, expect, it } from "vitest";
import {
  applyCommerceCommand,
  commerceOrderSchema,
  emptyCommerce,
  refundRequestSchema,
  type CommerceOrder,
  type RefundRequest,
} from "./commerce";
import {
  mergePrivateProfileCommerce,
  preparePrivateProfileMerge,
} from "./private-profile-merge";
import type { Transaction, WorkspaceData } from "./types";

const owner = "00000000-0000-4000-8000-000000000001";
const id = (last: string) => `00000000-0000-4000-8000-${last.padStart(12, "0")}`;
const account = (accountId: string, name = "Everyday") => ({
  id: accountId,
  userId: owner,
  name,
  institution: "Example Bank",
  kind: "bank" as const,
  maskedSuffix: "1234",
  active: true,
});
const transaction = (
  transactionId: string,
  accountId: string,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  id: transactionId,
  userId: owner,
  amount: "12.00",
  currency: "INR",
  kind: "expense",
  status: "posted",
  occurredOn: "2026-10-01",
  description: "Synthetic purchase",
  fromAccountId: accountId,
  toAccountId: null,
  ...overrides,
});
const workspace = (): WorkspaceData => ({
  accounts: [], snapshots: [], transactions: [], bills: [], allocations: [],
  fixedDeposits: [], loans: [], emis: [], emiAllocations: [], groups: [],
  shares: [], settlements: [], reminders: [], auditEvents: [],
});
const order = (orderId: string, overrides: Partial<CommerceOrder> = {}): CommerceOrder =>
  commerceOrderSchema.parse({
    id: orderId, userId: owner, candidateId: "purchase-one", sourceType: "order_history_list",
    platform: "Test store", merchant: "Test seller", description: "Synthetic purchase",
    orderReferenceHash: null, orderReferenceMasked: null, occurredOn: "2026-10-01",
    status: "completed", amount: "12.00", amountRole: "amount_paid", currency: "INR",
    paymentStatus: "successful", financialEvent: "purchase", category: "Groceries",
    items: [], sourceImageIndices: [0], confidence: "high", warnings: [],
    expectedRefundAmount: null, expectedRefundBy: null, sourceFingerprint: "a".repeat(64),
    evidenceFingerprints: [], sources: [], reviewStatus: "history", payments: [],
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });
const refund = (refundId: string, overrides: Partial<RefundRequest> = {}): RefundRequest =>
  refundRequestSchema.parse({
    id: refundId, userId: owner, orderId: null, originalTransactionId: null,
    description: "Synthetic refund", expectedAmount: "5.00", expectedBy: "2026-10-03",
    cancelledOn: "2026-10-02", destinationAccountId: null, route: "bank", itemTitle: null,
    notes: null, status: "expected", creditMatches: [],
    createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  });
const independentlyScannedPurchase = (firstId: number, accountId: string, amount = "12.00") => {
  const data = workspace();
  data.accounts.push(account(accountId));
  let nextId = firstId;
  return applyCommerceCommand(data, emptyCommerce(), owner, {
    action: "commit_orders", idempotencyKey: "b".repeat(64), orders: [{
      ...order(id("99"), { amount, orderReferenceHash: "c".repeat(64) }),
      action: "create", confirmed: true, fromAccountId: accountId, externalPayer: null,
      matchedTransactionId: null, confirmedDistinct: false,
    }],
  }, {
    newId: () => id(String(nextId++)), now: "2026-10-01T00:00:00.000Z",
  });
};
const independentlyConfirmedRefund = (firstId: number, accountId: string, receivedOn = "2026-10-03") => {
  const purchased = independentlyScannedPurchase(firstId, accountId);
  let nextId = firstId + 2;
  const options = { newId: () => id(String(nextId++)), now: "2026-10-03T00:00:00.000Z" };
  const expected = applyCommerceCommand(purchased.workspace, purchased.commerce, owner, {
    action: "save_refund", refund: {
      ...refund(id("99"), {
        orderId: purchased.commerce.orders[0].id,
        originalTransactionId: purchased.workspace.transactions[0].id,
        destinationAccountId: accountId,
      }),
      id: undefined,
    },
  }, options);
  return applyCommerceCommand(expected.workspace, expected.commerce, owner, {
    action: "verify_refund", refundId: expected.commerce.refunds[0].id, amount: "5.00",
    receivedOn, destinationAccountId: accountId, bankHistoryConfirmed: true,
  }, options);
};

describe("private profile merge", () => {
  it("keeps cloud rows unchanged, deduplicates transaction sources, and adds missing rows", () => {
    const cloud = workspace();
    const cloudAccount = account(id("1"));
    const cloudTransaction = transaction(id("2"), cloudAccount.id, {
      sourceSystem: "statement",
      sourceObjectId: "source-1",
      description: "Cloud version",
    });
    cloud.accounts.push(cloudAccount);
    cloud.transactions.push(cloudTransaction);

    const local = workspace();
    local.accounts.push(account(id("9")));
    local.transactions.push(
      transaction(id("8"), id("9"), {
        sourceSystem: "statement",
        sourceObjectId: "source-1",
        description: "Local duplicate",
      }),
      transaction(id("10"), id("9"), {
        sourceSystem: "statement",
        sourceObjectId: "source-2",
      }),
    );

    const result = preparePrivateProfileMerge(cloud, local, owner);
    expect(result.delta.accounts).toHaveLength(0);
    expect(result.delta.transactions.map((row) => row.id)).toEqual([id("10")]);
    expect(result.transactionIds.get(id("8"))).toBe(cloudTransaction.id);
    expect(result.full.accounts).toEqual([cloudAccount]);
    expect(result.full.transactions[0]).toEqual(cloudTransaction);
    expect(result.full.transactions).toHaveLength(2);
  });

  it("maps identical referenced transactions across different IDs and source systems while preserving cloud descriptions", () => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    cloud.transactions.push(transaction(id("2"), id("1"), {
      externalReference: "BANK-REFERENCE-ONE", sourceSystem: "statement", sourceObjectId: "cloud-row",
      description: "Cloud purchase description",
    }));
    const local = workspace();
    local.accounts.push(account(id("9")));
    local.transactions.push(transaction(id("8"), id("9"), {
      amount: "12.0", externalReference: "BANK-REFERENCE-ONE", sourceSystem: "notion", sourceObjectId: "local-row",
      description: "Cloud purchase description · Enriched seller",
    }));
    const before = structuredClone(cloud);

    const prepared = preparePrivateProfileMerge(cloud, local, owner);

    expect(prepared.delta.transactions).toEqual([]);
    expect(prepared.transactionIds.get(id("8"))).toBe(id("2"));
    expect(prepared.full.transactions).toEqual(cloud.transactions);
    expect(cloud).toEqual(before);
  });

  it("keeps same-day same-amount purchases with different external references distinct", () => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    cloud.transactions.push(transaction(id("2"), id("1"), { externalReference: "BANK-REFERENCE-ONE" }));
    const local = workspace();
    local.accounts.push(account(id("1")));
    local.transactions.push(transaction(id("8"), id("1"), { externalReference: "BANK-REFERENCE-TWO" }));

    const prepared = preparePrivateProfileMerge(cloud, local, owner);

    expect(prepared.delta.transactions.map((row) => row.id)).toEqual([id("8")]);
    expect(prepared.transactionIds.get(id("8"))).toBe(id("8"));
    expect(prepared.full.transactions).toHaveLength(2);
  });

  it.each([
    ["amount", { amount: "13.00" }],
    ["date", { occurredOn: "2026-10-02" }],
    ["paying account", { fromAccountId: id("3") }],
    ["currency", { currency: "USD" }],
    ["kind", { kind: "income", fromAccountId: null, toAccountId: id("1") }],
    ["status", { status: "pending_review" }],
  ] satisfies [string, Partial<Transaction>][])("keeps transactions with the same external reference but different %s distinct", (_field, change) => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")), account(id("3"), "Other account"));
    cloud.transactions.push(transaction(id("2"), id("1"), { externalReference: "BANK-REFERENCE-ONE" }));
    const local = workspace();
    local.accounts.push(...cloud.accounts);
    local.transactions.push(transaction(id("8"), id("1"), {
      externalReference: "BANK-REFERENCE-ONE", ...change,
    }));

    const prepared = preparePrivateProfileMerge(cloud, local, owner);

    expect(prepared.delta.transactions.map((row) => row.id)).toEqual([id("8")]);
    expect(prepared.transactionIds.get(id("8"))).toBe(id("8"));
  });

  it("requires review when one referenced transaction matches multiple cloud financial records", () => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    cloud.transactions.push(
      transaction(id("2"), id("1"), {
        externalReference: "BANK-REFERENCE-ONE", sourceSystem: "statement", sourceObjectId: "cloud-one",
      }),
      transaction(id("3"), id("1"), {
        externalReference: "BANK-REFERENCE-ONE", sourceSystem: "statement", sourceObjectId: "cloud-two",
      }),
    );
    const local = workspace();
    local.accounts.push(account(id("9")));
    local.transactions.push(transaction(id("8"), id("9"), {
      externalReference: "BANK-REFERENCE-ONE", sourceSystem: "notion", sourceObjectId: "local-row",
    }));
    const before = structuredClone(cloud);

    expect(() => preparePrivateProfileMerge(cloud, local, owner)).toThrow(/review|ambiguous|multiple/i);
    expect(cloud).toEqual(before);
  });

  it.each([null, ""])("keeps unreferenced identical financial records distinct (%s)", (externalReference) => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    cloud.transactions.push(transaction(id("2"), id("1"), { externalReference }));
    const local = workspace();
    local.accounts.push(account(id("1")));
    local.transactions.push(transaction(id("8"), id("1"), { externalReference }));

    const prepared = preparePrivateProfileMerge(cloud, local, owner);

    expect(prepared.delta.transactions.map((row) => row.id)).toEqual([id("8")]);
  });

  it("remaps a refund's original purchase when that purchase matches by reference and financial fields", () => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    cloud.transactions.push(transaction(id("2"), id("1"), { externalReference: "BANK-REFERENCE-ONE" }));
    const local = workspace();
    local.accounts.push(account(id("9")));
    local.transactions.push(
      transaction(id("8"), id("9"), { externalReference: "BANK-REFERENCE-ONE" }),
      transaction(id("10"), id("9"), {
        amount: "5.00", kind: "refund", fromAccountId: null, toAccountId: id("9"),
        occurredOn: "2026-10-02", refundOfTransactionId: id("8"),
      }),
    );

    const prepared = preparePrivateProfileMerge(cloud, local, owner);

    expect(prepared.delta.transactions).toHaveLength(1);
    expect(prepared.delta.transactions[0]).toMatchObject({
      id: id("10"), refundOfTransactionId: id("2"), toAccountId: id("1"),
    });
  });

  it("matches the same account by its complete identity and remaps dependent links", () => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    const local = workspace();
    const localAccount = account(id("9"));
    local.accounts.push(localAccount);
    local.transactions.push(transaction(id("8"), localAccount.id));
    local.snapshots.push({
      id: id("11"), userId: owner, accountId: localAccount.id,
      asOf: "2026-10-01T00:00:00.000Z", reportedBalance: "100.00",
      source: "user_report", verifiedByUser: true,
    });

    const result = preparePrivateProfileMerge(cloud, local, owner);
    expect(result.delta.accounts).toHaveLength(0);
    expect(result.delta.transactions[0].fromAccountId).toBe(id("1"));
    expect(result.delta.snapshots[0].accountId).toBe(id("1"));
  });

  it("maps legacy source-observation identities and preserves cloud commerce", () => {
    const cloud = workspace();
    const cloudAccount = account(id("1"));
    cloud.accounts.push(cloudAccount);
    cloud.transactions.push(transaction(id("2"), cloudAccount.id));
    const local = workspace();
    local.accounts.push({ ...cloudAccount });
    local.transactions.push(transaction(id("8"), cloudAccount.id, {
      sourceSystem: "notion",
      sourceObjectId: "page-1",
    }));

    const merged = preparePrivateProfileMerge(cloud, local, owner, [{
      recordId: id("2"), sourceSystem: "notion", sourceObjectId: "page-1",
    }]);
    expect(merged.delta.transactions).toHaveLength(0);
    expect(merged.transactionIds.get(id("8"))).toBe(id("2"));

    const current = emptyCommerce();
    current.operations.push({ key: "a".repeat(64), completedAt: "2026-10-01T00:00:00.000Z" });
    const incoming = emptyCommerce();
    incoming.operations.push(
      { key: "a".repeat(64), completedAt: "2026-10-02T00:00:00.000Z" },
      { key: "b".repeat(64), completedAt: "2026-10-03T00:00:00.000Z" },
    );
    const commerce = mergePrivateProfileCommerce(current, incoming, owner, merged.transactionIds);
    expect(commerce.added.operations).toBe(1);
    expect(commerce.commerce.operations[0]).toEqual(current.operations[0]);
    expect(commerce.commerce.operations).toHaveLength(2);
  });

  it("is idempotent when the same transfer is prepared again", () => {
    const cloud = workspace();
    const local = workspace();
    const saved = account(id("1"));
    local.accounts.push(saved);
    local.transactions.push(transaction(id("2"), saved.id));
    const first = preparePrivateProfileMerge(cloud, local, owner);
    const second = preparePrivateProfileMerge(first.full, local, owner);
    expect(Object.values(second.delta).every((rows) => rows.length === 0)).toBe(true);
  });

  it("keeps distinct order candidates from the same screenshot", () => {
    const incoming = emptyCommerce();
    incoming.orders.push(order(id("20")), order(id("21"), { candidateId: "purchase-two" }));

    const result = mergePrivateProfileCommerce(emptyCommerce(), incoming, owner, new Map());
    expect(result.commerce.orders.map((row) => row.id)).toEqual([id("20"), id("21")]);
    expect(result.added.orders).toBe(2);
    const repeated = mergePrivateProfileCommerce(result.commerce, incoming, owner, new Map());
    expect(repeated.added.orders).toBe(0);
    expect(repeated.commerce.orders).toEqual(result.commerce.orders);
  });

  it("adds a missing screenshot candidate while retaining another cloud candidate", () => {
    const current = emptyCommerce();
    current.orders.push(order(id("20"), { description: "Cloud version" }));
    const incoming = emptyCommerce();
    incoming.orders.push(order(id("21"), { candidateId: "purchase-two" }));

    const result = mergePrivateProfileCommerce(current, incoming, owner, new Map());
    expect(result.commerce.orders).toEqual([...current.orders, ...incoming.orders]);
    expect(result.added.orders).toBe(1);
  });

  it("remaps refund order, account, original purchase, and credit links to retained cloud identities", () => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    cloud.transactions.push(transaction(id("2"), id("1"), {
      sourceSystem: "statement", sourceObjectId: "purchase-1",
    }));
    const local = workspace();
    local.accounts.push(account(id("9")));
    local.transactions.push(
      transaction(id("8"), id("9"), { sourceSystem: "statement", sourceObjectId: "purchase-1" }),
      transaction(id("10"), id("9"), {
        amount: "5.00", kind: "refund", fromAccountId: null, toAccountId: id("9"),
        refundOfTransactionId: id("8"), occurredOn: "2026-10-02",
      }),
    );
    const prepared = preparePrivateProfileMerge(cloud, local, owner);
    const current = emptyCommerce();
    current.orders.push(order(id("20"), {
      reviewStatus: "saved", payments: [{ transactionId: id("2"), amount: "12.00" }],
    }));
    const incoming = emptyCommerce();
    incoming.orders.push(order(id("21"), {
      reviewStatus: "saved", payments: [{ transactionId: id("8"), amount: "12.00" }],
    }));
    incoming.refunds.push(refund(id("22"), {
      orderId: id("21"), destinationAccountId: id("9"), originalTransactionId: id("8"),
      status: "confirmed", creditMatches: [{ transactionId: id("10"), amount: "5.00",
        confirmedAt: "2026-10-02T00:00:00.000Z", verification: "matched_credit" }],
    }));

    const result = mergePrivateProfileCommerce(current, incoming, owner, prepared.transactionIds, prepared.accountIds);
    expect(result.commerce.orders).toEqual(current.orders);
    expect(result.commerce.refunds[0]).toMatchObject({
      orderId: id("20"), destinationAccountId: id("1"), originalTransactionId: id("2"),
      creditMatches: [{ transactionId: id("10") }],
    });
    expect(prepared.delta.transactions[0]).toMatchObject({
      id: id("10"), toAccountId: id("1"), refundOfTransactionId: id("2"),
    });
  });

  it("recognizes cloud order evidence aliases and remaps a new refund", () => {
    const current = emptyCommerce();
    current.orders.push(order(id("20"), {
      sourceFingerprint: "b".repeat(64), candidateId: "new-evidence-card",
      sources: [{ fingerprint: "a".repeat(64), candidateId: "purchase-one" }],
    }));
    const incoming = emptyCommerce();
    incoming.orders.push(order(id("21")));
    incoming.refunds.push(refund(id("22"), { orderId: id("21") }));

    const result = mergePrivateProfileCommerce(current, incoming, owner, new Map());
    expect(result.commerce.orders).toEqual(current.orders);
    expect(result.commerce.refunds[0].orderId).toBe(id("20"));
    expect(result.added.orders).toBe(0);
  });

  it("recognizes the same order reference on a normalized platform across different evidence", () => {
    const current = emptyCommerce();
    current.orders.push(order(id("20"), {
      platform: "  Test   Store  ", orderReferenceHash: "c".repeat(64),
    }));
    const incoming = emptyCommerce();
    incoming.orders.push(order(id("21"), {
      platform: "test store", orderReferenceHash: "c".repeat(64),
      sourceFingerprint: "d".repeat(64), candidateId: "other-evidence-card",
    }));

    const result = mergePrivateProfileCommerce(current, incoming, owner, new Map());
    expect(result.commerce.orders).toEqual(current.orders);
    expect(result.added.orders).toBe(0);
  });

  it("retains orders with the same reference on different platforms", () => {
    const current = emptyCommerce();
    current.orders.push(order(id("20"), { orderReferenceHash: "c".repeat(64) }));
    const incoming = emptyCommerce();
    incoming.orders.push(order(id("21"), {
      platform: "Other store", orderReferenceHash: "c".repeat(64), sourceFingerprint: "d".repeat(64),
    }));

    const result = mergePrivateProfileCommerce(current, incoming, owner, new Map());
    expect(result.commerce.orders.map((row) => row.id)).toEqual([id("20"), id("21")]);
  });

  it("recognizes a manual order's stable UUID candidate across independently assigned row IDs", () => {
    const current = emptyCommerce();
    current.orders.push(order(id("20"), {
      sourceType: "manual", candidateId: id("30"), sourceFingerprint: null,
    }));
    const incoming = emptyCommerce();
    incoming.orders.push(order(id("21"), {
      sourceType: "manual", candidateId: id("30"), sourceFingerprint: null,
    }));

    const result = mergePrivateProfileCommerce(current, incoming, owner, new Map());
    expect(result.commerce.orders).toEqual(current.orders);
    expect(result.added.orders).toBe(0);
  });

  it("maps independently scanned identical order purchases before constructing the ledger delta", () => {
    const cloud = independentlyScannedPurchase(20, id("1"));
    const local = independentlyScannedPurchase(30, id("9"));
    expect(local.workspace.transactions[0].id).not.toBe(cloud.workspace.transactions[0].id);
    expect(local.workspace.transactions[0].sourceObjectId).not.toBe(cloud.workspace.transactions[0].sourceObjectId);

    const prepared = preparePrivateProfileMerge(cloud.workspace, local.workspace, owner, [], {
      current: cloud.commerce, incoming: local.commerce,
    });
    const merged = mergePrivateProfileCommerce(cloud.commerce, local.commerce, owner,
      prepared.transactionIds, prepared.accountIds);

    expect(prepared.delta.transactions).toEqual([]);
    expect(prepared.transactionIds.get(local.workspace.transactions[0].id)).toBe(cloud.workspace.transactions[0].id);
    expect(prepared.full.transactions).toEqual(cloud.workspace.transactions);
    expect(merged.commerce.orders).toEqual(cloud.commerce.orders);
    expect(merged.added.orders).toBe(0);
  });

  it("refuses conflicting independently scanned payments for the same known order", () => {
    const cloud = independentlyScannedPurchase(20, id("1"));
    const local = independentlyScannedPurchase(30, id("9"), "14.00");
    const before = structuredClone(cloud);

    expect(() => preparePrivateProfileMerge(cloud.workspace, local.workspace, owner, [], {
      current: cloud.commerce, incoming: local.commerce,
    })).toThrow(/review|conflict|match|purchase|payment/i);
    expect(cloud).toEqual(before);
  });

  it("maps independently confirmed identical refund credits before constructing the ledger delta", () => {
    const cloud = independentlyConfirmedRefund(20, id("1"));
    const local = independentlyConfirmedRefund(30, id("9"));
    const cloudCredit = cloud.workspace.transactions.find((row) => row.kind === "refund")!;
    const localCredit = local.workspace.transactions.find((row) => row.kind === "refund")!;
    expect(localCredit.id).not.toBe(cloudCredit.id);
    expect(localCredit.sourceObjectId).not.toBe(cloudCredit.sourceObjectId);

    const prepared = preparePrivateProfileMerge(cloud.workspace, local.workspace, owner, [], {
      current: cloud.commerce, incoming: local.commerce,
    });
    const merged = mergePrivateProfileCommerce(cloud.commerce, local.commerce, owner,
      prepared.transactionIds, prepared.accountIds);

    expect(prepared.delta.transactions).toEqual([]);
    expect(prepared.transactionIds.get(localCredit.id)).toBe(cloudCredit.id);
    expect(prepared.full.transactions).toEqual(cloud.workspace.transactions);
    expect(merged.commerce.refunds).toEqual(cloud.commerce.refunds);
    expect(merged.added.refunds).toBe(0);
  });

  it("refuses conflicting independently confirmed credits for the same known refund", () => {
    const cloud = independentlyConfirmedRefund(20, id("1"));
    const local = independentlyConfirmedRefund(30, id("9"), "2026-10-04");
    const before = structuredClone(cloud);

    expect(() => preparePrivateProfileMerge(cloud.workspace, local.workspace, owner, [], {
      current: cloud.commerce, incoming: local.commerce,
    })).toThrow(/review|conflict|match|refund|credit/i);
    expect(cloud).toEqual(before);
  });
});
