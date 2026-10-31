import Decimal from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmiAgreement, Loan, Transaction, WorkspaceDataWithEmi } from "../src/lib/types";
import {
  calculateEmiAccountMetrics,
  generateEmiSchedule,
  getAmazonPayLaterBillingSchedule,
} from "../src/lib/emi";
import { accountUsage } from "../src/lib/usage";
import { accountBalance, monthlySummary } from "../src/lib/finance";
import { executeNestBotQuery } from "../src/lib/nestbot-service";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/ai-receipt-service", () => ({
  readReceiptAIConfiguration: () => null,
  scanReceiptBatchWithAI: vi.fn(),
}));

const owner = "11111111-1111-4111-8111-111111111111";
const foreignOwner = "22222222-2222-4222-8222-222222222222";
const bankId = "10000000-0000-4000-8000-000000000001";
const walletId = "10000000-0000-4000-8000-000000000002";
const payLaterId = "10000000-0000-4000-8000-000000000003";
const cardId = "10000000-0000-4000-8000-000000000004";

function workspace(): WorkspaceDataWithEmi {
  return {
    accounts: [
      { id: bankId, userId: owner, name: "Synthetic bank", institution: "Imaginary", kind: "bank", maskedSuffix: "1111", active: true, openingBalance: "10000.00", openingBalanceDate: "2028-03-01" },
      { id: walletId, userId: owner, name: "Synthetic wallet", institution: "Imaginary", kind: "wallet", maskedSuffix: "2222", active: true, openingBalance: "500.00", openingBalanceDate: "2028-03-01" },
      { id: payLaterId, userId: owner, name: "Synthetic Amazon Pay Later", institution: "Amazon", kind: "pay_later", maskedSuffix: "3333", active: true, creditLimit: "12000.00", openingBalance: "0.00", openingBalanceDate: "2028-03-01" },
      { id: cardId, userId: owner, name: "Synthetic IOB ZET", institution: "IOB", kind: "credit_card", maskedSuffix: "4444", active: true, creditLimit: "2500.00", openingBalance: "0.00", openingBalanceDate: "2028-03-01" },
    ],
    transactions: [], snapshots: [], bills: [], allocations: [], fixedDeposits: [],
    loans: [], emis: [], emiAllocations: [], groups: [], shares: [], settlements: [],
    reminders: [], auditEvents: [], emiAgreements: [],
  };
}

function agreement(overrides: Partial<EmiAgreement> = {}): EmiAgreement {
  return {
    id: "synthetic-agreement", userId: owner, accountId: payLaterId, orderIds: [],
    purchaseDate: "2028-03-02", merchant: "Synthetic store", description: "Synthetic appliance",
    financedPrincipal: "9000.00", totalScheduledInterest: "900.00", processingFee: "24.00",
    totalScheduledRepayment: "9900.00", emiCount: 9, monthlyPayment: "1100.00",
    principalOutstanding: "9000.00", principalRepaid: "0.00", interestBilled: "0.00",
    interestPaid: "0.00", unbilledFutureInterest: "900.00", feesBilled: "0.00",
    feesPaid: "0.00", status: "active", ...overrides,
  };
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "20000000-0000-4000-8000-000000000001", userId: owner, amount: "250.00",
    currency: "INR", kind: "expense", status: "posted", occurredOn: "2028-03-10",
    description: "Synthetic order", fromAccountId: payLaterId, toAccountId: null,
    ...overrides,
  };
}

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "30000000-0000-4000-8000-000000000001", userId: owner,
    name: "Synthetic equipment loan", lender: "Harbor Lending", kind: "institutional",
    contractualPrincipal: "500.00", netDisbursed: "480.00", reportedOutstanding: "125.50",
    reportedAsOf: "2027-12-03", repaymentAccountId: bankId, disbursedOn: "2027-01-01",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2028-03-20T08:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("generic EMI calculations from recorded agreements", () => {
  it("retains the billing calendar across a year boundary", () => {
    expect(getAmazonPayLaterBillingSchedule("2028-12-20")).toMatchObject({
      currentStatementDate: "2028-12-01", currentDueDate: "2028-12-05",
      nextStatementDate: "2029-01-01", nextDueDate: "2029-01-05", timezone: "Asia/Kolkata",
    });
  });

  it("reconciles scheduled principal exactly and records the fee only once", () => {
    const installments = generateEmiSchedule({
      agreementId: "synthetic-agreement", userId: owner, financedPrincipal: "1200.01",
      durationMonths: 3, monthlyEmi: "430.00", processingFee: "12.00",
      firstBillingDate: "2028-12-01", firstDueDate: "2028-12-05",
    });
    expect(installments).toHaveLength(3);
    expect(installments.map((row) => row.dueDate)).toEqual(["2028-12-05", "2029-01-05", "2029-02-05"]);
    expect(Decimal.sum(...installments.map((row) => row.principalComponent)).toFixed(2)).toBe("1200.01");
    expect(installments.map((row) => row.feeComponent)).toEqual(["12.00", "0.00", "0.00"]);
    expect(installments.every((row) => row.totalDue === "430.00")).toBe(true);
  });

  it("uses recorded principal and repayment without charging future interest to available credit", () => {
    const data = workspace();
    data.emiAgreements = [agreement({ principalRepaid: "1000.00", interestBilled: "100.00", interestPaid: "75.00" })];
    const before = structuredClone(data);
    expect(calculateEmiAccountMetrics(data, data.accounts[2], "2028-03-20")).toMatchObject({
      financedPrincipal: "9000.00", principalRepaid: "1000.00", principalOutstanding: "8000.00",
      unbilledFutureInterest: "800.00", processingFees: "24.00", availableCredit: "4000.00",
    });
    const usage = accountUsage(data, payLaterId, "2028-03-20");
    expect(usage.availableCredit).toBe("4000.00");
    expect(usage.creditUtilization).toBeCloseTo(8000 / 12000 * 100);
    expect(data).toEqual(before);
  });

  it("excludes other owners, accounts, inactive agreements and future purchases", () => {
    const data = workspace();
    data.emiAgreements = [
      agreement(), agreement({ id: "foreign-owner", userId: foreignOwner }),
      agreement({ id: "foreign-account", accountId: cardId }),
      agreement({ id: "closed", status: "completed" }),
      agreement({ id: "future", purchaseDate: "2028-04-01" }),
    ];
    const metrics = calculateEmiAccountMetrics(data, data.accounts[2], "2028-03-20");
    expect(metrics.financedPrincipal).toBe("9000.00");
    expect(metrics.principalOutstanding).toBe("9000.00");
  });

  it("does not fabricate agreements or a credit limit when none is recorded", () => {
    const data = workspace();
    data.accounts[2].creditLimit = null;
    const before = structuredClone(data);
    expect(calculateEmiAccountMetrics(data, data.accounts[2])).toMatchObject({
      financedPrincipal: "0.00", availableCredit: null, creditUtilization: null,
    });
    expect(data).toEqual(before);
  });
});

