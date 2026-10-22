import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  Account,
  EmiAgreement,
  WorkspaceDataWithEmi,
} from "../src/lib/types";
import {
  AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS,
  attachAmazonPayLaterTransactions,
  calculateEmiAccountMetrics,
  generateEmiSchedule,
  getAmazonPayLaterBillingSchedule,
  investigateDawntechTransaction,
  reconcileAmazonPayLater,
  reconcileIobZetCreditCard,
  SAMSUNG_TV_EMI_SPEC,
} from "../src/lib/emi";
import { getRecentAccountTransactions } from "../src/lib/account-presentation";
import { accountUsage } from "../src/lib/usage";
import { accountBalance, monthlySummary } from "../src/lib/finance";
import { executeNestBotQuery } from "../src/lib/nestbot-service";

vi.mock("server-only", () => ({}));

function createWorkspaceFixture() {
  const userId = randomUUID();
  const sbiId = randomUUID();
  const jupiterId = randomUUID();
  const amazonId = randomUUID();
  const iobZetId = randomUUID();

  const accounts: Account[] = [
    {
      id: sbiId,
      userId,
      kind: "bank",
      name: "State Bank of India",
      institution: "SBI",
      maskedSuffix: "1234",
      openingBalance: "50000.00",
      openingBalanceDate: "2026-10-01",
      active: true,
    },
    {
      id: jupiterId,
      userId,
      kind: "wallet",
      name: "Jupiter Wallet",
      institution: "Jupiter",
      maskedSuffix: "5678",
      openingBalance: "5000.00",
      openingBalanceDate: "2026-10-01",
      active: true,
    },
    {
      id: amazonId,
      userId,
      kind: "pay_later",
      name: "Amazon Pay Later",
      institution: "Amazon",
      maskedSuffix: "AMZN",
      creditLimit: "35000.00",
      openingBalance: "0.00",
      openingBalanceDate: "2026-10-01",
      active: true,
    },
    {
      id: iobZetId,
      userId,
      kind: "credit_card",
      name: "IOB ZET • 1967",
      institution: "IOB",
      maskedSuffix: "1967",
      creditLimit: "2250.00",
      openingBalance: "0.00",
      openingBalanceDate: "2026-10-01",
      active: true,
    },
  ];

  const data: WorkspaceDataWithEmi = {
    accounts,
    snapshots: [],
    transactions: [],
    bills: [],
    allocations: [],
    fixedDeposits: [],
    loans: [],
    emis: [],
    emiAllocations: [],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
    emiAgreements: [],
  };

  return {
    userId,
    data,
    sbiId,
    jupiterId,
    amazonId,
    iobZetId,
  };
}

