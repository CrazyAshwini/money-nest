import type { CommerceData } from "./commerce";
import Decimal from "decimal.js";
import type { WorkspaceData } from "./types";

type SourceIdentity = {
  recordId: string;
  sourceSystem: string;
  sourceObjectId: string;
};

const sourceKey = (sourceSystem: string | null | undefined, sourceObjectId: string | null | undefined) =>
  sourceSystem && sourceObjectId ? `${sourceSystem}\u0000${sourceObjectId}` : null;

const accountKey = (account: WorkspaceData["accounts"][number]) =>
  [account.kind, account.institution, account.maskedSuffix, account.name]
    .map((value) => value.trim().toLocaleLowerCase())
    .join("\u0000");

const normalize = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const orderSourceKeys = (row: CommerceData["orders"][number]) => new Set([
  ...(row.sourceFingerprint ? [sourceKey(row.sourceFingerprint, row.candidateId)!] : []),
  ...row.sources.map((source) => sourceKey(source.fingerprint, source.candidateId)!),
]);

function matchingOrder(
  known: CommerceData["orders"],
  incoming: CommerceData["orders"][number],
) {
  const exact = known.find((order) => order.id === incoming.id);
  if (exact) return exact;
  const keys = orderSourceKeys(incoming);
  const matches = known.filter((order) =>
    (incoming.sourceType === "manual" && order.sourceType === "manual" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming.candidateId) &&
      order.candidateId === incoming.candidateId) ||
    (incoming.orderReferenceHash && incoming.orderReferenceHash === order.orderReferenceHash &&
      normalize(incoming.platform) === normalize(order.platform)) ||
    [...orderSourceKeys(order)].some((key) => keys.has(key)),
  );
  if (matches.length > 1) throw new Error("An order matches multiple cloud records. Review its payments before merging.");
  return matches[0];
}

function sameRefund(
  existing: CommerceData["refunds"][number],
  incoming: CommerceData["refunds"][number],
) {
  return existing.orderId === incoming.orderId &&
    existing.originalTransactionId === incoming.originalTransactionId &&
    normalize(existing.itemTitle) === normalize(incoming.itemTitle) &&
    normalize(existing.description) === normalize(incoming.description) &&
    new Decimal(existing.expectedAmount).eq(incoming.expectedAmount) &&
    existing.expectedBy === incoming.expectedBy && existing.cancelledOn === incoming.cancelledOn &&
    existing.route === incoming.route && existing.destinationAccountId === incoming.destinationAccountId;
}

function remapRefund(
  source: CommerceData["refunds"][number],
  ownerId: string,
  transactionIds: Map<string, string>,
  accountIds: Map<string, string>,
  orderIds: Map<string, string>,
) {
  return {
    ...source,
    userId: ownerId,
    orderId: source.orderId ? orderIds.get(source.orderId) ?? source.orderId : null,
    destinationAccountId: source.destinationAccountId
      ? accountIds.get(source.destinationAccountId) ?? source.destinationAccountId : null,
    originalTransactionId: source.originalTransactionId
      ? transactionIds.get(source.originalTransactionId) ?? source.originalTransactionId : null,
    creditMatches: source.creditMatches.map((match) => ({
      ...match,
      transactionId: transactionIds.get(match.transactionId) ?? match.transactionId,
    })),
  };
}

function remap<T extends Record<string, unknown>>(
  record: T,
  fields: string[],
  idMap: Map<string, string>,
): T {
  const result: Record<string, unknown> = { ...record };
  for (const field of fields) {
    const id = result[field];
    if (typeof id === "string") result[field] = idMap.get(id) ?? id;
  }
  return result as T;
}

