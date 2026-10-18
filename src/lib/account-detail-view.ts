import {
  accountBalance,
  billSummary,
  compareMoney,
  isDebtAccount,
  latestBalanceSnapshot,
  latestSnapshot,
  localDateISO,
  sumMoney,
  type AccountBalance,
  type BillSummary,
} from "./finance";
import { accountUsage, type AccountUsage } from "./usage";
import { getRecentAccountTransactions } from "./account-presentation";
import type { Account, AccountSnapshot, Bill, Money, Transaction, WorkspaceData } from "./types";

export interface AccountDetailView {
  account: Account;
  balance: AccountBalance;
  snapshot: AccountSnapshot | undefined;
  usage: AccountUsage | null;
  /** Recorded account movements, not income or spending totals. */
  monthly: { credits: Money; debits: Money; count: number };
  recent: Transaction[];
  statements: { bill: Bill; summary: BillSummary }[];
  /** Recorded bill dues do not establish the facility's full outstanding balance. */
  dues: {
    amount: Money | null;
    nextDueDate: string | null;
    hasUnknownDate: boolean;
    unpaidCount: number;
  };
}

/** Read-only presentation selection; balance and debt arithmetic stay in domain helpers. */
export function accountDetailView(
  data: WorkspaceData,
  account: Account,
  month: string,
  today: string,
): AccountDetailView {
  const selected = data.accounts.find((row) => row.id === account.id && row.userId === account.userId);
  if (!selected) throw new Error("Account not found in this workspace.");
  const cutoff = localDateISO(today);
  const owned = <T extends { userId: string }>(rows: T[]) => rows.filter((row) => row.userId === selected.userId);
  const workspace = {
    ...data,
    accounts: owned(data.accounts),
    snapshots: owned(data.snapshots),
    transactions: owned(data.transactions),
    bills: owned(data.bills),
    allocations: owned(data.allocations),
    emiAllocations: owned(data.emiAllocations),
  };
  const related = workspace.transactions.filter((transaction) =>
    (transaction.fromAccountId === selected.id || transaction.toAccountId === selected.id) &&
    (!transaction.occurredOn || transaction.occurredOn <= cutoff),
  );
  const monthly = related.filter((transaction) =>
    transaction.status === "posted" &&
    transaction.occurredOn?.startsWith(`${month}-`) &&
    transaction.fromAccountId !== transaction.toAccountId,
  );
  const recent = getRecentAccountTransactions(workspace, selected.id, 5, cutoff);
  // Keep provisional allocations visible in statement summaries, while only
  // dated, posted, verified payments can reduce remaining dues via billSummary.
  const cutoffWorkspace = {
    ...workspace,
    allocations: workspace.allocations.filter((allocation) =>
      workspace.transactions.some((transaction) =>
        transaction.id === allocation.transactionId &&
        transaction.occurredOn !== null && transaction.occurredOn <= cutoff,
      ),
    ),
  };
  const statements = workspace.bills
    .filter((bill) => bill.accountId === selected.id && bill.statementDate <= cutoff)
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || a.id.localeCompare(b.id))
    .map((bill) => ({ bill, summary: billSummary(cutoffWorkspace, bill, cutoff) }));
  const unpaid = statements.filter(({ summary }) => compareMoney(summary.remaining, "0") > 0);
  const dueDates = unpaid.map(({ bill }) => bill.dueDate).filter((value): value is string => value !== null).sort();
  return {
    account: selected,
    balance: accountBalance(workspace, selected.id, cutoff),
    snapshot: isDebtAccount(selected)
      ? latestSnapshot(workspace, selected.id, cutoff)
      : latestBalanceSnapshot(workspace, selected.id, cutoff),
    usage: isDebtAccount(selected) ? accountUsage(workspace, selected.id, cutoff) : null,
    monthly: {
      credits: sumMoney(monthly.filter((transaction) => transaction.toAccountId === selected.id).map((transaction) => transaction.amount)),
      debits: sumMoney(monthly.filter((transaction) => transaction.fromAccountId === selected.id).map((transaction) => transaction.amount)),
      count: monthly.length,
    },
    recent,
    statements,
    dues: {
      amount: statements.length ? sumMoney(unpaid.map(({ summary }) => summary.remaining)) : null,
      nextDueDate: dueDates[0] ?? null,
      hasUnknownDate: unpaid.some(({ bill }) => bill.dueDate === null),
      unpaidCount: unpaid.length,
    },
  };
}