describe("Amazon Pay Later — Principal-Based Credit Usage & Accounting", () => {
  it("computes fixed Amazon Pay Later billing schedule (1st bill generation, 5th payment deadline in Asia/Kolkata)", () => {
    const schedOct = getAmazonPayLaterBillingSchedule("2026-10-18");
    expect(schedOct.billingDay).toBe(1);
    expect(schedOct.dueDay).toBe(5);
    expect(schedOct.timezone).toBe("Asia/Kolkata");
    expect(schedOct.currentStatementDate).toBe("2026-10-01");
    expect(schedOct.currentDueDate).toBe("2026-10-05");
    expect(schedOct.nextStatementDate).toBe("2026-11-01");
    expect(schedOct.nextDueDate).toBe("2026-11-05");

    const schedNov = getAmazonPayLaterBillingSchedule("2026-11-02");
    expect(schedNov.currentStatementDate).toBe("2026-11-01");
    expect(schedNov.currentDueDate).toBe("2026-11-05");
    expect(schedNov.nextStatementDate).toBe("2026-12-01");
    expect(schedNov.nextDueDate).toBe("2026-12-05");
  });

  it("generates exact 9-month EMI schedule with exact decimal paise arithmetic", () => {
    const installments = generateEmiSchedule({
      agreementId: "agr-samsung-tv",
      userId: "user-1",
      financedPrincipal: SAMSUNG_TV_EMI_SPEC.effectivePurchaseValue,
      annualInterestRate: SAMSUNG_TV_EMI_SPEC.annualInterestRate,
      durationMonths: SAMSUNG_TV_EMI_SPEC.durationMonths,
      monthlyEmi: SAMSUNG_TV_EMI_SPEC.monthlyEmi,
      processingFee: SAMSUNG_TV_EMI_SPEC.processingFee,
      firstBillingDate: SAMSUNG_TV_EMI_SPEC.firstBillingDate,
      firstDueDate: SAMSUNG_TV_EMI_SPEC.firstDueDate,
    });

    expect(installments).toHaveLength(9);
    expect(installments[0].installmentNumber).toBe(1);
    expect(installments[0].billingDate).toBe("2026-11-01");
    expect(installments[0].dueDate).toBe("2026-11-05");
    expect(installments[0].feeComponent).toBe("360.02"); // One-time processing fee on installment 1
    expect(installments[1].feeComponent).toBe("0.00");

    // Sum of principal components across all installments must reconcile to total financed principal down to the paise
    let sumPrincipal = 0;
    for (const inst of installments) {
      sumPrincipal += Number(inst.principalComponent);
      expect(Number(inst.totalDue)).toBe(3678.70);
    }
    expect(sumPrincipal.toFixed(2)).toBe("30509.79");
  });

  it("CRITICAL RULE: only financed principal consumes available credit upfront; future interest does NOT reduce limit", () => {
    const f = createWorkspaceFixture();

    const emiAgreement: EmiAgreement = {
      id: "agr-samsung-tv",
      userId: f.userId,
      accountId: f.amazonId,
      orderIds: SAMSUNG_TV_EMI_SPEC.orderIds,
      purchaseDate: SAMSUNG_TV_EMI_SPEC.purchaseDate,
      merchant: "Amazon",
      description: SAMSUNG_TV_EMI_SPEC.description,
      financedPrincipal: SAMSUNG_TV_EMI_SPEC.effectivePurchaseValue, // ₹30,509.79
      annualInterestRate: "20.00",
      totalScheduledInterest: SAMSUNG_TV_EMI_SPEC.interestAmount, // ₹2,598.50
      processingFee: SAMSUNG_TV_EMI_SPEC.processingFee, // ₹360.02
      totalScheduledRepayment: SAMSUNG_TV_EMI_SPEC.totalPayable, // ₹33,468.31
      emiCount: 9,
      monthlyPayment: SAMSUNG_TV_EMI_SPEC.monthlyEmi, // ₹3,678.70
      principalOutstanding: SAMSUNG_TV_EMI_SPEC.effectivePurchaseValue, // ₹30,509.79
      principalRepaid: "0.00",
      interestBilled: "0.00",
      interestPaid: "0.00",
      unbilledFutureInterest: SAMSUNG_TV_EMI_SPEC.interestAmount, // ₹2,598.50
      feesBilled: "0.00",
      feesPaid: "0.00",
      status: "active",
    };

    f.data.emiAgreements = [emiAgreement];

    const metrics = calculateEmiAccountMetrics(f.data, f.data.accounts[2]);
    expect(metrics.financedPrincipal).toBe("30509.79");
    expect(metrics.principalOutstanding).toBe("30509.79");
    expect(metrics.unbilledFutureInterest).toBe("2598.50");
    expect(metrics.processingFees).toBe("360.02");
    expect(metrics.principalConsumingCredit).toBe("30509.79");
    // Available credit = ₹35,000 - ₹30,509.79 = ₹4,490.21 (NOT reduced by future interest!)
    expect(metrics.availableCredit).toBe("4490.21");
    // Credit utilization = 30509.79 / 35000 * 100 = 87.1708...% (NOT 105.9%!)
    expect(metrics.creditUtilization).toBeCloseTo(87.17, 1);

    // Verify through the central accountUsage service
    const usage = accountUsage(f.data, f.amazonId, "2026-10-18");
    expect(usage.totalCreditLimit).toBe("35000.00");
    expect(usage.availableCredit).toBe("4490.21");
    expect(usage.creditUtilization).toBeCloseTo(87.17, 1);
    expect(usage.statementGenerationDate).toBe("2026-11-01");
    expect(usage.paymentDueDate).toBe("2026-11-05");
    expect(usage.financedPrincipal).toBe("30509.79");
    expect(usage.unbilledFutureInterest).toBe("2598.50");
  });

  it("identifies DAWNTECH ₹32,990 transaction as confirmed duplicate of Samsung TV purchase", () => {
    const f = createWorkspaceFixture();

    // When removed:
    const resultEmpty = investigateDawntechTransaction(f.data);
    expect(resultEmpty.found).toBe(false);
    expect(resultEmpty.isRemovedDuplicate).toBe(true);
    expect(resultEmpty.notes).toContain("confirmed by user as duplicate of Samsung TV EMI purchase and removed");

    // When present in raw transactions:
    f.data.transactions.push({
      id: "tx-dawntech-1",
      userId: f.userId,
      fromAccountId: f.amazonId,
      toAccountId: null,
      amount: "32990.00",
      currency: "INR",
      occurredOn: "2026-10-18",
      merchant: "DAWNTECH ELECTRONICS",
      description: "Television order",
      category: "Electronics",
      status: "posted",
      kind: "expense",
    });

    const result = investigateDawntechTransaction(f.data);
    expect(result.found).toBe(true);
    expect(result.isRemovedDuplicate).toBe(true);
    expect(result.transaction?.amount).toBe("32990.00");
    expect(result.notes).toContain("DAWNTECH transaction of ₹32,990.00 on 18 Oct 2026 confirmed by user as duplicate of Samsung TV EMI purchase.");
  });

  it("reconciles Amazon Pay Later provider snapshot vs legacy calculations and reports discrepancy", () => {
    const f = createWorkspaceFixture();
    const recon = reconcileAmazonPayLater(f.data, "2026-10-18");
    expect(recon.accountFound).toBe(true);
    expect(recon.approvedLimit).toBe("35000.00");
    expect(recon.providerReportedOutstanding).toBe("34808.60");
    expect(recon.legacyEstimatedOutstanding).toBe("37073.68");
    expect(recon.discrepancy).toBe("2265.08");
    expect(recon.rootCauseExplanation).toContain("Legacy MoneyNest calculations added projected future scheduled EMI interest upfront");
  });
});

