import Decimal from "decimal.js";
import {
  accountBalance,
  accountMovementsSinceSnapshot,
  billSummary,
  compareSnapshotReports,
  isDebtAccount,
  latestSnapshot,
  ledgerBalance,
  localDateISO,
  sumMoney,
} from "./finance";
import type { Account, AccountSnapshot, Bill, Money, WorkspaceData } from "./types";

export type UsageBand = "smart" | "medium" | "high" | "unknown";

export const usageBandLabels: Record<UsageBand, string> = {
  smart: "Smart use",
  medium: "Medium use",
  high: "High use",
  unknown: "Usage unknown",
};

export function usageBand(percentage: number | null): UsageBand {
  if (percentage === null || !Number.isFinite(percentage)) return "unknown";
  if (percentage < 30) return "smart";
  if (percentage < 70) return "medium";
  return "high";
}

export interface AccountUsage {
  account: Account;
  used: Money | null;
  available: Money | null;
  limit: Money | null;
  percentage: number | null;
  progress: number;
  band: UsageBand;
  provenance: "reported" | "inferred" | "calculated" | "partial" | "unknown";
  asOf: string | null;
  baselineAsOf: string | null;
  movementsSinceSnapshot: number;
  snapshot?: AccountSnapshot;
  // Detailed financial calculation service fields (Part A1)
  totalCreditLimit: Money | null;
  issuerReportedOutstanding: Money | null;
  ledgerCalculatedOutstanding: Money | null;
  currentOutstanding: Money | null;
  billedAmount: Money | null;
  unbilledAmount: Money | null;
  /** Receipt review is not evidence of an issuer authorization or hold. */
  pendingAuthorizations: Money | null;
  confirmedRepayments: Money;
  pendingRepayments: Money;
  confirmedRefunds: Money;
  availableCredit: Money | null;
  estimatedAvailableCredit: Money | null;
  availableCreditStatus: "verified" | "estimated" | "unknown";
  creditUtilization: number | null;
  statementGenerationDate: string | null;
  paymentDueDate: string | null;
  lastReconciliationDate: string | null;
  balanceVerificationStatus: "verified" | "estimated" | "partial" | "unconfirmed";
  unpaidBillsAmount: Money | null;
  unpaidBillsCount: number;
  latestBill?: Bill;
}

export type CreditAccountSummary = AccountUsage;

/** Invalid or negative values cannot establish a usable credit limit or usage. */
function nonnegativeMoney(value: Money | null | undefined): Money | null {
  if (value == null) return null;
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.gte(0) ? amount.toFixed(2) : null;
  } catch {
    return null;
  }
}

function usageLevel(used: Money | null, limit: Money | null) {
  const percentage =
    used !== null && limit !== null && new Decimal(limit).gt(0)
      ? new Decimal(used).div(limit).times(100).toNumber()
      : null;
  return {
    percentage,
    progress: percentage === null ? 0 : Math.min(100, Math.max(0, percentage)),
    band: usageBand(percentage),
  };
}

/** Latest report that can establish account-wide usage without inventing a baseline. */
export function latestUsageSnapshot(
  data: WorkspaceData,
  accountId: string,
  asOf: string,
): AccountSnapshot | undefined {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account || !isDebtAccount(account)) return undefined;
  const limit = nonnegativeMoney(account.creditLimit);
  return latestSnapshot({
    ...data,
    snapshots: data.snapshots.filter((snapshot) => {
      if (nonnegativeMoney(snapshot.reportedUtilized) !== null ||
          nonnegativeMoney(snapshot.reportedOutstanding) !== null) return true;
      const available = nonnegativeMoney(snapshot.reportedAvailable);
      return limit !== null && new Decimal(limit).gt(0) &&
        available !== null && new Decimal(available).lte(limit);
    }),
  }, accountId, asOf);
}

/**
 * Single canonical credit calculation service for credit cards and Pay Later facilities.
 * Distinguishes reported, calculated, billed, unbilled, repayments, holds and availability.
 */
