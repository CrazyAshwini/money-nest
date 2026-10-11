/** Shared, exact-decimal order/refund rules. No storage, network or AI calls. */
import { z } from "zod";
import Decimal from "decimal.js";
import { CATEGORIES, type Transaction, type WorkspaceData } from "./types";
import { isoDateSchema, moneySchema, positiveMoneySchema, validateWorkspaceRecord } from "./validation";

export const ORDER_SOURCE_TYPES = ["manual", "order_history_list", "order_history_multipage", "order_detail", "paid_invoice", "delivery_receipt", "cancellation_refund", "ride_history", "subscription_charge", "mobile_recharge", "bank_statement", "credit_card_statement", "paylater_snapshot", "credit_card_snapshot", "fd_certificate", "loan_schedule", "design_reference_only", "unknown"] as const;
export const ORDER_STATUSES = ["unknown", "placed", "confirmed", "shipped", "delivered", "completed", "cancelled", "return_requested", "returned", "partial_cancelled", "refund_initiated", "refund_pending", "refund_received"] as const;
export const ORDER_AMOUNT_ROLES = ["amount_paid", "order_total", "displayed_fare", "refund_expected", "unknown"] as const;
export const FINANCIAL_EVENTS = ["purchase", "refund", "account_snapshot", "bill_payment", "transfer", "loan", "investment", "reference_only", "unknown"] as const;
export type OrderSourceType = typeof ORDER_SOURCE_TYPES[number];
export type OrderStatus = typeof ORDER_STATUSES[number];
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const nullableMoney = moneySchema.nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