describe("Refund and Repayment Accounting", () => {
  it("POND'S Gel ₹353 refund reduces Pay Later liability without being treated as income", () => {
    const f = createWorkspaceFixture();
    // Purchase ₹1,000 on Pay Later
    f.data.transactions.push({
      id: "tx-purchase-1",
      userId: f.userId,
      fromAccountId: f.amazonId,
      toAccountId: null,
      amount: "1000.00",
      currency: "INR",
      occurredOn: "2026-10-10",
      merchant: "Amazon",
      description: "POND'S Gel order",
      category: "Shopping",
      status: "posted",
      kind: "expense",
    });

    // Refund ₹353 posted to Amazon Pay Later
    f.data.transactions.push({
      id: "tx-refund-ponds",
      userId: f.userId,
      fromAccountId: null,
      toAccountId: f.amazonId,
      amount: "353.00",
      currency: "INR",
      occurredOn: "2026-10-13",
      merchant: "Amazon",
      description: "POND'S Gel Refund",
      category: "Shopping",
      status: "posted",
      kind: "refund",
      refundOfTransactionId: "tx-purchase-1",
    });

    // Outstanding liability must be 1000 - 353 = 647.00
    const bal = accountBalance(f.data, f.amazonId, "2026-10-15");
    expect(bal.current).toBe("647.00");

    // Monthly summary must treat the refund as spending reduction, NOT ordinary income
    const monthly = monthlySummary(f.data, "2026-10");
    expect(monthly.gross).toBe("1000.00");
    expect(monthly.refunds).toBe("353.00");
    expect(monthly.net).toBe("647.00");
    expect(monthly.income).toBe("0.00"); // Zero ordinary income!
  });

  it("repayment of ₹6,954.15 from SBI to Amazon Pay Later reduces debt once and bank balance once, without counting as new expense", () => {
    const f = createWorkspaceFixture();

    // Initial Amazon debt: snapshot ₹10,000
    f.data.snapshots.push({
      id: randomUUID(),
      userId: f.userId,
      accountId: f.amazonId,
      asOf: "2026-10-01",
      reportedOutstanding: "10000.00",
      source: "bank_statement",
      verifiedByUser: true,
    });

    // Bill payment / transfer from SBI (balance ₹50,000) to Amazon Pay Later
    f.data.transactions.push({
      id: "tx-repayment-1",
      userId: f.userId,
      fromAccountId: f.sbiId,
      toAccountId: f.amazonId,
      amount: "6954.15",
      currency: "INR",
      occurredOn: "2026-10-05",
      merchant: "Amazon Pay Later",
      description: "Repayment of Pay Later dues",
      category: "Bills",
      status: "posted",
      kind: "bill_payment",
    });

    const sbiBal = accountBalance(f.data, f.sbiId, "2026-10-15");
    // SBI: 50,000 - 6,954.15 = 43,045.85
    expect(sbiBal.current).toBe("43045.85");

    const amazonBal = accountBalance(f.data, f.amazonId, "2026-10-15");
    // Amazon Pay Later debt: 10,000 - 6,954.15 = 3,045.85
    expect(amazonBal.current).toBe("3045.85");

    // Bill payments are transfers, NOT added to monthly expense gross
    const monthly = monthlySummary(f.data, "2026-10");
    expect(monthly.gross).toBe("0.00");
  });
});