export function creditAccountSummary(
  data: WorkspaceData,
  accountId: string,
  asOf: string,
): CreditAccountSummary {
  return accountUsage(data, accountId, asOf);
}

/** Current usage and availability derived from confirmed reports or opening history. */
export function accountUsage(
  data: WorkspaceData,
  accountId: string,
  asOf: string,
): AccountUsage {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("Account not found.");
  const cutoff = localDateISO(asOf);
  const snapshot = latestUsageSnapshot(data, accountId, asOf);
  const limit = nonnegativeMoney(account.creditLimit);
  let signedUsed = nonnegativeMoney(snapshot?.reportedUtilized) ??
    nonnegativeMoney(snapshot?.reportedOutstanding);
  let provenance: AccountUsage["provenance"] =
    signedUsed !== null ? "reported" : "unknown";
  let usageAsOf = snapshot?.asOf ?? null;
  let baselineAsOf = snapshot?.asOf ?? null;
  let movementsSinceSnapshot = 0;
  const reportedAvailable = nonnegativeMoney(snapshot?.reportedAvailable);

  // Available credit is useful evidence only when it fits a confirmed limit.
  if (
    signedUsed === null &&
    limit !== null &&
    new Decimal(limit).gt(0) &&
    reportedAvailable !== null &&
    new Decimal(reportedAvailable).lte(limit)
  ) {
    signedUsed = new Decimal(limit).minus(reportedAvailable).toFixed(2);
    provenance = "inferred";
  }

  if (snapshot && signedUsed !== null) {
    const movements = accountMovementsSinceSnapshot(data, accountId, snapshot, asOf);
    signedUsed = new Decimal(signedUsed).plus(movements.change).toFixed(2);
    movementsSinceSnapshot = movements.count;
    if (movements.count > 0) {
      provenance = "calculated";
      usageAsOf = cutoff;
    }
  } else if (isDebtAccount(account)) {
    signedUsed = ledgerBalance(data, accountId, asOf);
    if (signedUsed !== null) {
      provenance = "calculated";
      usageAsOf = cutoff;
      baselineAsOf = account.openingBalanceDate ?? null;
    }
  }
  // Keep the signed sum through every repayment and later purchase. Clamping
  // each event separately would lose an overpayment's remaining credit.
  let used = signedUsed === null ? null : Decimal.max(0, signedUsed).toFixed(2);
  const availableSnapshot = isDebtAccount(account) ? latestSnapshot({
    ...data,
    snapshots: data.snapshots.filter((row) => nonnegativeMoney(row.reportedAvailable) !== null),
  }, accountId, asOf) : undefined;
  let available: Money | null = null;
  // An older availability report cannot override a newer account-wide usage
  // report. On the same report, retain the issuer's explicit availability.
  const useAvailableReport = availableSnapshot &&
    (!snapshot || compareSnapshotReports(availableSnapshot, snapshot) >= 0);
  let availableMovements = 0;
  if (useAvailableReport) {
    const movements = accountMovementsSinceSnapshot(data, accountId, availableSnapshot, asOf);
    available = Decimal.max(0, new Decimal(availableSnapshot.reportedAvailable!).minus(movements.change)).toFixed(2);
    availableMovements = movements.count;
    if (!snapshot && signedUsed === null) {
      baselineAsOf = availableSnapshot.asOf;
      usageAsOf = movements.count > 0 ? cutoff : availableSnapshot.asOf;
      movementsSinceSnapshot = movements.count;
    }
  } else if (signedUsed !== null && limit !== null && new Decimal(limit).gt(0)) {
    available = Decimal.max(0, new Decimal(limit).minus(signedUsed)).toFixed(2);
  }

  const cutoffData = {
    ...data,
    allocations: data.allocations.filter((allocation) =>
      data.transactions.some((transaction) =>
        transaction.id === allocation.transactionId &&
        transaction.userId === account.userId &&
        transaction.occurredOn !== null && transaction.occurredOn <= cutoff,
      ),
    ),
  };
  const accountBills = data.bills
    .filter((bill) => bill.accountId === account.id &&
      bill.userId === account.userId && bill.statementDate <= cutoff)
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || b.id.localeCompare(a.id));

  // Order bills establish a minimum known exposure, not an account-wide balance.
  let unpaidBillsAmount: Money | null = null;
  let unpaidBillsCount = 0;
  if (account.kind === "pay_later" && used === null) {
    const unpaidBills = accountBills
      .map((bill) => ({
        bill,
        remaining: billSummary(cutoffData, bill.id, cutoff).remaining,
      }))
      .filter(({ remaining }) => new Decimal(remaining).gt(0));
    unpaidBillsCount = unpaidBills.length;
    if (unpaidBills.length > 0) {
      unpaidBillsAmount = sumMoney(unpaidBills.map(({ remaining }) => remaining));
      used = unpaidBillsAmount;
      provenance = "partial";
      usageAsOf = unpaidBills
        .map(({ bill }) => bill.statementDate)
        .sort()
        .at(-1)!;
    }
  }

  // A statement is separate from account-wide utilization and outstanding.
  const latestBill = accountBills[0];
  const statementGenerationDate = latestSnapshot({
    ...data,
    snapshots: data.snapshots.filter((row) => row.nextStatementDate != null),
  }, accountId, asOf)?.nextStatementDate ?? null;
  const paymentDueDate = latestBill?.dueDate ?? null;
  const billedAmount = latestBill ? billSummary(cutoffData, latestBill, cutoff).remaining : null;

  // These are recorded, dated payments through the cutoff. Pending receipt
  // review does not establish that the issuer reserved any available credit.
  let confirmedRepaymentsDec = new Decimal(0);
  let pendingRepaymentsDec = new Decimal(0);
  let confirmedRefundsDec = new Decimal(0);

  for (const txn of data.transactions) {
    if (txn.userId !== account.userId || !txn.occurredOn || txn.occurredOn > cutoff)
      continue;
    const source = data.accounts.find((row) => row.id === txn.fromAccountId && row.userId === account.userId);
    const repayment = txn.toAccountId === account.id &&
      source && ["bank", "wallet"].includes(source.kind) &&
      ["bill_payment", "transfer"].includes(txn.kind);
    if (repayment && txn.status === "posted") {
      confirmedRepaymentsDec = confirmedRepaymentsDec.plus(txn.amount);
    }
    if (repayment && txn.status === "pending_review") {
      pendingRepaymentsDec = pendingRepaymentsDec.plus(txn.amount);
    }
    if (txn.toAccountId === account.id && txn.status === "posted" && txn.kind === "refund") {
      confirmedRefundsDec = confirmedRefundsDec.plus(txn.amount);
    }
  }

  const pendingAuthorizations = null;
  const confirmedRepayments = confirmedRepaymentsDec.toFixed(2);
  const pendingRepayments = pendingRepaymentsDec.toFixed(2);
  const confirmedRefunds = confirmedRefundsDec.toFixed(2);
  // The data model records issuer unbilled amounts but cannot tell whether a
  // subsequent payment/refund was applied to billed or unbilled debt. Preserve
  // the reported amount only while no later movement makes that split unknown.
  const unbilledSnapshot = isDebtAccount(account) ? latestSnapshot({
    ...data,
    snapshots: data.snapshots.filter((row) => nonnegativeMoney(row.reportedUnbilled) !== null),
  }, accountId, asOf) : undefined;
  const unbilledAmount = unbilledSnapshot &&
    accountMovementsSinceSnapshot(data, accountId, unbilledSnapshot, asOf).count === 0
    ? nonnegativeMoney(unbilledSnapshot.reportedUnbilled) : null;

  const availableCredit = available;
  const estimatedAvailableCredit = available ?? (
    provenance === "partial" && used !== null && limit !== null && new Decimal(limit).gt(0)
      ? Decimal.max(0, new Decimal(limit).minus(used)).toFixed(2) : null
  );
  const availableCreditStatus: AccountUsage["availableCreditStatus"] = available === null
    ? "unknown"
    : useAvailableReport && availableSnapshot.verifiedByUser &&
        localDateISO(availableSnapshot.asOf) === cutoff && availableMovements === 0
      ? "verified" : "estimated";

  const outstandingSnapshot = isDebtAccount(account) ? latestSnapshot({
    ...data,
    snapshots: data.snapshots.filter((row) => nonnegativeMoney(row.reportedOutstanding) !== null),
  }, accountId, asOf) : undefined;
  const outstanding = isDebtAccount(account) ? accountBalance(data, accountId, asOf) : null;
  const currentOutstanding = outstanding?.current == null
    ? null : Decimal.max(0, outstanding.current).toFixed(2);
  let balanceVerificationStatus: AccountUsage["balanceVerificationStatus"] = "unconfirmed";
  if (provenance === "partial") {
    balanceVerificationStatus = "partial";
  } else if (currentOutstanding !== null) {
    balanceVerificationStatus = outstandingSnapshot?.verifiedByUser &&
      localDateISO(outstandingSnapshot.asOf) === cutoff && outstanding?.movementsSinceSnapshot === 0
      ? "verified" : "estimated";
  }

  // Usage level & progress (never render misleading progress for partial/unknown)
  const level = usageLevel(provenance === "partial" ? null : used, limit);

  return {
    account,
    used,
    available,
    limit,
    ...level,
    provenance,
    asOf: usageAsOf,
    baselineAsOf,
    movementsSinceSnapshot,
    snapshot: snapshot ?? availableSnapshot,
    totalCreditLimit: limit,
    issuerReportedOutstanding: nonnegativeMoney(outstandingSnapshot?.reportedOutstanding),
    ledgerCalculatedOutstanding: currentOutstanding,
    currentOutstanding,
    billedAmount,
    unbilledAmount,
    pendingAuthorizations,
    confirmedRepayments,
    pendingRepayments,
    confirmedRefunds,
    availableCredit,
    estimatedAvailableCredit,
    availableCreditStatus,
    creditUtilization: level.percentage,
    statementGenerationDate,
    paymentDueDate,
    lastReconciliationDate: outstandingSnapshot?.asOf ?? null,
    balanceVerificationStatus,
    unpaidBillsAmount,
    unpaidBillsCount,
    latestBill,
  };
}

