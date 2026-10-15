import { isDebtAccount, localDateISO } from "./finance";
import type { Transaction, WorkspaceData } from "./types";

type TransactionSide = "from" | "to";
type PaymentAccounts = Pick<
  Transaction,
  "userId" | "fromAccountId" | "toAccountId" | "occurredOn"
>;

/** Keep historical confirmations unless an owner changes their treatment. */
export function balanceSnapshotIdForEdit(
  data: WorkspaceData,
  previous: Transaction | undefined,
  next: PaymentAccounts,
  side: TransactionSide,
  choice?: { snapshotId: string; included: boolean },
): string | null {
  const accountId = next[`${side}AccountId`];
  const previousMatches = previous?.userId === next.userId &&
    previous[`${side}AccountId`] === accountId &&
    previous.occurredOn === next.occurredOn;
  const snapshotId = choice
    ? choice.included ? null : choice.snapshotId
    : previousMatches ? previous[`${side}BalanceSnapshotId`] : null;
  if (!snapshotId || !accountId || !next.occurredOn) return null;

  const account = data.accounts.find(
    (row) => row.id === accountId && row.userId === next.userId,
  );
  const snapshot = data.snapshots.find(
    (row) => row.id === snapshotId && row.userId === next.userId &&
      row.accountId === accountId,
  );
  if (!account || !snapshot || localDateISO(snapshot.asOf) !== next.occurredOn)
    return null;
  const supportsMovement = isDebtAccount(account)
    ? [snapshot.reportedOutstanding, snapshot.reportedUtilized, snapshot.reportedAvailable]
      .some((value) => value != null)
    : snapshot.reportedBalance != null;
  return supportsMovement ? snapshotId : null;
}