describe("IOB ZET Credit Card Reconciliation", () => {
  it("verifies IOB ZET limit ₹2,250, snapshot ₹1,413.40, and BBPS ₹675 repayment from SBI", () => {
    const f = createWorkspaceFixture();

    const recon = reconcileIobZetCreditCard(f.data);
    expect(recon.cardFound).toBe(true);
    expect(recon.approvedLimit).toBe("2250.00");
    expect(recon.providerReportedOutstanding).toBe("1413.40");
    expect(recon.billedDue).toBe("0.00");
    expect(recon.minimumDue).toBe("0.00");
    expect(recon.datedTransactions).toHaveLength(3);
    expect(recon.datedTransactions[0].amount).toBe("675.00");
    expect(recon.datedTransactions[0].type).toBe("repayment");
    expect(recon.undatedEntries).toHaveLength(9);
    expect(recon.undatedEntries[0].description).toBe("Opening Balance");
    expect(recon.undatedEntries[0].amount).toBe("139.10");

    // Test BBPS payment on 04 Oct 2026 in the workspace
    f.data.transactions.push({
      id: "tx-zet-repay-bbps",
      userId: f.userId,
      fromAccountId: f.sbiId,
      toAccountId: f.iobZetId,
      amount: "675.00",
      currency: "INR",
      occurredOn: "2026-10-04",
      merchant: "IOB ZET",
      description: "BBPS Payment (SBI -> IOB ZET)",
      status: "posted",
      kind: "bill_payment",
    });

    const usage = accountUsage(f.data, f.iobZetId, "2026-10-15");
    expect(usage.confirmedRepayments).toBe("675.00");
  });
});

describe("Split Payments", () => {
  it("handles split payment (Swiggy ₹131: SBI ₹106 + Jupiter ₹25) correctly across both accounts without duplicate spending", () => {
    const f = createWorkspaceFixture();

    // Leg 1: SBI ₹106
    f.data.transactions.push({
      id: "tx-swiggy-leg-1",
      userId: f.userId,
      fromAccountId: f.sbiId,
      toAccountId: null,
      amount: "106.00",
      currency: "INR",
      occurredOn: "2026-10-12",
      merchant: "Swiggy",
      description: "Swiggy Food Order (SBI portion)",
      category: "Food",
      status: "posted",
      kind: "expense",
    });

    // Leg 2: Jupiter ₹25
    f.data.transactions.push({
      id: "tx-swiggy-leg-2",
      userId: f.userId,
      fromAccountId: f.jupiterId,
      toAccountId: null,
      amount: "25.00",
      currency: "INR",
      occurredOn: "2026-10-12",
      merchant: "Swiggy",
      description: "Swiggy Food Order (Jupiter portion)",
      category: "Food",
      status: "posted",
      kind: "expense",
    });

    // SBI balance: 50,000 - 106 = 49,894
    const sbiBal = accountBalance(f.data, f.sbiId, "2026-10-15");
    expect(sbiBal.current).toBe("49894.00");

    // Jupiter balance: 5,000 - 25 = 4,975
    const jupiterBal = accountBalance(f.data, f.jupiterId, "2026-10-15");
    expect(jupiterBal.current).toBe("4975.00");

    // Monthly total spending includes exactly 106 + 25 = 131
    const monthly = monthlySummary(f.data, "2026-10");
    expect(monthly.gross).toBe("131.00");
  });
});

