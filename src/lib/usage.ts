import Decimal from "decimal.js";
import { billSummary, latestSnapshot, localDateISO, sumMoney } from "./finance";
import type { Account, Money, WorkspaceData } from "./types";

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
  limit: Money | null;
  percentage: number | null;
  progress: number;
  band: UsageBand;
  provenance: "reported" | "inferred" | "partial" | "unknown";
  asOf: string | null;
}

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

/** Use the owner's latest report at the cutoff, never a guessed ledger balance. */
export function accountUsage(
  data: WorkspaceData,
  accountId: string,
  asOf: string,
): AccountUsage {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("Account not found.");
  const snapshot = latestSnapshot(data, accountId, asOf);
  const limit = nonnegativeMoney(account.creditLimit);
  let used = nonnegativeMoney(
    snapshot?.reportedUtilized ?? snapshot?.reportedOutstanding,
  );
  let provenance: AccountUsage["provenance"] =
    used !== null ? "reported" : "unknown";
  let usageAsOf = snapshot?.asOf ?? null;
  const available = nonnegativeMoney(snapshot?.reportedAvailable);

  // Available credit is useful evidence only when it fits a confirmed limit.
  if (
    used === null &&
    limit !== null &&
    new Decimal(limit).gt(0) &&
    available !== null &&
    new Decimal(available).lte(limit)
  ) {
    used = new Decimal(limit).minus(available).toFixed(2);
    provenance = "inferred";
  }

  // Order bills establish a minimum known exposure, not an account-wide balance.
  if (account.kind === "pay_later" && used === null) {
    const cutoff = localDateISO(asOf);
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
    if (unpaidBills.length > 0) {
      used = sumMoney(unpaidBills.map(({ remaining }) => remaining));
      provenance = "partial";
      usageAsOf = unpaidBills
        .map(({ bill }) => bill.statementDate)
        .sort()
        .at(-1)!;
    }
  }

  return {
    account,
    used,
    limit,
    ...usageLevel(provenance === "partial" ? null : used, limit),
    provenance,
    asOf: usageAsOf,
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
    rows.every((row) => ["reported", "inferred"].includes(row.provenance));

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
