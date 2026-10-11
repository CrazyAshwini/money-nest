import { describe, expect, it } from "vitest";
import { applyCommerceCommand, assertCommerceTransactionEdit, commerceSummary, emptyCommerce, findOrderMatches, orderModuleRoute, type CommerceData, type RefundDraft, type ReviewedOrderDraft } from "./commerce";
import { monthlySummary } from "./finance";
import type { Transaction, WorkspaceData } from "./types";

const OWNER = "8bfa5897-282f-4f78-84cc-95c1e0d59e2a";
const OTHER = "234e12bd-e3c7-4899-8534-d74794b97f33";
const ACCOUNT = "6482b147-efcb-4c9e-94fd-8c4abf660b29";
const ACCOUNT2 = "5b05d787-8326-485e-bd94-751cb79dd183";
function workspace(): WorkspaceData {
  return { accounts: [
    { id: ACCOUNT, userId: OWNER, name: "Synthetic checking", institution: "Imaginary", kind: "bank", maskedSuffix: "1111", active: true },
    { id: ACCOUNT2, userId: OWNER, name: "Synthetic savings", institution: "Imaginary", kind: "bank", maskedSuffix: "2222", active: true },
  ], snapshots: [], transactions: [], bills: [], allocations: [], fixedDeposits: [], loans: [], emis: [], emiAllocations: [], groups: [], shares: [], settlements: [], reminders: [], auditEvents: [] };
}
function draft(overrides: Partial<ReviewedOrderDraft> = {}): ReviewedOrderDraft {
  return { candidateId: "synthetic-card", sourceType: "manual", platform: "Test store", merchant: "Test store", description: "Synthetic groceries", orderReferenceHash: null, orderReferenceMasked: null, occurredOn: "2026-10-09", status: "completed", amount: "100.00", amountRole: "amount_paid", currency: "INR", paymentStatus: "successful", financialEvent: "purchase", category: "Groceries", items: [], sourceImageIndices: [], confidence: "high", warnings: [], expectedRefundAmount: null, expectedRefundBy: null, action: "create", confirmed: true, fromAccountId: ACCOUNT, externalPayer: null, matchedTransactionId: null, confirmedDistinct: false, sourceFingerprint: null, ...overrides };
}
function commit(data: WorkspaceData, commerce = emptyCommerce(), rows = [draft()], key = "a".repeat(64)) {
  return applyCommerceCommand(data, commerce, OWNER, { action: "commit_orders", idempotencyKey: key, orders: rows });
}
function refund(orderId: string | null, originalTransactionId: string | null, overrides: Partial<RefundDraft> = {}): RefundDraft {
  return { orderId, originalTransactionId, description: "Synthetic returned groceries", expectedAmount: "30.00", expectedBy: "2026-10-12", cancelledOn: "2026-10-10", destinationAccountId: ACCOUNT, route: "bank", status: "expected", itemTitle: "Test item", notes: null, ...overrides };
}
function purchased() {
  const first = commit(workspace());
  return { ...first, orderId: first.commerce.orders[0].id, purchaseId: first.workspace.transactions[0].id };
}
function pendingRefund(overrides: Partial<RefundDraft> = {}) {
  const first = purchased();
  const next = applyCommerceCommand(first.workspace, first.commerce, OWNER, { action: "save_refund", refund: refund(first.orderId, first.purchaseId, overrides) });
  return { ...next, orderId: first.orderId, purchaseId: first.purchaseId, refundId: next.commerce.refunds[0].id };
}
function incoming(amount = "30.00", overrides: Partial<Transaction> = {}): Transaction {
  return { id: crypto.randomUUID(), userId: OWNER, amount, currency: "INR", kind: "income", status: "posted", occurredOn: "2026-10-11", description: "Synthetic statement credit", fromAccountId: null, toAccountId: ACCOUNT, sourceSystem: "csv", sourceObjectId: crypto.randomUUID(), ...overrides };
}