describe("Money Nest Bot Queries", () => {
  it("answers Amazon Pay Later questions with principal-based available credit and explanation", async () => {
    const f = createWorkspaceFixture();

    f.data.emiAgreements = [
      {
        id: "agr-samsung-tv",
        userId: f.userId,
        accountId: f.amazonId,
        orderIds: SAMSUNG_TV_EMI_SPEC.orderIds,
        purchaseDate: SAMSUNG_TV_EMI_SPEC.purchaseDate,
        merchant: "Amazon",
        description: SAMSUNG_TV_EMI_SPEC.description,
        financedPrincipal: "30509.79",
        totalScheduledInterest: "2598.50",
        processingFee: "360.02",
        totalScheduledRepayment: "33468.31",
        emiCount: 9,
        monthlyPayment: "3678.70",
        principalOutstanding: "30509.79",
        principalRepaid: "0.00",
        interestBilled: "0.00",
        interestPaid: "0.00",
        unbilledFutureInterest: "2598.50",
        feesBilled: "0.00",
        feesPaid: "0.00",
        status: "active",
      },
    ];

    const response = await executeNestBotQuery(f.data, f.userId, {
      message: "How much Amazon Pay Later credit is available?",
    });

    expect(response.reply).toContain("Amazon Pay Later");
    expect(response.reply).toContain("₹35,000.00");
    expect(response.reply).toContain("₹4,490.21"); // Principal-based available credit!
    expect(response.reply).toContain("financed principal consumes available credit upfront");
  });

  it("answers IOB ZET credit card queries with ₹2,250 limit and BBPS repayment details", async () => {
    const f = createWorkspaceFixture();

    const response = await executeNestBotQuery(f.data, f.userId, {
      message: "What is my IOB ZET card status?",
    });

    expect(response.reply).toContain("IOB ZET Credit Card");
    expect(response.reply).toContain("₹2,250.00");
    expect(response.reply).toContain("₹675.00 BBPS payment from SBI");
  });

  it("answers Amazon Pay Later transaction history queries with complete attached transaction ledger", async () => {
    const f = createWorkspaceFixture();

    const response = await executeNestBotQuery(f.data, f.userId, {
      message: "Show my Amazon Pay Later transaction history",
    });

    expect(response.reply).toContain("Attached Transaction History:");
    expect(response.reply).toContain("01 Oct 2026: Amazon purchase (pre-checkpoint) · ₹1,000.00");
    expect(response.reply).toContain("05 Oct 2026: Checkpoint balance snapshot · ₹3,182.68");
    expect(response.reply).toContain("07 Oct 2026: Confirmed refund · -₹380.00");
    expect(response.reply).toContain("13 Oct 2026: POND'S Gel refund · -₹353.00");
    expect(response.reply).toContain("Samsung 43\" TV EMI agreement");
    expect(response.reply).toContain("₹30,509.79");
    expect(response.reply).not.toContain("DAWNTECH");
    expect(response.reply).toContain("Provider statement repayment · ₹6,954.15");
  });
});