export interface UsageSummary {
  rows: AccountUsage[];
  usedTotal: Money;
  limitTotal: Money;
  percentage: number | null;
  progress: number;
  band: UsageBand;
  complete: boolean;
  knownUsageCount: number;
  knownLimitCount: number;
  count: number;
}

export function usageSummary(
  data: WorkspaceData,
  kind: "credit_card" | "pay_later",
  asOf: string,
): UsageSummary {
  const rows = data.accounts
    .filter((account) => account.active && account.kind === kind)
    .map((account) => accountUsage(data, account.id, asOf));
  const count = rows.length;
  const knownUsageCount = rows.filter((row) => row.used !== null).length;
  const knownLimitCount = rows.filter(
    (row) => row.limit !== null && new Decimal(row.limit).gt(0),
  ).length;
  const usedTotal = sumMoney(rows.map((row) => row.used));
  const limitTotal = sumMoney(rows.map((row) => row.limit));
  const complete =
    count > 0 &&
    knownUsageCount === count &&
    knownLimitCount === count &&
    rows.every((row) => ["reported", "inferred", "calculated"].includes(row.provenance));

  return {
    rows,
    usedTotal,
    limitTotal,
    ...usageLevel(complete ? usedTotal : null, complete ? limitTotal : null),
    complete,
    knownUsageCount,
    knownLimitCount,
    count,
  };
}
