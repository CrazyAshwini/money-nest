import Decimal from "decimal.js";
import type {
  Account,
  EmiInstallment,
  Money,
  WorkspaceData,
  WorkspaceDataWithEmi,
} from "./types";
import { localDateISO, todayISO } from "./finance";

/**
 * Amazon Pay Later confirmed monthly billing schedule:
 * - Bill generation: 1st of every month
 * - Payment deadline: 5th of every month
 * - Timezone: Asia/Kolkata
 */
export function getAmazonPayLaterBillingSchedule(asOf = todayISO()) {
  const cutoff = localDateISO(asOf);
  const year = Number(cutoff.slice(0, 4));
  const month = Number(cutoff.slice(5, 7)); // 1-12
  const day = Number(cutoff.slice(8, 10));

  // Current cycle statement & due date
  const currentStatementDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const currentDueDate = `${year}-${String(month).padStart(2, "0")}-05`;

  // Next cycle statement & due date
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const nextStatementDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const nextDueDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-05`;

  return {
    billingDay: 1,
    dueDay: 5,
    timezone: "Asia/Kolkata",
    currentStatementDate,
    currentDueDate,
    nextStatementDate,
    nextDueDate,
    isAfterCurrentDueDate: day > 5,
  };
}

/**
 * Creates installment-level schedule with exact decimal arithmetic down to the paise.
 */
export function generateEmiSchedule(params: {
  agreementId: string;
  userId: string;
  financedPrincipal: Money;
  annualInterestRate?: string | null;
  durationMonths: number;
  monthlyEmi: Money;
  processingFee?: Money;
  firstBillingDate: string;
  firstDueDate: string;
}): EmiInstallment[] {
  const {
    agreementId,
    userId,
    financedPrincipal,
    durationMonths,
    monthlyEmi,
    processingFee = "0.00",
    firstBillingDate,
  } = params;

  const installments: EmiInstallment[] = [];
  const monthlyEmiDec = new Decimal(monthlyEmi);
  const totalPrincipalDec = new Decimal(financedPrincipal);
  let remainingPrincipal = totalPrincipalDec;

  // Approximate or exact monthly interest breakdown
  // Total payable principal = financedPrincipal
  // Total payable installment sum = monthlyEmi * durationMonths
  const totalScheduledSum = monthlyEmiDec.times(durationMonths);
  const totalInterestDec = Decimal.max(0, totalScheduledSum.minus(totalPrincipalDec));
  const avgMonthlyInterest = totalInterestDec.div(durationMonths);

  let startYear = Number(firstBillingDate.slice(0, 4));
  let startMonth = Number(firstBillingDate.slice(5, 7));

  for (let i = 1; i <= durationMonths; i++) {
    const curYear = startYear;
    const curMonth = startMonth;
    const billingDate = `${curYear}-${String(curMonth).padStart(2, "0")}-01`;
    const dueDate = `${curYear}-${String(curMonth).padStart(2, "0")}-05`;

    let interestComp: Decimal;
    let principalComp: Decimal;

    if (i === durationMonths) {
      // Last installment reconciles exact remaining principal
      principalComp = remainingPrincipal;
      interestComp = Decimal.max(0, monthlyEmiDec.minus(principalComp));
    } else {
      interestComp = avgMonthlyInterest.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      principalComp = monthlyEmiDec.minus(interestComp);
      remainingPrincipal = remainingPrincipal.minus(principalComp);
    }

    const feeComp = i === 1 ? new Decimal(processingFee) : new Decimal(0);

    installments.push({
      id: `${agreementId}-inst-${i}`,
      userId,
      agreementId,
      installmentNumber: i,
      billingDate,
      dueDate,
      principalComponent: principalComp.toFixed(2),
      interestComponent: interestComp.toFixed(2),
      feeComponent: feeComp.toFixed(2),
      totalDue: monthlyEmiDec.toFixed(2),
      amountPaid: "0.00",
      principalRepaid: "0.00",
      status: "upcoming",
    });

    startMonth += 1;
    if (startMonth > 12) {
      startMonth = 1;
      startYear += 1;
    }
  }

  return installments;
}

/**
 * Calculates core EMI and principal-based credit usage metrics for an account.
 * CRITICAL RULE: Only financed principal consumes available credit upfront!
 * Future interest and future repayment installments do NOT consume credit limit upfront.
 */
export function calculateEmiAccountMetrics(
  data: WorkspaceData | WorkspaceDataWithEmi,
  account: Account,
  asOf = todayISO(),
) {
  const cutoff = localDateISO(asOf);
  const agreements = ("emiAgreements" in data && Array.isArray((data as WorkspaceDataWithEmi).emiAgreements)
    ? (data as WorkspaceDataWithEmi).emiAgreements!
    : []).filter(
    (a) => a.accountId === account.id && a.userId === account.userId && a.status === "active",
  );

  const limit = account.creditLimit ? new Decimal(account.creditLimit) : null;

  let totalFinancedPrincipal = new Decimal(0);
  let totalPrincipalRepaid = new Decimal(0);
  let totalScheduledInterest = new Decimal(0);
  let totalInterestBilled = new Decimal(0);
  let totalInterestPaid = new Decimal(0);
  let totalProcessingFees = new Decimal(0);
  let totalFeesBilled = new Decimal(0);
  let totalFeesPaid = new Decimal(0);
  let totalScheduledRepayments = new Decimal(0);

  for (const ag of agreements) {
    if (ag.purchaseDate && ag.purchaseDate > cutoff) continue;
    totalFinancedPrincipal = totalFinancedPrincipal.plus(ag.financedPrincipal);
    totalPrincipalRepaid = totalPrincipalRepaid.plus(ag.principalRepaid || "0.00");
    totalScheduledInterest = totalScheduledInterest.plus(ag.totalScheduledInterest || "0.00");
    totalInterestBilled = totalInterestBilled.plus(ag.interestBilled || "0.00");
    totalInterestPaid = totalInterestPaid.plus(ag.interestPaid || "0.00");
    totalProcessingFees = totalProcessingFees.plus(ag.processingFee || "0.00");
    totalFeesBilled = totalFeesBilled.plus(ag.feesBilled || "0.00");
    totalFeesPaid = totalFeesPaid.plus(ag.feesPaid || "0.00");
    totalScheduledRepayments = totalScheduledRepayments.plus(ag.totalScheduledRepayment || "0.00");
  }

  const principalOutstanding = Decimal.max(0, totalFinancedPrincipal.minus(totalPrincipalRepaid));
  const unbilledFutureInterest = Decimal.max(0, totalScheduledInterest.minus(totalInterestBilled));

  // ONLY principal outstanding consumes credit limit
  const principalConsumingCredit = principalOutstanding;

  const availableCredit = limit !== null
    ? Decimal.max(0, limit.minus(principalConsumingCredit)).toFixed(2)
    : null;

  const creditUtilization = limit !== null && limit.gt(0)
    ? principalConsumingCredit.div(limit).times(100).toNumber()
    : null;

  return {
    activeAgreementsCount: agreements.length,
    agreements,
    financedPrincipal: totalFinancedPrincipal.toFixed(2),
    principalRepaid: totalPrincipalRepaid.toFixed(2),
    principalOutstanding: principalOutstanding.toFixed(2),
    unbilledFutureInterest: unbilledFutureInterest.toFixed(2),
    processingFees: totalProcessingFees.toFixed(2),
    billedPrincipal: "0.00",
    billedInterest: totalInterestBilled.toFixed(2),
    totalScheduledRepayments: totalScheduledRepayments.toFixed(2),
    principalConsumingCredit: principalConsumingCredit.toFixed(2),
    availableCredit,
    creditUtilization,
  };
}