describe("recorded refunds, repayments and split spending", () => {
  it("reduces debt and spending for a matched refund without recording income", () => {
    const data = workspace();
    data.transactions = [transaction(), transaction({
      id: "20000000-0000-4000-8000-000000000002", amount: "75.00", kind: "refund",
      fromAccountId: null, toAccountId: payLaterId, refundOfTransactionId: transaction().id,
      occurredOn: "2028-03-12",
    })];
    expect(accountBalance(data, payLaterId, "2028-03-20").current).toBe("175.00");
    expect(monthlySummary(data, "2028-03")).toMatchObject({ gross: "250.00", refunds: "75.00", net: "175.00", income: "0.00" });
  });

  it("debits the funding bank and repays debt once without new spending", () => {
    const data = workspace();
    data.snapshots.push({ id: "synthetic-snapshot", userId: owner, accountId: payLaterId,
      asOf: "2028-03-01", reportedOutstanding: "2000.00", source: "bank_statement", verifiedByUser: true });
    data.transactions.push(transaction({ kind: "bill_payment", amount: "300.00", fromAccountId: bankId, toAccountId: payLaterId }));
    expect(accountBalance(data, bankId, "2028-03-20").current).toBe("9700.00");
    expect(accountBalance(data, payLaterId, "2028-03-20").current).toBe("1700.00");
    expect(monthlySummary(data, "2028-03").gross).toBe("0.00");
  });

  it("counts recorded split legs once across bank and wallet", () => {
    const data = workspace();
    data.transactions = [transaction({ fromAccountId: bankId, amount: "80.00" }),
      transaction({ id: "20000000-0000-4000-8000-000000000002", fromAccountId: walletId, amount: "20.00" })];
    expect(accountBalance(data, bankId, "2028-03-20").current).toBe("9920.00");
    expect(accountBalance(data, walletId, "2028-03-20").current).toBe("480.00");
    expect(monthlySummary(data, "2028-03").gross).toBe("100.00");
  });
});