/** Builds an insert-only workspace delta. Existing cloud rows always take precedence. */
export function preparePrivateProfileMerge(
  current: WorkspaceData,
  incoming: WorkspaceData,
  ownerId: string,
  sourceIdentities: SourceIdentity[] = [],
  commerce?: { current: CommerceData; incoming: CommerceData },
) {
  const full = structuredClone(current);
  const delta = Object.fromEntries(
    Object.keys(incoming).map((key) => [key, []]),
  ) as unknown as WorkspaceData;
  const accountIds = new Map<string, string>();
  const transactionIds = new Map<string, string>();

  const existingAccountsById = new Map(current.accounts.map((row) => [row.id, row]));
  const existingAccountsByKey = new Map<string, string[]>();
  for (const row of current.accounts) {
    const key = accountKey(row);
    existingAccountsByKey.set(key, [...(existingAccountsByKey.get(key) ?? []), row.id]);
  }
  const incomingAccountKeys = new Map<string, number>();
  for (const row of incoming.accounts) {
    const key = accountKey(row);
    incomingAccountKeys.set(key, (incomingAccountKeys.get(key) ?? 0) + 1);
  }
  for (const source of incoming.accounts) {
    const exact = existingAccountsById.get(source.id);
    const candidates = existingAccountsByKey.get(accountKey(source)) ?? [];
    const naturalMatch = !exact && incomingAccountKeys.get(accountKey(source)) === 1 && candidates.length === 1
      ? candidates[0]
      : undefined;
    const matchedId = exact?.id ?? naturalMatch;
    if (matchedId) accountIds.set(source.id, matchedId);
    else {
      const row = { ...source, userId: ownerId };
      delta.accounts.push(row);
      full.accounts.push(row);
      accountIds.set(source.id, source.id);
    }
  }

  const existingTransactionsById = new Map(current.transactions.map((row) => [row.id, row]));
  const existingTransactionsBySource = new Map<string, string>();
  for (const row of current.transactions) {
    const key = sourceKey(row.sourceSystem, row.sourceObjectId);
    if (key) existingTransactionsBySource.set(key, row.id);
  }
  for (const identity of sourceIdentities) {
    const key = sourceKey(identity.sourceSystem, identity.sourceObjectId);
    if (key) existingTransactionsBySource.set(key, identity.recordId);
  }
  const orderPaymentAliases = new Map<string, string>();
  const orderIds = new Map<string, string>();
  if (commerce) {
    const localTransactions = new Map(incoming.transactions.map((row) => [row.id, row]));
    for (const order of commerce.incoming.orders) {
      const cloudOrder = matchingOrder(commerce.current.orders, order);
      orderIds.set(order.id, cloudOrder?.id ?? order.id);
      if (!cloudOrder) continue;
      for (const payment of order.payments) {
        const local = localTransactions.get(payment.transactionId);
        if (!local) throw new Error("An order payment is missing from the transfer.");
        const key = sourceKey(local.sourceSystem, local.sourceObjectId);
        const existingId = existingTransactionsById.get(local.id)?.id ??
          (key ? existingTransactionsBySource.get(key) : undefined);
        if (existingId && cloudOrder.payments.some((row) => row.transactionId === existingId)) continue;
        const candidates = cloudOrder.payments.flatMap((cloudPayment) => {
          const cloud = existingTransactionsById.get(cloudPayment.transactionId);
          return cloud && new Decimal(payment.amount).eq(cloudPayment.amount) &&
            new Decimal(local.amount).eq(cloud.amount) &&
            local.currency === cloud.currency && local.kind === cloud.kind &&
            local.status === cloud.status && local.occurredOn === cloud.occurredOn &&
            (local.fromAccountId ? accountIds.get(local.fromAccountId) ?? local.fromAccountId : null) === cloud.fromAccountId &&
            (local.toAccountId ? accountIds.get(local.toAccountId) ?? local.toAccountId : null) === cloud.toAccountId
            ? [cloud.id] : [];
        });
        if (candidates.length !== 1 || (existingId && existingId !== candidates[0]))
          throw new Error("An existing order has different payment records. Review it before merging.");
        orderPaymentAliases.set(local.id, candidates[0]);
      }
    }
  }
  const seenIncomingSources = new Set<string>();
  for (const row of incoming.transactions) {
    const key = sourceKey(row.sourceSystem, row.sourceObjectId);
    if (key && seenIncomingSources.has(key))
      throw new Error("The transfer contains duplicate transaction sources.");
    if (key) seenIncomingSources.add(key);
    const matchedId = existingTransactionsById.get(row.id)?.id ??
      (key ? existingTransactionsBySource.get(key) : undefined) ?? orderPaymentAliases.get(row.id);
    if (matchedId) transactionIds.set(row.id, matchedId);
    else transactionIds.set(row.id, row.id);
  }
  if (commerce) {
    const localTransactions = new Map(incoming.transactions.map((row) => [row.id, row]));
    for (const source of commerce.incoming.refunds) {
      const mapped = remapRefund(source, ownerId, transactionIds, accountIds, orderIds);
      const exact = commerce.current.refunds.find((row) => row.id === mapped.id);
      const candidates = exact ? [exact] : commerce.current.refunds.filter((row) => sameRefund(row, mapped));
      if (candidates.length > 1) throw new Error("A refund matches multiple cloud records. Review its credits before merging.");
      const cloudRefund = candidates[0];
      if (!cloudRefund) continue;
      for (const credit of source.creditMatches) {
        const local = localTransactions.get(credit.transactionId);
        if (!local) throw new Error("A refund credit is missing from the transfer.");
        const existingId = transactionIds.get(local.id);
        if (cloudRefund.creditMatches.some((row) => row.transactionId === existingId)) continue;
        const matches = cloudRefund.creditMatches.flatMap((cloudMatch) => {
          const cloud = existingTransactionsById.get(cloudMatch.transactionId);
          return cloud && new Decimal(credit.amount).eq(cloudMatch.amount) &&
            new Decimal(local.amount).eq(cloud.amount) &&
            local.currency === cloud.currency && local.kind === cloud.kind &&
            local.status === cloud.status && local.occurredOn === cloud.occurredOn &&
            (local.fromAccountId ? accountIds.get(local.fromAccountId) ?? local.fromAccountId : null) === cloud.fromAccountId &&
            (local.toAccountId ? accountIds.get(local.toAccountId) ?? local.toAccountId : null) === cloud.toAccountId &&
            (local.refundOfTransactionId ? transactionIds.get(local.refundOfTransactionId) ?? local.refundOfTransactionId : null) === cloud.refundOfTransactionId
            ? [cloud.id] : [];
        });
        if (matches.length !== 1 || (existingTransactionsById.has(existingId!) && existingId !== matches[0]))
          throw new Error("An existing refund has different credit records. Review it before merging.");
        transactionIds.set(local.id, matches[0]);
      }
    }
  }

  const appendRows = <K extends Exclude<keyof WorkspaceData, "accounts" | "transactions" | "auditEvents">>(
    collection: K,
    remappedRows: WorkspaceData[K],
  ) => {
    const existingIds = new Set(full[collection].map((row) => row.id));
    for (const row of remappedRows) {
      if (existingIds.has(row.id)) continue;
      existingIds.add(row.id);
      delta[collection].push(row as never);
      full[collection].push(row as never);
    }
  };

  const transactionRows = incoming.transactions.map((row) => ({
    ...remap(row as unknown as Record<string, unknown>, ["fromAccountId", "toAccountId"], accountIds),
    userId: ownerId,
    refundOfTransactionId: row.refundOfTransactionId
      ? transactionIds.get(row.refundOfTransactionId) ?? row.refundOfTransactionId
      : row.refundOfTransactionId,
  })) as WorkspaceData["transactions"];
  const existingTransactionIds = new Set(full.transactions.map((row) => row.id));
  const existingTransactionSources = new Set(existingTransactionsBySource.keys());
  for (let index = 0; index < transactionRows.length; index++) {
    const row = transactionRows[index];
    const original = incoming.transactions[index];
    const key = sourceKey(original.sourceSystem, original.sourceObjectId);
    const matched = transactionIds.get(original.id) !== original.id;
    if (matched || existingTransactionIds.has(row.id) || (key && existingTransactionSources.has(key))) continue;
    existingTransactionIds.add(row.id);
    if (key) existingTransactionSources.add(key);
    delta.transactions.push(row);
    full.transactions.push(row);
  }

  appendRows("snapshots", incoming.snapshots.map((row) => ({
    ...row,
    userId: ownerId,
    accountId: accountIds.get(row.accountId) ?? row.accountId,
  })));
  appendRows("bills", incoming.bills.map((row) => ({
    ...row,
    userId: ownerId,
    accountId: accountIds.get(row.accountId) ?? row.accountId,
  })));
  appendRows("fixedDeposits", incoming.fixedDeposits.map((row) => ({
    ...row,
    userId: ownerId,
    backingAccountId: row.backingAccountId ? accountIds.get(row.backingAccountId) ?? row.backingAccountId : null,
    payoutAccountId: row.payoutAccountId ? accountIds.get(row.payoutAccountId) ?? row.payoutAccountId : null,
  })));
  appendRows("loans", incoming.loans.map((row) => ({
    ...row,
    userId: ownerId,
    repaymentAccountId: row.repaymentAccountId ? accountIds.get(row.repaymentAccountId) ?? row.repaymentAccountId : null,
  })));
  appendRows("emis", incoming.emis.map((row) => ({ ...row, userId: ownerId })));
  appendRows("allocations", incoming.allocations.map((row) => ({
    ...row,
    userId: ownerId,
    transactionId: transactionIds.get(row.transactionId) ?? row.transactionId,
  })));
  appendRows("emiAllocations", incoming.emiAllocations.map((row) => ({
    ...row,
    userId: ownerId,
    transactionId: transactionIds.get(row.transactionId) ?? row.transactionId,
  })));
  appendRows("groups", incoming.groups.map((row) => ({
    ...row,
    userId: ownerId,
    transactionId: row.transactionId ? transactionIds.get(row.transactionId) ?? row.transactionId : null,
  })));
  appendRows("shares", incoming.shares.map((row) => ({ ...row, userId: ownerId })));
  appendRows("settlements", incoming.settlements.map((row) => ({
    ...row,
    userId: ownerId,
    transactionId: transactionIds.get(row.transactionId) ?? row.transactionId,
  })));
  appendRows("reminders", incoming.reminders.map((row) => ({ ...row, userId: ownerId })));
  // Historical audit events are handled by the immutable legacy-audit store in SQL.
  delta.auditEvents = incoming.auditEvents.map((row) => ({ ...row, userId: ownerId }));

  return { full, delta, transactionIds, accountIds };
}