describe("reviewed private orders", () => {
  it("updates the same manual pending draft after a lost response and changed operation key", () => {
    const pending = draft({ candidateId: crypto.randomUUID(), action: "pending", occurredOn: null, fromAccountId: null });
    const first = commit(workspace(), emptyCommerce(), [pending]);
    const revised = commit(first.workspace, first.commerce, [{ ...pending, description: "Synthetic corrected draft", amount: "43.21" }], "b".repeat(64));
    expect(revised.commerce.orders).toHaveLength(1);
    expect(revised.workspace.transactions).toHaveLength(1);
    expect(revised.workspace.transactions[0]).toMatchObject({ id: first.workspace.transactions[0].id, amount: "43.21", description: "Synthetic corrected draft", status: "pending_review" });
    expect(monthlySummary(revised.workspace, "2026-10").gross).toBe("0.00");
  });
  it("creates one reviewed purchase with exact money and idempotent replay", () => {
    const first = commit(workspace(), emptyCommerce(), [draft({ amount: "123.45" })]);
    expect(first.workspace.transactions).toHaveLength(1);
    expect(monthlySummary(first.workspace, "2026-10").gross).toBe("123.45");
    const replay = commit(first.workspace, first.commerce, [draft({ amount: "123.45" })]);
    expect(replay.result.duplicate).toBe(true);
    expect(replay.workspace.transactions).toHaveLength(1);
    expect(replay.workspace.auditEvents).toHaveLength(1);
  });
  it("stores missing amount/date/account as history or pending without fabricated money", () => {
    const result = commit(workspace(), emptyCommerce(), [draft({ action: "pending", amount: null, occurredOn: null, fromAccountId: null, currency: null })]);
    expect(result.commerce.orders[0]).toMatchObject({ amount: null, occurredOn: null, reviewStatus: "pending", payments: [] });
    expect(result.workspace.transactions).toEqual([]);
    expect(commerceSummary(result.commerce).gross).toBe("0.00");
  });
  it("keeps a positive unknown-account draft out of realized spending", () => {
    const result = commit(workspace(), emptyCommerce(), [draft({ action: "pending", occurredOn: null, fromAccountId: null })]);
    expect(result.workspace.transactions[0].status).toBe("pending_review");
    expect(monthlySummary(result.workspace, "2026-10").gross).toBe("0.00");
    expect(commerceSummary(result.commerce, result.commerce.orders[0].id).gross).toBe("0.00");
  });
  it.each([
    { occurredOn: null }, { fromAccountId: null }, { confirmed: false }, { paymentStatus: "unknown" as const }, { amountRole: "displayed_fare" as const }, { amount: "0.00" }, { currency: "USD" },
  ])("refuses an incomplete or unconfirmed posted purchase %j", change => {
    expect(() => commit(workspace(), emptyCommerce(), [draft(change)])).toThrow();
  });
  it("keeps a visibly cancelled zero-fare ride as history only", () => {
    const result = commit(workspace(), emptyCommerce(), [draft({ action: "history", sourceType: "ride_history", status: "cancelled", amount: "0.00", amountRole: "displayed_fare" })]);
    expect(result.commerce.orders).toHaveLength(1);
    expect(result.workspace.transactions).toHaveLength(0);
    expect(() => commit(workspace(), emptyCommerce(), [draft({ status: "cancelled" })])).toThrow(/cancelled/);
  });
  it.each(["bank_statement", "credit_card_snapshot", "paylater_snapshot", "fd_certificate", "loan_schedule", "design_reference_only"] as const)("routes %s without an expense even if maliciously labelled purchase", sourceType => {
    expect(() => commit(workspace(), emptyCommerce(), [draft({ sourceType })])).toThrow(/not a purchase/);
    const result = commit(workspace(), emptyCommerce(), [draft({ sourceType, action: "history" })]);
    expect(result.workspace.transactions).toHaveLength(0);
    expect(orderModuleRoute(sourceType)).toEqual(sourceType === "design_reference_only" ? null : expect.any(String));
  });
  it("links a verified existing debit rather than adding a second expense", () => {
    const first = purchased();
    const cleanCommerce = emptyCommerce();
    const result = commit(first.workspace, cleanCommerce, [draft({ action: "link", matchedTransactionId: first.purchaseId })]);
    expect(result.workspace.transactions).toHaveLength(1);
    expect(result.commerce.orders[0].payments[0].transactionId).toBe(first.purchaseId);
    expect(result.result.transactionsCreated).toBe(0);
  });
  it("uses actual linked payment over displayed fare but rejects contradictory paid totals/accounts/dates", () => {
    const first = purchased();
    const linked = commit(first.workspace, emptyCommerce(), [draft({ action: "link", amount: "80.00", amountRole: "displayed_fare", matchedTransactionId: first.purchaseId })]);
    expect(linked.commerce.orders[0].amount).toBe("100.00");
    expect(linked.commerce.orders[0].displayedAmount).toBe("80.00");
    expect(linked.workspace.transactions).toHaveLength(1);
    for (const override of [{ amount: "80.00" }, { fromAccountId: ACCOUNT2 }, { occurredOn: "2026-10-08" }]) expect(() => commit(first.workspace, emptyCommerce(), [draft({ action: "link", matchedTransactionId: first.purchaseId, ...override })])).toThrow();
  });
  it("recognizes a strong order reference on a subsequent screenshot without another debit", () => {
    const reference = "c".repeat(64);
    const first = commit(workspace(), emptyCommerce(), [draft({ orderReferenceHash: reference })]);
    const second = commit(first.workspace, first.commerce, [draft({ candidateId: "new-image-card", orderReferenceHash: reference, sourceFingerprint: "d".repeat(64) })], "b".repeat(64));
    expect(second.commerce.orders).toHaveLength(1);
    expect(second.workspace.transactions).toHaveLength(1);
  });
  it("requires review for possible duplicates and never matches amount alone", () => {
    const first = purchased();
    expect(() => commit(first.workspace, emptyCommerce(), [draft()])).toThrow(/similar purchase/);
    expect(findOrderMatches(draft({ merchant: "Another merchant", description: "Different shopping" }), first.workspace.transactions, OWNER)).toEqual([]);
    const distinct = commit(first.workspace, emptyCommerce(), [draft({ confirmedDistinct: true })]);
    expect(distinct.workspace.transactions).toHaveLength(2);
    expect(findOrderMatches(draft(), first.workspace.transactions, OTHER)).toEqual([]);
  });
  it("rejects another profile or inactive payment account", () => {
    const data = workspace();
    data.accounts[0].userId = OTHER;
    expect(() => commit(data)).toThrow(/active account/);
    data.accounts[0].userId = OWNER; data.accounts[0].active = false;
    expect(() => commit(data)).toThrow(/active account/);
  });
  it("rolls back the entire reviewed batch on a later invalid entry", () => {
    const data = workspace(); const commerce = emptyCommerce();
    expect(() => commit(data, commerce, [draft(), draft({ candidateId: "second", fromAccountId: OTHER })])).toThrow();
    expect(data.transactions).toEqual([]); expect(data.auditEvents).toEqual([]); expect(commerce.orders).toEqual([]);
  });
  it("finalizes a pending order using the same ledger transaction", () => {
    const pending = commit(workspace(), emptyCommerce(), [draft({ action: "pending", occurredOn: null, fromAccountId: null })]);
    const complete = commit(pending.workspace, pending.commerce, [draft({ existingOrderId: pending.commerce.orders[0].id })], "b".repeat(64));
    expect(complete.workspace.transactions).toHaveLength(1);
    expect(complete.workspace.transactions[0]).toMatchObject({ id: pending.workspace.transactions[0].id, status: "posted", occurredOn: "2026-10-09", fromAccountId: ACCOUNT });
    expect(complete.commerce.orders[0]).toMatchObject({ occurredOn: "2026-10-09", reviewStatus: "saved" });
  });
  it("enriches a purchased multi-item order with cancellation evidence without erasing other items or claiming a credit", () => {
    const first = commit(workspace(), emptyCommerce(), [draft({ items: [{ title: "Test shirt", quantity: "1", amount: "30.00", status: "delivered" }, { title: "Test trousers", quantity: "1", amount: "70.00", status: "delivered" }] })]);
    const enriched = commit(first.workspace, first.commerce, [draft({ candidateId: "refund-card", existingOrderId: first.commerce.orders[0].id, action: "history", sourceType: "cancellation_refund", financialEvent: "refund", description: "Shirt cancellation", amount: "30.00", amountRole: "refund_expected", occurredOn: "2026-10-10", status: "refund_received", expectedRefundAmount: "30.00", expectedRefundBy: "2026-10-12", items: [{ title: "Test shirt", quantity: null, amount: null, status: "cancelled" }] })], "b".repeat(64));
    expect(enriched.commerce.orders[0]).toMatchObject({ description: "Synthetic groceries", amount: "100.00", occurredOn: "2026-10-09" });
    expect(enriched.commerce.orders[0].items).toHaveLength(2);
    expect(enriched.commerce.orders[0].items[0]).toMatchObject({ title: "Test shirt", amount: "30.00", quantity: "1", status: "cancelled" });
    expect(enriched.commerce.refunds[0]).toMatchObject({ itemTitle: "Test shirt", status: "expected", expectedAmount: "30.00", destinationAccountId: null, originalTransactionId: first.workspace.transactions[0].id });
    expect(enriched.workspace.transactions).toHaveLength(1);
    expect(monthlySummary(enriched.workspace, "2026-10").net).toBe("100.00");
  });
});