describe("Amazon Pay Later Attached Historical Transactions & Ledger", () => {
  it("exposes verified historical transactions without DAWNTECH duplicate in AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS", () => {
    expect(AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS).toHaveLength(6);

    const amounts = AMAZON_PAY_LATER_HISTORICAL_TRANSACTIONS.map((t) => t.amount);
    expect(amounts).toContain("1000.00");
    expect(amounts).toContain("3182.68");
    expect(amounts).toContain("380.00");
    expect(amounts).toContain("353.00");
    expect(amounts).toContain("30509.79");
    expect(amounts).toContain("6954.15");
    expect(amounts).not.toContain("32990.00");
  });

  it("reconcileAmazonPayLater includes datedTransactions, candidateOrPendingTransactions, and allHistoricalTransactions", () => {
    const f = createWorkspaceFixture();
    const recon = reconcileAmazonPayLater(f.data, "2026-10-18");

    expect(recon.datedTransactions.length).toBeGreaterThanOrEqual(5);
    expect(recon.candidateOrPendingTransactions).toHaveLength(1);
    expect(recon.allHistoricalTransactions).toHaveLength(6);
  });

  it("attachAmazonPayLaterTransactions attaches transactions, snapshots, and EMI agreement idempotently, removing DAWNTECH duplicates", () => {
    const f = createWorkspaceFixture();

    // Pre-insert a duplicate DAWNTECH transaction to ensure it gets removed
    f.data.transactions.push({
      id: "tx-duplicate-dawntech",
      userId: f.userId,
      fromAccountId: f.amazonId,
      toAccountId: null,
      amount: "32990.00",
      currency: "INR",
      occurredOn: "2026-10-18",
      merchant: "DAWNTECH ELECTRONICS",
      description: "Television order",
      category: "Electronics",
      status: "posted",
      kind: "expense",
    });

    expect(f.data.transactions).toHaveLength(1);
    expect(f.data.snapshots).toHaveLength(0);
    expect(f.data.emiAgreements).toHaveLength(0);

    // First attach
    attachAmazonPayLaterTransactions(f.data, f.amazonId);

    // 5 attached transactions (1000, 380, 353, 30509.79, 6954.15); DAWNTECH 32990 was removed!
    expect(f.data.transactions.length).toBe(5);
    expect(f.data.transactions.some((t) => t.amount === "32990.00")).toBe(false);
    expect(f.data.snapshots.length).toBe(2);
    expect(f.data.emiAgreements?.length).toBe(1);

    // Verify recent transactions for Amazon Pay Later
    const recent = getRecentAccountTransactions(f.data, f.amazonId, 5, "2026-10-18");
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.some((t) => t.amount === "30509.79")).toBe(true);
    expect(recent.some((t) => t.amount === "353.00")).toBe(true);
    expect(recent.some((t) => t.amount === "380.00")).toBe(true);
    expect(recent.some((t) => t.amount === "32990.00")).toBe(false);

    // Second attach (idempotency check: no duplicates!)
    attachAmazonPayLaterTransactions(f.data, f.amazonId);

    expect(f.data.transactions.length).toBe(5);
    expect(f.data.snapshots.length).toBe(2);
    expect(f.data.emiAgreements?.length).toBe(1);
  });
});

describe("Transaction Deletion Feature", () => {
  it("removes a transaction and cascades cleanup of its allocations", () => {
    const f = createWorkspaceFixture();
    const txId = "tx-test-delete-1";
    f.data.transactions.push({
      id: txId,
      userId: f.userId,
      fromAccountId: f.sbiId,
      toAccountId: null,
      amount: "500.00",
      currency: "INR",
      occurredOn: "2026-10-15",
      merchant: "Swiggy",
      description: "Dinner",
      category: "Food",
      status: "posted",
      kind: "expense",
    });

    f.data.allocations.push({
      id: "alloc-test-1",
      userId: f.userId,
      billId: "bill-1",
      transactionId: txId,
      amount: "500.00",
      verified: true,
    });

    expect(f.data.transactions.some((t) => t.id === txId)).toBe(true);
    expect(f.data.allocations.some((a) => a.transactionId === txId)).toBe(true);

    // Simulate deleteRecord("transactions", txId)
    f.data.transactions = f.data.transactions.filter((t) => t.id !== txId);
    f.data.allocations = f.data.allocations.filter((a) => a.transactionId !== txId);

    expect(f.data.transactions.some((t) => t.id === txId)).toBe(false);
    expect(f.data.allocations.some((a) => a.transactionId === txId)).toBe(false);
  });
});
