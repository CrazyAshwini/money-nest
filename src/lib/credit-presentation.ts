import Decimal from "decimal.js";
import { sumMoney } from "./finance";
import type { Money } from "./types";
import type { AccountUsage } from "./usage";

export interface CreditAvailabilityPresentation {
  amount: Money | null;
  status: "verified" | "estimated" | "unknown";
  label: string;
  note: string;
}

function isUsableAmount(value: Money | null): value is Money {
  if (value === null) return false;
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.gte(0);
  } catch {
    return false;
  }
}

/** Presentation only: never subtract a partial balance from a credit limit. */
export function getCreditAvailabilityPresentation(
  usage: AccountUsage,
): CreditAvailabilityPresentation {
  const label =
    usage.account.kind === "pay_later" ? "Available limit" : "Available credit";
  const estimatedLabel =
    usage.account.kind === "pay_later"
      ? "Estimated available limit"
      : "Estimated available credit";
  if (
    isUsableAmount(usage.availableCredit) &&
    usage.availableCreditStatus !== "unknown"
  ) {
    const status = usage.availableCreditStatus;
    return {
      amount: usage.availableCredit,
      status,
      label: status === "verified" ? label : estimatedLabel,
      note:
        status === "verified"
          ? "Verified from your saved availability report."
          : "Based on saved reports and posted movements. Issuer availability may differ.",
    };
  }
  if (
    usage.provenance !== "partial" &&
    isUsableAmount(usage.estimatedAvailableCredit)
  ) {
    return {
      amount: usage.estimatedAvailableCredit,
      status: "estimated",
      label: estimatedLabel,
      note: "Based on saved reports and posted movements. Issuer availability may differ.",
    };
  }
  return {
    amount: null,
    status: "unknown",
    label,
    note:
      usage.provenance === "partial"
        ? "Unpaid statements establish minimum known exposure, not total usage or available limit."
        : "Record available credit or add a limit and a complete balance report.",
  };
}

/** Sum only supported selector values, retaining missing/estimated coverage. */
export function getAggregateCreditAvailability(rows: readonly AccountUsage[]) {
  const values = rows.map(getCreditAvailabilityPresentation);
  const known = values.filter((value) => value.amount !== null);
  const count = rows.length;
  const knownCount = known.length;
  const verifiedCount = known.filter(
    (value) => value.status === "verified",
  ).length;
  const estimatedCount = known.filter(
    (value) => value.status === "estimated",
  ).length;
  const complete = count > 0 && knownCount === count;
  const status =
    knownCount === 0
      ? ("unknown" as const)
      : !complete
        ? ("partial" as const)
        : estimatedCount > 0
          ? ("estimated" as const)
          : ("verified" as const);
  const label =
    status === "partial"
      ? "Known available · partial"
      : status === "estimated"
        ? "Estimated available"
        : "Available";
  const note = count
    ? `${knownCount} of ${count} ${rows[0]?.account.kind === "pay_later" ? "providers" : "cards"} have supported availability.${estimatedCount ? ` Includes ${estimatedCount} estimate${estimatedCount === 1 ? "" : "s"}.` : ""}${!complete ? " Unknown availability is excluded, not treated as zero." : ""}`
    : "No credit accounts in this group yet.";
  return {
    amount: knownCount ? sumMoney(known.map((value) => value.amount)) : null,
    status,
    label,
    note,
    count,
    knownCount,
    verifiedCount,
    estimatedCount,
    complete,
  };
}

/** Outstanding is a separate selector value from utilization or bill-only exposure. */
export function getAggregateCreditOutstanding(rows: readonly AccountUsage[]) {
  const known = rows.filter((row) => row.currentOutstanding !== null);
  const count = rows.length;
  const knownCount = known.length;
  const estimatedCount = known.filter(
    (row) => row.balanceVerificationStatus !== "verified",
  ).length;
  const complete = count > 0 && knownCount === count;
  const status = !knownCount
    ? ("unknown" as const)
    : !complete
      ? ("partial" as const)
      : estimatedCount
        ? ("estimated" as const)
        : ("verified" as const);
  return {
    amount: knownCount
      ? sumMoney(known.map((row) => row.currentOutstanding))
      : null,
    label: status === "partial" ? "Known outstanding" : "Outstanding",
    status,
    count,
    knownCount,
    estimatedCount,
    complete,
  };
}