describe("refund lifecycle and exact ledger reconciliation", () => {
  it("keeps expected money pending and deduplicates repeat requests", () => {
    const first = pendingRefund();
    expect(monthlySummary(first.workspace, "2026-10").net).toBe("100.00");
    expect(commerceSummary(first.commerce)).toMatchObject({ confirmedRefunds: "0.00", pendingRefunds: "30.00", net: "100.00", projectedNet: "70.00" });
    const replay = applyCommerceCommand(first.workspace, first.commerce, OWNER, { action: "save_refund", refund: refund(first.orderId, first.purchaseId) });
    expect(replay.commerce.refunds).toHaveLength(1); expect(replay.result.duplicate).toBe(true);
  });
  it("records unverified user reports and store credit without cash movement", () => {
    const reported = pendingRefund({ status: "user_reported_received" });
    expect(reported.workspace.transactions).toHaveLength(1);
    const storeCredit = pendingRefund({ route: "store_credit", destinationAccountId: null, status: "store_credit" });
    expect(storeCredit.workspace.transactions).toHaveLength(1);
    expect(commerceSummary(storeCredit.commerce).pendingRefunds).toBe("0.00");
    expect(() => applyCommerceCommand(storeCredit.workspace, storeCredit.commerce, OWNER, { action: "verify_refund", refundId: storeCredit.refundId, amount: "30.00", receivedOn: "2026-10-11", destinationAccountId: ACCOUNT, bankHistoryConfirmed: true })).toThrow(/Store credit/);
  });
  it("reclassifies one existing statement credit as a linked refund and replays once", () => {
    const first = pendingRefund(); const credit = incoming(); first.workspace.transactions.push(credit);
    const command = { action: "verify_refund", refundId: first.refundId, amount: "30.00", transactionId: credit.id };
    const result = applyCommerceCommand(first.workspace, first.commerce, OWNER, command);
    expect(result.workspace.transactions).toHaveLength(2);
    expect(result.workspace.transactions.find(row => row.id === credit.id)).toMatchObject({ kind: "refund", refundOfTransactionId: first.purchaseId });
    expect(monthlySummary(result.workspace, "2026-10")).toMatchObject({ net: "70.00", income: "0.00" });
    const replay = applyCommerceCommand(result.workspace, result.commerce, OWNER, command);
    expect(replay.commerce.refunds[0].creditMatches).toHaveLength(1); expect(replay.result.duplicate).toBe(true);
  });
  it("allows separately confirmed partial installments and preserves the outstanding difference", () => {
    const first = pendingRefund(); const credit1 = incoming("10.00"); const credit2 = incoming("20.00", { occurredOn: "2026-10-12" });
    first.workspace.transactions.push(credit1, credit2);
    const partial = applyCommerceCommand(first.workspace, first.commerce, OWNER, { action: "verify_refund", refundId: first.refundId, amount: "10.00", transactionId: credit1.id });
    expect(partial.commerce.refunds[0].status).toBe("partial"); expect(commerceSummary(partial.commerce).pendingRefunds).toBe("20.00");
    const full = applyCommerceCommand(partial.workspace, partial.commerce, OWNER, { action: "verify_refund", refundId: first.refundId, amount: "20.00", transactionId: credit2.id });
    expect(full.commerce.refunds[0]).toMatchObject({ status: "confirmed" }); expect(commerceSummary(full.commerce).pendingRefunds).toBe("0.00");
  });
  it("requires explicit confirmation of bank history to create a manual credit once", () => {
    const first = pendingRefund();
    const command = { action: "verify_refund", refundId: first.refundId, amount: "30.00", receivedOn: "2026-10-11", destinationAccountId: ACCOUNT, bankHistoryConfirmed: true };
    expect(() => applyCommerceCommand(first.workspace, first.commerce, OWNER, { ...command, bankHistoryConfirmed: false })).toThrow();
    const full = applyCommerceCommand(first.workspace, first.commerce, OWNER, command);
    expect(full.workspace.transactions).toHaveLength(2); expect(full.commerce.refunds[0].creditMatches[0].verification).toBe("manual_confirmation");
    expect(applyCommerceCommand(full.workspace, full.commerce, OWNER, command).workspace.transactions).toHaveLength(2);
  });
  it("proposes an existing incoming credit instead of inserting a duplicate manual credit", () => {
    const first = pendingRefund(); first.workspace.transactions.push(incoming());
    expect(() => applyCommerceCommand(first.workspace, first.commerce, OWNER, { action: "verify_refund", refundId: first.refundId, amount: "30.00", receivedOn: "2026-10-11", destinationAccountId: ACCOUNT, bankHistoryConfirmed: true })).toThrow(/already exists/);
  });
  it("rejects mismatched account, foreign owner, pending credit, earlier date and oversized credit", () => {
    const first = pendingRefund();
    for (const credit of [incoming("30.00", { toAccountId: ACCOUNT2 }), incoming("30.00", { userId: OTHER }), incoming("30.00", { status: "pending_review" }), incoming("30.00", { occurredOn: "2026-10-08" }), incoming("40.00")]) {
      const data = structuredClone(first.workspace); data.transactions.push(credit);
      expect(() => applyCommerceCommand(data, first.commerce, OWNER, { action: "verify_refund", refundId: first.refundId, amount: credit.amount, transactionId: credit.id })).toThrow();
    }
  });
  it("blocks bank-credit reuse and cumulative refunds above the original purchase", () => {
    const first = pendingRefund(); const credit = incoming(); first.workspace.transactions.push(credit);
    const received = applyCommerceCommand(first.workspace, first.commerce, OWNER, { action: "verify_refund", refundId: first.refundId, amount: "30.00", transactionId: credit.id });
    const second = applyCommerceCommand(received.workspace, received.commerce, OWNER, { action: "save_refund", refund: refund(first.orderId, first.purchaseId, { itemTitle: "Other item", expectedAmount: "20.00" }) });
    expect(() => applyCommerceCommand(second.workspace, second.commerce, OWNER, { action: "verify_refund", refundId: second.commerce.refunds[1].id, amount: "30.00", transactionId: credit.id })).toThrow();
    expect(() => applyCommerceCommand(second.workspace, second.commerce, OWNER, { action: "save_refund", refund: refund(first.orderId, first.purchaseId, { itemTitle: "Oversized item", expectedAmount: "60.00" }) })).toThrow(/exceed/);
  });
  it("retains confirmed credits and protects linked ledger financial fields", () => {
    const first = pendingRefund(); const credit = incoming(); first.workspace.transactions.push(credit);
    const full = applyCommerceCommand(first.workspace, first.commerce, OWNER, { action: "verify_refund", refundId: first.refundId, amount: "30.00", transactionId: credit.id });
    expect(() => applyCommerceCommand(full.workspace, full.commerce, OWNER, { action: "save_refund", refund: refund(first.orderId, first.purchaseId, { id: first.refundId, status: "rejected" }) })).toThrow(/confirmed credits/);
    const purchase = full.workspace.transactions.find(row => row.id === first.purchaseId)!;
    expect(() => assertCommerceTransactionEdit(full.commerce, purchase, { ...purchase, amount: "90.00" })).toThrow(/linked/);
    expect(() => assertCommerceTransactionEdit(full.commerce, purchase, { ...purchase, description: "Corrected merchant label" })).not.toThrow();
  });
  it("keeps pending refunds without an original match and rejects confirming them", () => {
    const saved = applyCommerceCommand(workspace(), emptyCommerce(), OWNER, { action: "save_refund", refund: refund(null, null, { destinationAccountId: null }) });
    expect(saved.workspace.transactions).toHaveLength(0);
    expect(() => applyCommerceCommand(saved.workspace, saved.commerce, OWNER, { action: "verify_refund", refundId: saved.commerce.refunds[0].id, amount: "30.00", receivedOn: "2026-10-11", destinationAccountId: ACCOUNT, bankHistoryConfirmed: true })).toThrow(/original posted/);
  });
  it("includes original posted purchases tracked through a standalone refund in realized commerce net", () => {
    const first = purchased();
    const saved = applyCommerceCommand(first.workspace, emptyCommerce(), OWNER, { action: "save_refund", refund: refund(null, first.purchaseId) });
    const received = applyCommerceCommand(saved.workspace, saved.commerce, OWNER, { action: "verify_refund", refundId: saved.commerce.refunds[0].id, amount: "30.00", receivedOn: "2026-10-11", destinationAccountId: ACCOUNT, bankHistoryConfirmed: true });
    expect(commerceSummary(received.commerce, received.workspace)).toMatchObject({ gross: "100.00", confirmedRefunds: "30.00", net: "70.00" });
  });
  it("rejects a forged foreign persisted order before exposing or mutating it", () => {
    const first = purchased(); const commerce: CommerceData = structuredClone(first.commerce); commerce.orders[0].userId = OTHER;
    expect(() => commit(first.workspace, commerce)).toThrow(/ownership/);
  });
});