export const orderItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  quantity: nullableText(30),
  amount: nullableMoney,
  status: z.enum(ORDER_STATUSES),
});
export const scannedOrderDraftSchema = z.object({
  candidateId: z.string().min(1).max(120),
  sourceType: z.enum(ORDER_SOURCE_TYPES),
  platform: nullableText(100),
  merchant: nullableText(120),
  description: nullableText(200),
  orderReferenceHash: hash.nullable(),
  orderReferenceMasked: nullableText(60),
  occurredOn: isoDateSchema.nullable(),
  status: z.enum(ORDER_STATUSES),
  amount: nullableMoney,
  amountRole: z.enum(ORDER_AMOUNT_ROLES),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  paymentStatus: z.enum(["successful", "pending", "failed", "unknown"]),
  financialEvent: z.enum(FINANCIAL_EVENTS),
  category: z.enum(CATEGORIES).nullable(),
  items: z.array(orderItemSchema).max(40),
  sourceImageIndices: z.array(z.number().int().min(0).max(2)).max(3),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string().max(250)).max(12),
  expectedRefundAmount: nullableMoney,
  expectedRefundBy: isoDateSchema.nullable(),
});
export type ScannedOrderDraft = z.infer<typeof scannedOrderDraftSchema>;
export const reviewedOrderDraftSchema = scannedOrderDraftSchema.extend({
  action: z.enum(["history", "pending", "create", "link"]),
  confirmed: z.boolean(),
  fromAccountId: id.nullable(),
  externalPayer: nullableText(120),
  matchedTransactionId: id.nullable(),
  confirmedDistinct: z.boolean(),
  sourceFingerprint: hash.nullable().optional(),
  existingOrderId: id.nullable().optional(),
});
export type ReviewedOrderDraft = z.infer<typeof reviewedOrderDraftSchema>;
const paymentSchema = z.object({ transactionId: id, amount: positiveMoneySchema });
export const commerceOrderSchema = scannedOrderDraftSchema.extend({
  id, userId: id, sourceFingerprint: hash.nullable(),
  displayedAmount: nullableMoney.optional(),
  evidenceFingerprints: z.array(hash).max(100).default([]),
  sources: z.array(z.object({ fingerprint: hash, candidateId: z.string().min(1).max(120) })).max(100).default([]),
  reviewStatus: z.enum(["history", "pending", "saved"]),
  payments: z.array(paymentSchema).max(40),
  createdAt: timestamp, updatedAt: timestamp,
});
export type CommerceOrder = z.infer<typeof commerceOrderSchema>;
export const REFUND_ROUTES = ["bank", "card", "wallet", "store_credit", "unknown"] as const;
const refundDraftFields = {
  orderId: id.nullable(), originalTransactionId: id.nullable(),
  description: z.string().trim().min(1).max(200),
  expectedAmount: positiveMoneySchema,
  expectedBy: isoDateSchema.nullable(), cancelledOn: isoDateSchema.nullable(),
  destinationAccountId: id.nullable(), route: z.enum(REFUND_ROUTES),
  itemTitle: nullableText(160), notes: nullableText(1000),
};
export const refundDraftSchema = z.object({
  ...refundDraftFields, id: id.optional(),
  status: z.enum(["expected", "user_reported_received", "store_credit", "rejected"]),
});
export type RefundDraft = z.infer<typeof refundDraftSchema>;
export const refundRequestSchema = z.object({
  ...refundDraftFields, id, userId: id,
  status: z.enum(["expected", "user_reported_received", "partial", "confirmed", "store_credit", "rejected"]),
  creditMatches: z.array(z.object({
    transactionId: id, amount: positiveMoneySchema, confirmedAt: timestamp,
    verification: z.enum(["matched_credit", "manual_confirmation"]),
  })).max(100),
  createdAt: timestamp, updatedAt: timestamp,
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export const commerceDataSchema = z.object({
  orders: z.array(commerceOrderSchema).max(10000),
  refunds: z.array(refundRequestSchema).max(10000),
  operations: z.array(z.object({ key: hash, completedAt: timestamp })).max(20000).default([]),
});
export type CommerceData = z.infer<typeof commerceDataSchema>;
export const emptyCommerce = (): CommerceData => ({ orders: [], refunds: [], operations: [] });

const verifyFields = { action: z.literal("verify_refund"), refundId: id, amount: positiveMoneySchema };
export const commerceCommandSchema = z.union([
  z.object({ action: z.literal("commit_orders"), idempotencyKey: hash, orders: z.array(reviewedOrderDraftSchema).min(1).max(60) }),
  z.object({ action: z.literal("save_refund"), refund: refundDraftSchema }),
  z.object({ ...verifyFields, transactionId: id }),
  z.object({ ...verifyFields, receivedOn: isoDateSchema, destinationAccountId: id, bankHistoryConfirmed: z.literal(true) }),
]);
export type CommerceCommand = z.infer<typeof commerceCommandSchema>;
export interface CommerceResult { ordersSaved: number; transactionsCreated: number; transactionsLinked: number; refundsSaved: number; duplicate: boolean }
export class CommerceError extends Error { constructor(message: string) { super(message); this.name = "CommerceError"; } }
function fail(message: string): never { throw new CommerceError(message); }
const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const total = (values: readonly string[]) => values.reduce((sum, value) => sum.plus(value), new Decimal(0));
const owned = <T extends { userId: string }>(rows: readonly T[], userId: string) => rows.filter(row => row.userId === userId);
const nonPurchaseSources = new Set<OrderSourceType>(["bank_statement", "credit_card_statement", "paylater_snapshot", "credit_card_snapshot", "fd_certificate", "loan_schedule", "design_reference_only"]);
export function orderModuleRoute(source: OrderSourceType): string | null {
  if (["bank_statement", "credit_card_statement"].includes(source)) return "/imports";
  if (["paylater_snapshot", "credit_card_snapshot"].includes(source)) return "/accounts";
  if (source === "fd_certificate") return "/fixed-deposits";
  if (source === "loan_schedule") return "/loans";
  return null;
}
export function isOrderPurchase(draft: ScannedOrderDraft): boolean {
  return draft.financialEvent === "purchase" && !nonPurchaseSources.has(draft.sourceType);
}
/** Suggestions require merchant/description and a date as well as amount. Never match amount alone. */
export function findOrderMatches(draft: ScannedOrderDraft, transactions: Transaction[], userId: string): Transaction[] {
  if (!draft.amount || !draft.occurredOn || !isOrderPurchase(draft)) return [];
  return transactions.filter(transaction => transaction.userId === userId && transaction.kind === "expense" && transaction.status !== "voided" && transaction.occurredOn === draft.occurredOn && new Decimal(transaction.amount).eq(draft.amount!) && Boolean(
    (normalize(draft.merchant) && normalize(draft.merchant) === normalize(transaction.merchant)) ||
    (normalize(draft.description) && normalize(draft.description) === normalize(transaction.description)),
  ));
}
export function orderSummary(order: CommerceOrder, commerce: CommerceData) {
  const gross = total(order.reviewStatus === "saved" ? order.payments.map(payment => payment.amount) : []);
  const refunds = commerce.refunds.filter(refund => refund.userId === order.userId && refund.orderId === order.id);
  const confirmedRefunds = total(refunds.flatMap(refund => refund.creditMatches.map(credit => credit.amount)));
  const pendingRefunds = total(refunds.filter(refund => !["rejected", "store_credit"].includes(refund.status)).map(refund => Decimal.max(0, new Decimal(refund.expectedAmount).minus(total(refund.creditMatches.map(credit => credit.amount)))).toFixed(2)));
  return { gross: gross.toFixed(2), confirmedRefunds: confirmedRefunds.toFixed(2), pendingRefunds: pendingRefunds.toFixed(2), net: gross.minus(confirmedRefunds).toFixed(2), projectedNet: gross.minus(confirmedRefunds).minus(pendingRefunds).toFixed(2) };
}
export function commerceSummary(commerce: CommerceData, workspaceOrOrderId?: WorkspaceData | string) {
  if (typeof workspaceOrOrderId === "string") {
    const order = commerce.orders.find(row => row.id === workspaceOrOrderId);
    return order ? { ...orderSummary(order, commerce), orderCount: 1 } : { gross: "0.00", confirmedRefunds: "0.00", pendingRefunds: "0.00", net: "0.00", projectedNet: "0.00", orderCount: 0 };
  }
  const workspace = workspaceOrOrderId;
  const postedIds = workspace ? new Set(workspace.transactions.filter(row => row.status === "posted").map(row => row.id)) : null;
  const orderPayments = commerce.orders.flatMap(order => order.payments.filter(payment => postedIds ? postedIds.has(payment.transactionId) : order.reviewStatus === "saved"));
  const linkedIds = new Set(orderPayments.map(payment => payment.transactionId));
  const refundOriginalIds = new Set(commerce.refunds.map(refund => refund.originalTransactionId).filter(Boolean));
  const originalAmounts = workspace ? workspace.transactions.filter(row => !linkedIds.has(row.id) && refundOriginalIds.has(row.id) && row.kind === "expense" && row.status === "posted").map(row => row.amount) : [];
  const gross = total([...orderPayments.map(payment => payment.amount), ...originalAmounts]);
  const confirmedRefunds = total(commerce.refunds.flatMap(refund => refund.creditMatches.map(credit => credit.amount)));
  const pendingRefunds = total(commerce.refunds.filter(refund => !["rejected", "store_credit"].includes(refund.status)).map(refund => Decimal.max(0, new Decimal(refund.expectedAmount).minus(total(refund.creditMatches.map(credit => credit.amount)))).toFixed(2)));
  return { gross: gross.toFixed(2), confirmedRefunds: confirmedRefunds.toFixed(2), pendingRefunds: pendingRefunds.toFixed(2), net: gross.minus(confirmedRefunds).toFixed(2), projectedNet: gross.minus(confirmedRefunds).minus(pendingRefunds).toFixed(2), orderCount: commerce.orders.length };
}

function requireAccount(workspace: WorkspaceData, accountId: string | null, userId: string, active = true) {
  if (!accountId) return null;
  const account = workspace.accounts.find(row => row.id === accountId && row.userId === userId);
  if (!account || (active && !account.active)) fail("Choose an active account in your profile.");
  return account!;
}
function linkedOriginal(workspace: WorkspaceData, transactionId: string | null, userId: string) {
  if (!transactionId) return null;
  const transaction = workspace.transactions.find(row => row.id === transactionId && row.userId === userId && row.status === "posted" && row.kind === "expense" && row.occurredOn);
  if (!transaction) fail("Choose a posted original purchase in your profile.");
  return transaction!;
}
function ensureRefundLinks(workspace: WorkspaceData, commerce: CommerceData, refund: RefundDraft, userId: string) {
  if (refund.orderId && !commerce.orders.some(order => order.id === refund.orderId && order.userId === userId)) fail("The original order was not found in your profile.");
  const original = linkedOriginal(workspace, refund.originalTransactionId, userId);
  if (refund.orderId && original) {
    const order = commerce.orders.find(row => row.id === refund.orderId)!;
    if (!order.payments.some(payment => payment.transactionId === original.id)) fail("The selected purchase is not linked to this order.");
  }
  if (original && refund.cancelledOn && refund.cancelledOn < original.occurredOn!) fail("Cancellation cannot precede the original purchase.");
  if (original && new Decimal(refund.expectedAmount).gt(original.amount)) fail("The expected refund exceeds the original purchase. Review the amount.");
  requireAccount(workspace, refund.destinationAccountId, userId);
  if (refund.route === "store_credit" && refund.destinationAccountId) fail("Store credit cannot credit a bank or card account.");
  return original;
}

/** Apply to clones, then persist once. A failing batch never changes the supplied workspace. */
export function applyCommerceCommand(workspaceInput: WorkspaceData, commerceInput: CommerceData, userId: string, input: unknown, options: { now?: string; newId?: () => string } = {}) {
  const parsed = commerceCommandSchema.safeParse(input);
  if (!parsed.success) fail("Check the reviewed order or refund details.");
  const command = parsed.data;
  const workspace = structuredClone(workspaceInput);
  const commerce = commerceDataSchema.parse(structuredClone(commerceInput));
  if (commerce.orders.some(row => row.userId !== userId) || commerce.refunds.some(row => row.userId !== userId)) fail("Order ownership does not match your profile.");
  const now = options.now ?? new Date().toISOString();
  const newId = options.newId ?? (() => crypto.randomUUID());
  const result: CommerceResult = { ordersSaved: 0, transactionsCreated: 0, transactionsLinked: 0, refundsSaved: 0, duplicate: false };
  if (command.action === "commit_orders") {
    if (commerce.operations.some(operation => operation.key === command.idempotencyKey)) return { workspace, commerce, result: { ...result, duplicate: true } };
    for (const draft of command.orders) {
      if (!draft.confirmed) fail("Review and confirm every selected order before saving.");
      const manualIdentity = draft.sourceType === "manual" && id.safeParse(draft.candidateId).success;
      const exact = commerce.orders.find(order => order.userId === userId && (
        (draft.existingOrderId && order.id === draft.existingOrderId) ||
        (manualIdentity && order.sourceType === "manual" && order.candidateId === draft.candidateId) ||
        (draft.orderReferenceHash && order.orderReferenceHash === draft.orderReferenceHash && normalize(order.platform) === normalize(draft.platform)) ||
        (draft.sourceFingerprint && ((order.sourceFingerprint === draft.sourceFingerprint && order.candidateId === draft.candidateId) || order.sources.some(source => source.fingerprint === draft.sourceFingerprint && source.candidateId === draft.candidateId)))
      ));
      if (draft.existingOrderId && !exact) fail("The order was not found in your profile.");
      const account = requireAccount(workspace, draft.fromAccountId, userId);
      const purchase = isOrderPurchase(draft);
      if (!purchase && draft.action !== "history") fail("This document is not a purchase. Keep it as history or open its finance module.");
      if (draft.status === "cancelled" && ["create", "pending"].includes(draft.action)) fail("A cancelled order needs a verified existing charge; keep it as history.");
      if (draft.paymentStatus === "failed" && ["create", "pending"].includes(draft.action)) fail("A failed payment cannot create a purchase.");
      const orderId = exact?.id ?? newId();
      let payments = exact?.payments ?? [];
      let actualPaid = exact?.amount ?? draft.amount;
      if (draft.action === "link") {
        const transaction = linkedOriginal(workspace, draft.matchedTransactionId, userId);
        if (!transaction) fail("Choose the existing posted purchase to link.");
        if (account && transaction.fromAccountId !== account.id) fail("The chosen payment belongs to a different account.");
        if (draft.occurredOn && draft.occurredOn !== transaction.occurredOn) fail("The order date differs from the chosen purchase. Review the date.");
        if (draft.amountRole === "amount_paid" && draft.amount && !new Decimal(draft.amount).eq(transaction.amount)) fail("The paid amount differs from the chosen purchase.");
        const allocatedElsewhere = total(commerce.orders.filter(order => order.id !== orderId).flatMap(order => order.payments.filter(payment => payment.transactionId === transaction.id).map(payment => payment.amount)));
        if (allocatedElsewhere.gt(0)) fail("This payment is already linked to another order. Review that order first.");
        if (payments.some(payment => payment.transactionId !== transaction.id)) fail("This order already has another payment. Review its existing link.");
        payments = [{ transactionId: transaction.id, amount: transaction.amount }];
        actualPaid = transaction.amount;
        result.transactionsLinked++;
      } else if (["create", "pending"].includes(draft.action) && draft.amount && new Decimal(draft.amount).gt(0)) {
        if (draft.currency !== "INR") fail("Confirm an INR amount before creating a ledger entry.");
        if (draft.action === "create" && (!draft.occurredOn || (!account && !draft.externalPayer))) fail("A posted purchase needs its actual date and paying account or external payer.");
        if (draft.action === "create" && (draft.paymentStatus !== "successful" || draft.amountRole !== "amount_paid")) fail("Confirm the amount actually paid and successful payment before posting.");
        const pendingExisting = payments.length === 1 ? workspace.transactions.find(transaction => transaction.id === payments[0].transactionId && transaction.status === "pending_review") : undefined;
        if (payments.length && !pendingExisting) {
          // A repeated receipt enriches its saved order; it never adds a second debit.
          result.duplicate = true;
        } else {
          const candidates = findOrderMatches(draft, owned(workspace.transactions, userId).filter(row => row.id !== pendingExisting?.id), userId);
          if (candidates.length && !draft.confirmedDistinct) fail("A similar purchase already exists. Link it or confirm this is a separate purchase.");
          const transaction: Transaction = {
            id: pendingExisting?.id ?? newId(), userId, amount: new Decimal(draft.amount).toFixed(2), currency: "INR", kind: "expense",
            status: draft.action === "create" ? "posted" : "pending_review", occurredOn: draft.occurredOn,
            description: draft.description || draft.merchant || draft.platform || "Reviewed order",
            fromAccountId: account?.id ?? null, toAccountId: null, category: draft.category || "Other", merchant: draft.merchant,
            externalPayer: draft.externalPayer, sourceSystem: "order_scan", sourceObjectId: orderId,
            createdAt: pendingExisting?.createdAt ?? now, updatedAt: now,
          };
          const checked = validateWorkspaceRecord(workspace, "transactions", transaction, userId) as Transaction;
          workspace.transactions = workspace.transactions.filter(row => row.id !== checked.id).concat(checked);
          payments = [{ transactionId: checked.id, amount: checked.amount }];
          actualPaid = checked.amount;
          if (!pendingExisting) result.transactionsCreated++;
        }
      } else if (draft.action === "create") fail("Confirm a positive paid amount before posting.");
      const fields = scannedOrderDraftSchema.parse(draft);
      if (exact) {
        const mergedItems = structuredClone(exact.items);
        for (const item of draft.items) {
          const itemIndex = mergedItems.findIndex(existing => normalize(existing.title) === normalize(item.title) && (!item.quantity || !existing.quantity || normalize(existing.quantity) === normalize(item.quantity)));
          if (itemIndex < 0) mergedItems.push(item);
          else mergedItems[itemIndex] = { ...mergedItems[itemIndex], ...item, quantity: item.quantity ?? mergedItems[itemIndex].quantity, amount: item.amount ?? mergedItems[itemIndex].amount };
        }
        fields.items = mergedItems;
        fields.sourceImageIndices = Array.from(new Set([...exact.sourceImageIndices, ...draft.sourceImageIndices]));
      }
      // Keep confirmed financial fields on subsequent history imports; their evidence cannot rewrite money.
      const lockedFields = exact?.reviewStatus === "saved" ? { occurredOn: exact.occurredOn, amount: actualPaid, currency: exact.currency, amountRole: exact.amountRole, paymentStatus: exact.paymentStatus, ...(draft.financialEvent === "refund" ? { description: exact.description, category: exact.category, merchant: exact.merchant, platform: exact.platform } : {}) } : {};
      const sources = [...(exact?.sources ?? [])];
      if (exact?.sourceFingerprint && !sources.some(source => source.fingerprint === exact.sourceFingerprint && source.candidateId === exact.candidateId)) sources.push({ fingerprint: exact.sourceFingerprint, candidateId: exact.candidateId });
      if (draft.sourceFingerprint && !sources.some(source => source.fingerprint === draft.sourceFingerprint && source.candidateId === draft.candidateId)) sources.push({ fingerprint: draft.sourceFingerprint, candidateId: draft.candidateId });
      const order = commerceOrderSchema.parse({ ...fields, ...lockedFields, amount: actualPaid, displayedAmount: draft.financialEvent === "refund" && exact ? exact.displayedAmount ?? exact.amount : draft.amount, evidenceFingerprints: Array.from(new Set([...(exact?.evidenceFingerprints ?? []), ...(draft.sourceFingerprint ? [draft.sourceFingerprint] : [])])), sources, id: orderId, userId, sourceFingerprint: draft.sourceFingerprint ?? exact?.sourceFingerprint ?? null, payments,
        reviewStatus: payments.some(payment => workspace.transactions.find(row => row.id === payment.transactionId)?.status === "posted") ? "saved" : draft.action === "history" ? "history" : "pending",
        createdAt: exact?.createdAt ?? now, updatedAt: now,
      });
      commerce.orders = commerce.orders.filter(row => row.id !== orderId).concat(order);
      result.ordersSaved++;
      if (draft.financialEvent === "refund" && draft.expectedRefundAmount && new Decimal(draft.expectedRefundAmount).gt(0)) {
        const originalTransactionId = payments.find(payment => workspace.transactions.some(transaction => transaction.id === payment.transactionId && transaction.kind === "expense" && transaction.status === "posted"))?.transactionId ?? null;
        const itemTitle = draft.items.filter(item => ["cancelled", "returned", "return_requested", "refund_initiated", "refund_pending", "refund_received"].includes(item.status)).map(item => item.title).join(", ").slice(0, 160) || draft.items[0]?.title || null;
        const repeated = commerce.refunds.some(refund => refund.orderId === orderId && normalize(refund.itemTitle) === normalize(itemTitle) && new Decimal(refund.expectedAmount).eq(draft.expectedRefundAmount!) && refund.expectedBy === draft.expectedRefundBy);
        if (!repeated) {
          const expectation: RefundDraft = { orderId, originalTransactionId, description: (draft.description || `Refund for ${order.description || order.merchant || "reviewed order"}`).slice(0, 200), expectedAmount: new Decimal(draft.expectedRefundAmount).toFixed(2), expectedBy: draft.expectedRefundBy, cancelledOn: draft.occurredOn, destinationAccountId: null, route: "unknown", status: "expected", itemTitle, notes: "Merchant screenshot records an expectation. Bank or provider credit has not been verified." };
          const original = ensureRefundLinks(workspace, commerce, expectation, userId);
          const reserved = total(commerce.refunds.filter(refund => refund.originalTransactionId === originalTransactionId && !["rejected", "store_credit"].includes(refund.status)).map(refund => refund.expectedAmount));
          if (original && reserved.plus(expectation.expectedAmount).gt(original.amount)) fail("Expected refunds would exceed the original paid purchase. Review the affected items and amounts.");
          commerce.refunds.push(refundRequestSchema.parse({ ...expectation, id: newId(), userId, creditMatches: [], createdAt: now, updatedAt: now }));
          result.refundsSaved++;
        }
      }
    }
    commerce.operations.push({ key: command.idempotencyKey, completedAt: now });
  } else if (command.action === "save_refund") {
    const draft = command.refund;
    const original = ensureRefundLinks(workspace, commerce, draft, userId);
    const repeated = !draft.id ? commerce.refunds.find(refund => refund.userId === userId && refund.orderId === draft.orderId && refund.originalTransactionId === draft.originalTransactionId && normalize(refund.itemTitle) === normalize(draft.itemTitle) && normalize(refund.description) === normalize(draft.description) && new Decimal(refund.expectedAmount).eq(draft.expectedAmount) && refund.expectedBy === draft.expectedBy && refund.cancelledOn === draft.cancelledOn && refund.route === draft.route && refund.destinationAccountId === draft.destinationAccountId) : undefined;
    if (repeated) return { workspace, commerce, result: { ...result, duplicate: true } };
    const existing = draft.id ? commerce.refunds.find(row => row.id === draft.id && row.userId === userId) : undefined;
    const reservedExpectations = total(commerce.refunds.filter(refund => refund.id !== existing?.id && refund.originalTransactionId === draft.originalTransactionId && !["rejected", "store_credit"].includes(refund.status)).map(refund => refund.expectedAmount));
    if (original && !["rejected", "store_credit"].includes(draft.status) && reservedExpectations.plus(draft.expectedAmount).gt(original.amount)) fail("Expected refunds would exceed the original paid purchase. Review the affected items and amounts.");
    if (existing?.creditMatches.length && (draft.originalTransactionId !== existing.originalTransactionId || draft.orderId !== existing.orderId || draft.destinationAccountId !== existing.destinationAccountId || draft.route !== existing.route || new Decimal(draft.expectedAmount).lt(total(existing.creditMatches.map(credit => credit.amount))) || ["rejected", "store_credit"].includes(draft.status))) fail("A refund with confirmed credits cannot change its financial links or discard its received amount.");
    const refundId = existing?.id ?? draft.id ?? newId();
    const credits = existing?.creditMatches ?? [];
    const received = total(credits.map(credit => credit.amount));
    const refund = refundRequestSchema.parse({ ...draft, id: refundId, userId, status: credits.length ? received.eq(draft.expectedAmount) ? "confirmed" : "partial" : draft.route === "store_credit" ? "store_credit" : draft.status, creditMatches: credits, createdAt: existing?.createdAt ?? now, updatedAt: now });
    commerce.refunds = commerce.refunds.filter(row => row.id !== refundId).concat(refund);
    result.refundsSaved++;
  } else {
    const refund = commerce.refunds.find(row => row.id === command.refundId && row.userId === userId);
    if (!refund) fail("The refund was not found in your profile.");
    if (["store_credit", "rejected"].includes(refund.status) || refund.route === "store_credit") fail("Store credit or a rejected refund cannot create a bank credit.");
    const original = linkedOriginal(workspace, refund.originalTransactionId, userId);
    if (!original) fail("Match the original posted purchase before confirming a refund.");
    let credit: Transaction;
    const manual = !("transactionId" in command);
    if (!manual) {
      const found = workspace.transactions.find(row => row.id === command.transactionId && row.userId === userId && row.status === "posted" && row.occurredOn && row.toAccountId && !row.fromAccountId && ["refund", "income", "adjustment"].includes(row.kind));
      if (!found) fail("Choose an existing posted incoming bank, wallet or card credit.");
      credit = { ...found! };
      if (refund.creditMatches.some(match => match.transactionId === credit.id && new Decimal(match.amount).eq(command.amount))) return { workspace, commerce, result: { ...result, duplicate: true } };
      if (credit.refundOfTransactionId && credit.refundOfTransactionId !== original.id) fail("This credit is already linked to another original purchase.");
      if (credit.kind === "refund" && !commerce.refunds.some(row => row.creditMatches.some(match => match.transactionId === credit.id)) && credit.refundOfTransactionId) fail("This refund credit is already recorded in the ledger. Link its existing tracked refund instead of counting it again.");
    } else {
      requireAccount(workspace, command.destinationAccountId, userId);
      if (refund.status === "confirmed") return { workspace, commerce, result: { ...result, duplicate: true } };
      const candidate = workspace.transactions.find(row => row.userId === userId && row.status === "posted" && row.occurredOn === command.receivedOn && row.toAccountId === command.destinationAccountId && !row.fromAccountId && ["refund", "income", "adjustment"].includes(row.kind) && new Decimal(row.amount).eq(command.amount));
      if (candidate && refund.creditMatches.some(match => match.transactionId === candidate.id && match.verification === "manual_confirmation" && new Decimal(match.amount).eq(command.amount))) return { workspace, commerce, result: { ...result, duplicate: true } };
      if (candidate) fail("An incoming credit already exists on this date and account. Match that credit instead.");
      credit = { id: newId(), userId, amount: new Decimal(command.amount).toFixed(2), currency: "INR", kind: "refund", status: "posted", occurredOn: command.receivedOn, description: refund.description, fromAccountId: null, toAccountId: command.destinationAccountId, merchant: original.merchant, category: original.category, sourceSystem: "refund_manual_confirmation", sourceObjectId: `${refund.id}:${command.receivedOn}:${new Decimal(command.amount).toFixed(2)}`, createdAt: now, updatedAt: now };
    }
    const account = requireAccount(workspace, credit.toAccountId, userId, manual);
    if (refund.destinationAccountId && refund.destinationAccountId !== account?.id) fail("This credit reached a different account from the refund destination.");
    if (credit.occurredOn! < original.occurredOn!) fail("The refund credit date cannot precede the original purchase.");
    const received = total(refund.creditMatches.map(match => match.amount));
    if (received.plus(command.amount).gt(refund.expectedAmount)) fail("This credit exceeds the outstanding expected refund.");
    const reserved = total(commerce.refunds.flatMap(row => row.creditMatches.filter(match => match.transactionId === credit.id).map(match => match.amount)));
    if (reserved.plus(command.amount).gt(credit.amount)) fail("This bank credit is already used or the allocation exceeds its amount.");
    // Current ledger design links each credit to one purchase; a partial allocation would incorrectly reduce spend by the full credit.
    if (!new Decimal(command.amount).eq(credit.amount)) fail("Match a credit for this exact refund amount. A larger combined credit needs separate ledger reconciliation.");
    const priorRefunds = total(workspace.transactions.filter(row => row.userId === userId && row.id !== credit.id && row.kind === "refund" && row.status === "posted" && row.refundOfTransactionId === original.id).map(row => row.amount));
    if (priorRefunds.plus(credit.amount).gt(original.amount)) fail("Confirmed refunds would exceed the original paid purchase.");
    credit.kind = "refund";
    credit.refundOfTransactionId = original.id;
    const checked = validateWorkspaceRecord(workspace, "transactions", credit, userId) as Transaction;
    workspace.transactions = workspace.transactions.filter(row => row.id !== credit.id).concat(checked);
    refund.creditMatches.push({ transactionId: credit.id, amount: new Decimal(command.amount).toFixed(2), confirmedAt: now, verification: manual ? "manual_confirmation" : "matched_credit" });
    refund.destinationAccountId = account?.id ?? null;
    refund.status = received.plus(command.amount).eq(refund.expectedAmount) ? "confirmed" : "partial";
    refund.updatedAt = now;
    result.refundsSaved++;
    if (manual) result.transactionsCreated++; else result.transactionsLinked++;
  }
  workspace.auditEvents.push({ id: newId(), userId, entityType: "commerce", entityId: command.action === "verify_refund" ? command.refundId : command.action === "save_refund" ? commerce.refunds.at(-1)!.id : command.idempotencyKey, action: command.action, description: command.action === "commit_orders" ? `Reviewed ${result.ordersSaved} orders; created ${result.transactionsCreated} ledger entries.` : command.action === "save_refund" ? "Refund expectation saved; unconfirmed money stays pending." : "Refund credit confirmed and linked once.", occurredAt: now });
  return { workspace, commerce: commerceDataSchema.parse(commerce), result };
}

/** Generic transaction edits must not invalidate money already linked by an atomic commerce operation. */
export function assertCommerceTransactionEdit(commerce: CommerceData, previous: Transaction | undefined, next: Transaction) {
  if (!previous) return;
  const linked = commerce.orders.some(order => order.payments.some(payment => payment.transactionId === previous.id)) || commerce.refunds.some(refund => refund.originalTransactionId === previous.id || refund.creditMatches.some(match => match.transactionId === previous.id));
  const protectedFields = ["amount", "currency", "kind", "status", "occurredOn", "fromAccountId", "toAccountId", "refundOfTransactionId"] as const;
  if (linked && protectedFields.some(field => (previous[field] ?? null) !== (next[field] ?? null))) fail("This transaction is linked to an order or refund. Review its financial changes from Orders.");
}
