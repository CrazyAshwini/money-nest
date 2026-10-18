import type { Account, Transaction, WorkspaceData } from "./types";

/** Selection belongs to the account ID, so reordering cannot change its records. */
export function resolveSelectedAccountId(
  accounts: readonly Pick<Account, "id">[],
  selectedId: string | null | undefined,
): string | null {
  return (
    accounts.find((account) => account.id === selectedId)?.id ??
    accounts[0]?.id ??
    null
  );
}

/** Never expose more than the model's final four identifier characters. */
export function maskedAccountSuffix(value: string | null | undefined): string {
  const suffix = value?.trim().slice(-4);
  return suffix ? `••${suffix}` : "Identifier not available";
}

export function accountHistoryHref(accountId: string): string {
  return `/transactions?${new URLSearchParams({ account: accountId, period: "all" })}`;
}

/** A read-only ledger preview, ordered by transaction date, never posting order. */
export function getRecentAccountTransactions(
  data: Pick<WorkspaceData, "accounts" | "transactions">,
  accountId: string,
  limit: 3 | 4 | 5 = 4,
): Transaction[] {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account) return [];
  return data.transactions
    .filter(
      (transaction) =>
        transaction.userId === account.userId &&
        (transaction.fromAccountId === accountId ||
          transaction.toAccountId === accountId),
    )
    .sort(
      (a, b) =>
        (b.occurredOn ?? "").localeCompare(a.occurredOn ?? "") ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** Direction describes recorded account links, not a new spending classification. */
export function accountTransactionDirection(
  transaction: Pick<Transaction, "fromAccountId" | "toAccountId">,
  accountId: string,
): "incoming" | "outgoing" | "internal" {
  const from = transaction.fromAccountId === accountId;
  const to = transaction.toAccountId === accountId;
  return from && to ? "internal" : from ? "outgoing" : "incoming";
}