/** Keep every cloud order/refund/operation; append only unseen identities from the transfer. */
export function mergePrivateProfileCommerce(
  current: CommerceData,
  incoming: CommerceData,
  ownerId: string,
  transactionIds: Map<string, string>,
  accountIds: Map<string, string> = new Map(),
) {
  const orderIds = new Map<string, string>();
  const knownOrders = [...current.orders];
  const orders = [] as CommerceData["orders"];
  for (const source of incoming.orders) {
    const matched = matchingOrder(knownOrders, source);
    orderIds.set(source.id, matched?.id ?? source.id);
    if (matched) continue;
    const row = {
      ...source,
      userId: ownerId,
      payments: source.payments.map((payment) => ({
        ...payment,
        transactionId: transactionIds.get(payment.transactionId) ?? payment.transactionId,
      })),
    };
    orders.push(row);
    knownOrders.push(row);
  }
  const currentRefundIds = new Set(current.refunds.map((row) => row.id));
  const refunds = [] as CommerceData["refunds"];
  for (const source of incoming.refunds) {
    const row = remapRefund(source, ownerId, transactionIds, accountIds, orderIds);
    if (currentRefundIds.has(row.id) || [...current.refunds, ...refunds].some((existing) => sameRefund(existing, row))) continue;
    currentRefundIds.add(row.id);
    refunds.push(row);
  }
  const currentOperationKeys = new Set(current.operations.map((row) => row.key));
  const operations = incoming.operations.filter((row) => {
    if (currentOperationKeys.has(row.key)) return false;
    currentOperationKeys.add(row.key);
    return true;
  });
  return {
    commerce: {
      orders: [...current.orders, ...orders],
      refunds: [...current.refunds, ...refunds],
      operations: [...current.operations, ...operations],
    } satisfies CommerceData,
    added: { orders: orders.length, refunds: refunds.length, operations: operations.length },
  };
}