describe("NestBot answers from recorded account data", () => {
  it("uses the recorded limit and principal metrics for Pay Later", async () => {
    const data = workspace();
    data.emiAgreements = [agreement()];
    const result = await executeNestBotQuery(data, owner, { message: "Show Amazon credit available" });
    expect(result.reply).toContain("₹12,000.00");
    expect(result.reply).toContain("₹3,000.00");
    expect(result.reply).not.toContain("₹₹");
  });

  it.each(["Amazon", "IOB ZET"])("keeps missing %s limits and liabilities unknown", async (name) => {
    const data = workspace();
    const target = data.accounts[name === "Amazon" ? 2 : 3];
    target.creditLimit = null;
    target.openingBalance = null;
    target.openingBalanceDate = null;
    const result = await executeNestBotQuery(data, owner, { message: `Show ${name} account status` });
    expect(result.reply).toMatch(/Credit Limit: Unknown/);
    expect(result.reply).toContain("Outstanding Liability: Unknown");
    expect(result.reply).toContain("Available Credit: Unknown");
    expect(result.reply).not.toContain("Recent Payment:");
  });

  it.each(["Amazon", "IOB ZET"])("reports empty %s history without injecting transactions", async (name) => {
    const data = workspace();
    const before = structuredClone(data);
    const result = await executeNestBotQuery(data, owner, { message: `Show ${name} transaction history` });
    expect(result.reply).toContain("No transaction history is recorded for this account.");
    expect(data).toEqual(before);
  });

  it("shows only this owner's recorded account history and identifies pending evidence", async () => {
    const data = workspace();
    data.transactions = [
      transaction({ description: "Recorded synthetic purchase" }),
      transaction({ id: "pending", description: "Recorded pending review", status: "pending_review", occurredOn: null }),
      transaction({ id: "other-account", description: "Unrelated account entry", fromAccountId: cardId }),
      transaction({ id: "other-owner", description: "Foreign owner entry", userId: foreignOwner }),
      transaction({ id: "future", description: "Future entry", occurredOn: "2028-04-01" }),
    ];
    const before = structuredClone(data);
    const result = await executeNestBotQuery(data, owner, { message: "Show Amazon transaction history" });
    expect(result.reply).toContain("Recorded synthetic purchase · ₹250.00 · expense · posted");
    expect(result.reply).toContain("Date unconfirmed: Recorded pending review");
    expect(result.reply).toContain("pending_review");
    expect(result.reply).not.toContain("Unrelated account entry");
    expect(result.reply).not.toContain("Foreign owner entry");
    expect(result.reply).not.toContain("Future entry");
    expect(data).toEqual(before);
  });

  it("shows an actual card repayment only when it is recorded", async () => {
    const data = workspace();
    data.transactions.push(transaction({ kind: "bill_payment", amount: "45.00", fromAccountId: bankId,
      toAccountId: cardId, description: "Synthetic repayment reference" }));
    const result = await executeNestBotQuery(data, owner, { message: "Show IOB ZET payment history" });
    expect(result.reply).toContain("₹2,500.00");
    expect(result.reply).toContain("Synthetic repayment reference · ₹45.00 · bill_payment · posted");
  });

  it("reports the absence of loan records without claiming no debts exist", async () => {
    const result = await executeNestBotQuery(workspace(), owner, { message: "Who do I owe?" });
    expect(result.reply).toContain("No borrowed or institutional loans are recorded.");
    expect(result.reply).not.toContain("No outstanding debt");
  });

  it("shows dated loan reports, preserves recorded zero and keeps missing evidence unknown", async () => {
    const data = workspace();
    data.loans = [loan(), loan({
      id: "30000000-0000-4000-8000-000000000002", name: "Synthetic personal loan",
      lender: "Mira Vale", kind: "borrowed", reportedOutstanding: "0.00", reportedAsOf: "2028-02-02",
    }), loan({
      id: "30000000-0000-4000-8000-000000000003", name: "Synthetic unreported loan",
      lender: "Mira Vale", kind: "borrowed", reportedOutstanding: null, reportedAsOf: null,
    }), loan({ id: "lent", name: "Lent exclusion", kind: "lent" }),
    loan({ id: "foreign", name: "Foreign owner exclusion", userId: foreignOwner })];
    const before = structuredClone(data);
    const result = await executeNestBotQuery(data, owner, { message: "Who do I owe?" });
    expect(result.reply).toContain("Harbor Lending): Reported outstanding ₹125.50; report date 3 Dec 2027");
    expect(result.reply).toContain("Mira Vale): Reported outstanding ₹0.00; report date 2 Feb 2028");
    expect(result.reply).toContain("Mira Vale): Reported outstanding Unknown; report date Unknown");
    expect(result.reply).not.toContain("Lent exclusion");
    expect(result.reply).not.toContain("Foreign owner exclusion");
    expect(result.reply).not.toContain("Current outstanding");
    expect(data).toEqual(before);
  });

  it("matches either a recorded lender or loan name in an owe question", async () => {
    const data = workspace();
    data.loans = [loan(), loan({
      id: "30000000-0000-4000-8000-000000000002", name: "Synthetic personal loan",
      lender: "Mira Vale", kind: "borrowed", reportedOutstanding: null, reportedAsOf: null,
    })];
    for (const label of ["Harbor Lending", "Synthetic equipment loan"]) {
      const result = await executeNestBotQuery(data, owner, { message: `How much do I owe ${label}?` });
      expect(result.reply).toContain("Harbor Lending");
      expect(result.reply).toContain("₹125.50");
      expect(result.reply).not.toContain("Mira Vale");
    }
    const result = await executeNestBotQuery(data, owner, { message: "How much do I owe Mira Vale?" });
    expect(result.reply).toContain("Mira Vale): Reported outstanding Unknown; report date Unknown");
    expect(result.reply).not.toContain("Harbor Lending");
  });
});
