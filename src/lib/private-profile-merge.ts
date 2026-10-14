import type { CommerceData } from "./commerce";
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
  const seenIncomingSources = new Set<string>();
  for (const row of incoming.transactions) {
    const key = sourceKey(row.sourceSystem, row.sourceObjectId);
    if (key && seenIncomingSources.has(key))
      throw new Error("The transfer contains duplicate transaction sources.");
    if (key) seenIncomingSources.add(key);
    const matchedId = existingTransactionsById.get(row.id)?.id ?? (key ? existingTransactionsBySource.get(key) : undefined);
    if (matchedId) transactionIds.set(row.id, matchedId);
    else transactionIds.set(row.id, row.id);
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
) {
  const currentOrderIds = new Set(current.orders.map((row) => row.id));
  const currentOrderFingerprints = new Set(current.orders.flatMap((row) => row.sourceFingerprint ? [row.sourceFingerprint] : []));
  const orders = [] as CommerceData["orders"];
  for (const source of incoming.orders) {
    const row = {
      ...source,
      userId: ownerId,
      payments: source.payments.map((payment) => ({
        ...payment,
        transactionId: transactionIds.get(payment.transactionId) ?? payment.transactionId,
      })),
    };
    if (currentOrderIds.has(row.id) || (row.sourceFingerprint && currentOrderFingerprints.has(row.sourceFingerprint))) continue;
    orders.push(row);
    currentOrderIds.add(row.id);
    if (row.sourceFingerprint) currentOrderFingerprints.add(row.sourceFingerprint);
  }
  const currentRefundIds = new Set(current.refunds.map((row) => row.id));
  const refunds = [] as CommerceData["refunds"];
  for (const source of incoming.refunds) {
    const row = {
      ...source,
      userId: ownerId,
      originalTransactionId: source.originalTransactionId
        ? transactionIds.get(source.originalTransactionId) ?? source.originalTransactionId
        : null,
      creditMatches: source.creditMatches.map((match) => ({
        ...match,
        transactionId: transactionIds.get(match.transactionId) ?? match.transactionId,
      })),
    };
    if (currentRefundIds.has(row.id)) continue;
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
