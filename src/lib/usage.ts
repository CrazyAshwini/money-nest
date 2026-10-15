import Decimal from "decimal.js";
import {
  accountMovementsSinceSnapshot,
  billSummary,
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
  pendingAuthorizations: Money;
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
  if (availableSnapshot) {
    const movements = accountMovementsSinceSnapshot(data, accountId, availableSnapshot, asOf);
    available = Decimal.max(0, new Decimal(availableSnapshot.reportedAvailable!).minus(movements.change)).toFixed(2);
    if (!snapshot && signedUsed === null) {
      baselineAsOf = availableSnapshot.asOf;
      usageAsOf = movements.count > 0 ? cutoff : availableSnapshot.asOf;
      movementsSinceSnapshot = movements.count;
    }
  } else if (signedUsed !== null && limit !== null && new Decimal(limit).gt(0)) {
    available = Decimal.max(0, new Decimal(limit).minus(signedUsed)).toFixed(2);
  }

  // Order bills establish a minimum known exposure, not an account-wide balance.
  let unpaidBillsAmount: Money | null = null;
  let unpaidBillsCount = 0;
  if (account.kind === "pay_later" && used === null) {
    const cutoffData = {
      ...data,
      allocations: data.allocations.filter((allocation) =>
        data.transactions.some(
          (transaction) =>
            transaction.id === allocation.transactionId &&
            transaction.userId === account.userId &&
            transaction.occurredOn !== null &&
            transaction.occurredOn <= cutoff,
        ),
      ),
    };
    const unpaidBills = data.bills
      .filter(
        (bill) =>
          bill.accountId === account.id &&
          bill.userId === account.userId &&
          bill.statementDate <= cutoff,
      )
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

  // Bills & Statement info
  const accountBills = data.bills
    .filter((b) => b.accountId === account.id && b.statementDate <= cutoff)
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  const latestBill = accountBills[0];
  const statementGenerationDate = latestBill?.statementDate ?? null;
  const paymentDueDate = latestBill?.dueDate ?? null;
  const billedAmount = latestBill ? billSummary(data, latestBill, cutoff).remaining : null;

  // Breakdown of transactions
  let pendingAuthDec = new Decimal(0);
  let confirmedRepaymentsDec = new Decimal(0);
  let pendingRepaymentsDec = new Decimal(0);
  let confirmedRefundsDec = new Decimal(0);
  let unbilledPurchasesDec = new Decimal(0);
  let unbilledRefundsDec = new Decimal(0);

  const statementCutoff = latestBill?.statementDate ?? "";

  for (const txn of data.transactions) {
    if (txn.userId !== account.userId) continue;
    // Pending authorizations
    if (txn.fromAccountId === account.id && txn.status === "pending_review" && txn.kind === "expense") {
      pendingAuthDec = pendingAuthDec.plus(txn.amount);
    }
    // Confirmed repayments
    if (txn.toAccountId === account.id && txn.status === "posted" && ["bill_payment", "transfer"].includes(txn.kind)) {
      confirmedRepaymentsDec = confirmedRepaymentsDec.plus(txn.amount);
    }
    // Pending repayments
    if (txn.toAccountId === account.id && txn.status === "pending_review" && ["bill_payment", "transfer"].includes(txn.kind)) {
      pendingRepaymentsDec = pendingRepaymentsDec.plus(txn.amount);
    }
    // Confirmed refunds
    if (txn.toAccountId === account.id && txn.status === "posted" && txn.kind === "refund") {
      confirmedRefundsDec = confirmedRefundsDec.plus(txn.amount);
    }
    // Unbilled purchases / refunds (occurred after statement date through cutoff)
    if (txn.status === "posted" && txn.occurredOn && txn.occurredOn <= cutoff) {
      if (!statementCutoff || txn.occurredOn > statementCutoff) {
        if (txn.fromAccountId === account.id && txn.kind === "expense") {
          unbilledPurchasesDec = unbilledPurchasesDec.plus(txn.amount);
        }
        if (txn.toAccountId === account.id && txn.kind === "refund") {
          unbilledRefundsDec = unbilledRefundsDec.plus(txn.amount);
        }
      }
    }
  }

  const pendingAuthorizations = pendingAuthDec.toFixed(2);
  const confirmedRepayments = confirmedRepaymentsDec.toFixed(2);
  const pendingRepayments = pendingRepaymentsDec.toFixed(2);
  const confirmedRefunds = confirmedRefundsDec.toFixed(2);
  const netUnbilled = Decimal.max(0, unbilledPurchasesDec.minus(unbilledRefundsDec));
  const unbilledAmount = netUnbilled.toFixed(2);

  // Available credit and Estimated available credit:
  let availableCredit: Money | null = null;
  let estimatedAvailableCredit: Money | null = null;
  let availableCreditStatus: "verified" | "estimated" | "unknown" = "unknown";

  if (availableSnapshot && availableSnapshot.reportedAvailable != null) {
    availableCredit = available;
    availableCreditStatus = (movementsSinceSnapshot === 0 && availableSnapshot.asOf === cutoff) ? "verified" : "estimated";
    estimatedAvailableCredit = available;
  } else if (signedUsed !== null && limit !== null && new Decimal(limit).gt(0)) {
    const rawEst = Decimal.max(0, new Decimal(limit).minus(signedUsed).minus(pendingAuthorizations)).toFixed(2);
    availableCredit = rawEst;
    availableCreditStatus = (snapshot && snapshot.asOf === cutoff && movementsSinceSnapshot === 0) ? "verified" : "estimated";
    estimatedAvailableCredit = rawEst;
  } else if (provenance === "partial") {
    // Partial bill-only exposure (e.g. Meesho: ₹2,100 limit, ₹170 unpaid bill)
    // Actual available credit: Unknown until verified!
    availableCredit = null;
    availableCreditStatus = "unknown";
    if (limit !== null && new Decimal(limit).gt(0) && used !== null) {
      estimatedAvailableCredit = Decimal.max(0, new Decimal(limit).minus(used).minus(pendingAuthorizations)).toFixed(2);
    }
  } else {
    availableCredit = null;
    availableCreditStatus = "unknown";
    estimatedAvailableCredit = null;
  }

  // Balance verification status
  let balanceVerificationStatus: AccountUsage["balanceVerificationStatus"] = "unconfirmed";
  if (snapshot && snapshot.asOf === cutoff && movementsSinceSnapshot === 0) {
    balanceVerificationStatus = "verified";
  } else if (snapshot && movementsSinceSnapshot > 0) {
    balanceVerificationStatus = "estimated";
  } else if (provenance === "partial") {
    balanceVerificationStatus = "partial";
  } else if (isDebtAccount(account) && account.openingBalance != null) {
    balanceVerificationStatus = "estimated";
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
    issuerReportedOutstanding: nonnegativeMoney(snapshot?.reportedUtilized) ?? nonnegativeMoney(snapshot?.reportedOutstanding),
    ledgerCalculatedOutstanding: signedUsed !== null ? Decimal.max(0, signedUsed).toFixed(2) : null,
    currentOutstanding: used,
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
    lastReconciliationDate: snapshot?.asOf ?? baselineAsOf ?? null,
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
