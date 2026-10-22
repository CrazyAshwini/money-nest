import Decimal from "decimal.js";
import type {
  Account,
  AccountSnapshot,
  EmiAgreement,
  EmiInstallment,
  Money,
  Transaction,
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
 * Confirmed Samsung 43-inch TV + 2 items Amazon Pay Later purchase details.
 */
export const SAMSUNG_TV_EMI_SPEC = {
  purchaseDate: "2026-10-18",
  purchaseTime: "19:20:00",
  platform: "Amazon",
  paymentMethod: "Amazon Pay Later Installments",
  description: "Samsung 43-inch television plus two additional items",
  orderIds: [
    "406-2479955-3587539",
    "406-6855707-5582708",
    "406-0628731-9190704",
  ],
  paidUsingAmazonPayLater: "33108.29",
  displayedDiscount: "2589.21",
  effectivePurchaseValue: "30509.79", // Candidate financed principal
  annualInterestRate: "20.00",
  interestAmount: "2598.50",
  processingFee: "360.02",
  totalPayable: "33468.31",
  monthlyEmi: "3678.70",
  durationMonths: 9,
  firstBillingDate: "2026-11-01",
  firstDueDate: "2026-11-05",
};

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
 * Searches for the existing DAWNTECH transaction and verifies relationship to Samsung order.
 * User confirmed: DAWNTECH ₹32,990.00 is a duplicate of the Samsung TV EMI purchase (retail cart value)
 * and has been removed from active transactions to prevent double counting.
 */
export function investigateDawntechTransaction(data: WorkspaceData) {
  const dawntechTx = data.transactions.find(
    (t) =>
      (t.merchant?.toLowerCase().includes("dawntech") ||
        t.description.toLowerCase().includes("dawntech")) &&
      t.amount === "32990.00" &&
      t.occurredOn === "2026-10-18",
  );

  if (!dawntechTx) {
    return {
      found: false,
      transaction: null,
      notes: "DAWNTECH transaction of ₹32,990.00 on 18 Oct 2026 was confirmed by user as duplicate of Samsung TV EMI purchase and removed.",
      isCandidateMatch: false,
      isRemovedDuplicate: true,
    };
  }

  return {
    found: true,
    transaction: dawntechTx,
    notes:
      "DAWNTECH transaction of ₹32,990.00 on 18 Oct 2026 confirmed by user as duplicate of Samsung TV EMI purchase.",
    isCandidateMatch: false,
    isRemovedDuplicate: true,
  };
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

export interface AmazonPayLaterHistoricalTx {
  date: string | null;
  description: string;
  amount: Money;
  type: "expense" | "refund" | "repayment" | "snapshot" | "candidate";
  verified: boolean;
  notes: string;
  externalReference?: string;
  orderIds?: string[];
}

/**
 * Confirmed canonical historical transactions and candidates for Amazon Pay Later.
 */
export const AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS: AmazonPayLaterHistoricalTx[] = [
  {
    date: "2026-10-01",
    description: "Amazon purchase (reflected in checkpoint snapshot)",
    amount: "1000.00",
    type: "expense",
    verified: true,
    notes: "Pre-checkpoint purchase already reflected in the ₹3,182.68 snapshot; not replayed after checkpoint.",
  },
  {
    date: "2026-10-05",
    description: "Amazon Pay Later Balance Checkpoint Snapshot",
    amount: "3182.68",
    type: "snapshot",
    verified: true,
    notes: "Provider-reported outstanding checkpoint as of 05 Oct 2026.",
  },
  {
    date: "2026-10-07",
    description: "Amazon refund (posted after checkpoint)",
    amount: "380.00",
    type: "refund",
    verified: true,
    notes: "Confirmed refund reducing Amazon Pay Later liability without treating as income.",
  },
  {
    date: "2026-10-13",
    description: "POND'S Gel refund",
    amount: "353.00",
    type: "refund",
    verified: true,
    notes: "Confirmed product refund reducing Pay Later liability without treating as income.",
  },
  {
    date: "2026-10-18",
    description: "Samsung 43-inch television plus two additional items",
    amount: "30509.79",
    type: "expense",
    verified: true,
    notes: "9-month EMI agreement @ 20% p.a. (₹3,678.70/mo). Only financed principal consumes limit upfront.",
    orderIds: [
      "406-2479955-3587539",
      "406-6855707-5582708",
      "406-0628731-9190704",
    ],
  },
  {
    date: null,
    description: "Amazon Pay Later statement repayment",
    amount: "6954.15",
    type: "repayment",
    verified: false,
    notes: "Provider screenshot repayment; awaiting funding bank account and confirmed posting date.",
  },
];

/**
 * Reconciles Amazon Pay Later against provider-reported snapshot.
 */
export function reconcileAmazonPayLater(data: WorkspaceData | WorkspaceDataWithEmi, asOf = todayISO()) {
  const account = data.accounts.find(
    (a) => a.kind === "pay_later" && a.name.toLowerCase().includes("amazon"),
  );

  const approvedLimit = "35000.00";
  const providerReportedOutstanding = "34808.60";
  const providerReportedUnbilled = "35418.52";
  const legacyEstimatedOutstanding = "37073.68";

  // Discrepancy between legacy MoneyNest calculation and provider report
  // ₹37,073.68 - ₹34,808.60 = ₹2,265.08
  const discrepancy = new Decimal(legacyEstimatedOutstanding)
    .minus(providerReportedOutstanding)
    .toFixed(2);

  const emiMetrics = account
    ? calculateEmiAccountMetrics(data, account, asOf)
    : null;

  const datedTransactions = AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS.filter(
    (t) => t.date !== null && t.type !== "candidate",
  );

  const candidateOrPendingTransactions = AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS.filter(
    (t) => t.date === null || t.type === "candidate",
  );

  return {
    accountFound: Boolean(account),
    approvedLimit,
    providerReportedOutstanding,
    providerReportedUnbilled,
    legacyEstimatedOutstanding,
    discrepancy,
    reconciliationStatus: "difference_detected" as const,
    rootCauseExplanation:
      "Legacy MoneyNest calculations added projected future scheduled EMI interest upfront into the outstanding liability and deducted it from available credit. Under Amazon Pay Later accounting, only financed principal consumes available credit, while future interest is unbilled and recognized only upon monthly statement generation.",
    schedule: getAmazonPayLaterBillingSchedule(asOf),
    emiMetrics,
    datedTransactions,
    candidateOrPendingTransactions,
    allHistoricalTransactions: AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS,
  };
}

/**
 * Idempotently attaches Amazon Pay Later transactions, snapshots, and EMI agreement
 * to a workspace without creating duplicates or overwriting existing user data.
 */
export function attachAmazonPayLaterTransactions<T extends WorkspaceData | WorkspaceDataWithEmi>(
  workspace: T,
  targetAccountId?: string,
): T {
  const account = targetAccountId
    ? workspace.accounts.find((a) => a.id === targetAccountId)
    : workspace.accounts.find(
        (a) => a.kind === "pay_later" && a.name.toLowerCase().includes("amazon"),
      );

  if (!account) return workspace;

  const userId = account.userId;
  const accountId = account.id;

  // 1. Attach snapshots if not already present
  const existingSnapshotDates = new Set(
    workspace.snapshots
      .filter((s) => s.accountId === accountId)
      .map((s) => s.asOf.slice(0, 10)),
  );

  if (!existingSnapshotDates.has("2026-10-05")) {
    const snap1: AccountSnapshot = {
      id: `snap-amzn-checkpoint-1`,
      userId,
      accountId,
      asOf: "2026-10-05T12:00:00Z",
      reportedOutstanding: "3182.68",
      source: "app_screenshot",
      verifiedByUser: true,
    };
    workspace.snapshots.push(snap1);
  }

  if (!existingSnapshotDates.has("2026-10-18")) {
    const snap2: AccountSnapshot = {
      id: `snap-amzn-oct-provider`,
      userId,
      accountId,
      asOf: "2026-10-18T19:20:00Z",
      reportedOutstanding: "34808.60",
      reportedUtilized: "35418.52",
      source: "app_screenshot",
      verifiedByUser: true,
    };
    workspace.snapshots.push(snap2);
  }

  // 2. Attach transactions idempotently
  // Filter out any confirmed duplicate DAWNTECH ₹32,990.00 transactions
  workspace.transactions = workspace.transactions.filter(
    (t) =>
      !(
        (t.merchant?.toLowerCase().includes("dawntech") ||
          t.description?.toLowerCase().includes("dawntech")) &&
        t.amount === "32990.00"
      ),
  );

  const existingTxKeys = new Set(
    workspace.transactions
      .filter((t) => t.fromAccountId === accountId || t.toAccountId === accountId)
      .map((t) => `${t.occurredOn || "null"}:${t.amount}:${t.kind}`),
  );

  const transactionsToAttach: Transaction[] = [
    {
      id: `tx-amzn-old-purchase`,
      userId,
      amount: "1000.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-01",
      merchant: "Amazon",
      description: "Amazon purchase (reflected in checkpoint snapshot)",
      category: "Shopping",
      platform: "Amazon",
      fromAccountId: accountId,
      toAccountId: null,
      notes: "Pre-checkpoint purchase already reflected in the ₹3,182.68 snapshot; not replayed after checkpoint.",
      sourceSystem: "amazon_pay_later",
    },
    {
      id: `tx-amzn-refund-1`,
      userId,
      amount: "380.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-10-07",
      merchant: "Amazon",
      description: "Amazon refund (posted after checkpoint)",
      category: "Shopping",
      platform: "Amazon",
      fromAccountId: null,
      toAccountId: accountId,
      notes: "Confirmed refund reducing Amazon Pay Later liability without treating as income.",
      sourceSystem: "amazon_pay_later",
    },
    {
      id: `tx-amzn-refund-ponds`,
      userId,
      amount: "353.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-10-13",
      merchant: "Amazon",
      description: "POND'S Gel refund",
      category: "Shopping",
      platform: "Amazon",
      fromAccountId: null,
      toAccountId: accountId,
      notes: "Confirmed product refund reducing Pay Later liability without treating as income.",
      sourceSystem: "amazon_pay_later",
    },
    {
      id: `tx-amzn-samsung-tv`,
      userId,
      amount: "30509.79",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-18",
      merchant: "Amazon",
      description: "Samsung 43-inch television plus two additional items",
      category: "Electronics",
      platform: "Amazon",
      fromAccountId: accountId,
      toAccountId: null,
      externalReference: "406-2479955-3587539, 406-6855707-5582708, 406-0628731-9190704",
      notes: "9-month EMI agreement @ 20% p.a. (₹3,678.70/mo). Only financed principal consumes limit upfront.",
      sourceSystem: "amazon_pay_later",
    },
    {
      id: `tx-amzn-repayment-screenshot`,
      userId,
      amount: "6954.15",
      currency: "INR",
      kind: "bill_payment",
      status: "pending_review",
      occurredOn: null,
      merchant: "Amazon Pay Later",
      description: "Amazon Pay Later statement repayment",
      category: "Bills",
      platform: "Amazon",
      fromAccountId: null,
      toAccountId: accountId,
      notes: "Provider screenshot repayment; awaiting funding bank account and confirmed posting date.",
      sourceSystem: "amazon_pay_later",
    },
  ];

  for (const tx of transactionsToAttach) {
    const key = `${tx.occurredOn || "null"}:${tx.amount}:${tx.kind}`;
    if (!existingTxKeys.has(key)) {
      workspace.transactions.push(tx);
      existingTxKeys.add(key);
    }
  }

  // 3. Attach EMI agreement if emiAgreements exists
  if ("emiAgreements" in workspace && Array.isArray((workspace as WorkspaceDataWithEmi).emiAgreements)) {
    const emiList = (workspace as WorkspaceDataWithEmi).emiAgreements!;
    const hasSamsungEmi = emiList.some(
      (e) => e.accountId === accountId && e.description.toLowerCase().includes("samsung"),
    );
    if (!hasSamsungEmi) {
      const samsungAgreement: EmiAgreement = {
        id: "agr-samsung-tv",
        userId,
        accountId,
        orderIds: SAMSUNG_TV_EMI_SPEC.orderIds,
        purchaseDate: SAMSUNG_TV_EMI_SPEC.purchaseDate,
        merchant: "Amazon",
        description: SAMSUNG_TV_EMI_SPEC.description,
        financedPrincipal: SAMSUNG_TV_EMI_SPEC.effectivePurchaseValue, // ₹30,509.79
        annualInterestRate: SAMSUNG_TV_EMI_SPEC.annualInterestRate,
        totalScheduledInterest: SAMSUNG_TV_EMI_SPEC.interestAmount, // ₹2,598.50
        processingFee: SAMSUNG_TV_EMI_SPEC.processingFee, // ₹360.02
        totalScheduledRepayment: SAMSUNG_TV_EMI_SPEC.totalPayable, // ₹33,468.31
        emiCount: SAMSUNG_TV_EMI_SPEC.durationMonths,
        monthlyPayment: SAMSUNG_TV_EMI_SPEC.monthlyEmi, // ₹3,678.70
        principalOutstanding: SAMSUNG_TV_EMI_SPEC.effectivePurchaseValue,
        principalRepaid: "0.00",
        interestBilled: "0.00",
        interestPaid: "0.00",
        unbilledFutureInterest: SAMSUNG_TV_EMI_SPEC.interestAmount,
        feesBilled: "0.00",
        feesPaid: "0.00",
        status: "active",
      };
      emiList.push(samsungAgreement);
    }
  }

  return workspace;
}

/**
 * Reconciles IOB ZET Credit Card against provider-reported snapshot.
 */
export function reconcileIobZetCreditCard(data: WorkspaceData | WorkspaceDataWithEmi) {
  const card = data.accounts.find(
    (a) =>
      a.kind === "credit_card" &&
      (a.name.toLowerCase().includes("zet") ||
        a.institution.toLowerCase().includes("iob") ||
        a.maskedSuffix === "1967"),
  );

  const approvedLimit = "2250.00";
  const providerReportedOutstanding = "1413.40";
  const billedDue = "0.00";
  const minimumDue = "0.00";
  const snapshotDate = "2026-10-16";

  // Dated transactions
  const datedTransactions = [
    {
      date: "2026-10-04",
      description: "BBPS Payment (SBI -> IOB ZET)",
      amount: "675.00",
      type: "repayment",
      verified: true,
    },
    {
      date: "2026-10-09",
      description: "Zomato Media Private Limited",
      amount: "166.54",
      type: "expense",
      verified: true,
    },
    {
      date: "2026-10-13",
      description: "Blinkit",
      amount: "164.00",
      type: "expense",
      verified: true,
    },
  ];

  // Undated statement summary entries retained awaiting date confirmation
  const undatedEntries = [
    { description: "Opening Balance", amount: "139.10", direction: "debit", isOpening: true },
    { description: "BBPS Payment", amount: "140.00", direction: "credit" },
    { description: "Blinkit", amount: "154.00", direction: "debit" },
    { description: "Swiggy", amount: "282.00", direction: "debit" },
    { description: "Blinkit Commerce Private Limited", amount: "167.00", direction: "debit" },
    { description: "BBPS Payment", amount: "50.00", direction: "credit" },
    { description: "Ewayprint", amount: "259.00", direction: "credit" },
    { description: "Ewayprint", amount: "259.00", direction: "debit" },
    { description: "Poptech Growth Private Limited", amount: "122.00", direction: "debit" },
  ];

  return {
    cardFound: Boolean(card),
    approvedLimit,
    providerReportedOutstanding,
    billedDue,
    minimumDue,
    snapshotDate,
    statementDate: null, // Unknown until verified
    dueDate: null, // Unknown until verified
    datedTransactions,
    undatedEntries,
    reconciliationStatus: "awaiting_confirmation" as const,
    notes:
      "IOB ZET Credit Card limit is ₹2,250.00 with provider snapshot ₹1,413.40. Confirmed ₹675.00 BBPS payment from SBI on 04 Oct 2026 reduces card liability without counting as spending. Undated bill entries are preserved as unconfirmed statement records.",
  };
}
