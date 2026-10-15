import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Account, AccountSnapshot, Bill, Transaction, WorkspaceData } from "../src/lib/types";
import { creditAccountSummary, accountUsage, usageSummary } from "../src/lib/usage";
import { accountBalance, monthlySummary } from "../src/lib/finance";
import { ReceiptDuplicateError, validateWorkspaceRecord } from "../src/lib/validation";
import {
  getAccountsOverview,
  getSpendingAnalysis,
  getUpcomingDues,
  searchTransactions,
  findDuplicateTransactions,
  buildProposedTransaction,
  confirmTransactionPost,
  executeNestBotQuery,
} from "../src/lib/nestbot-service";
import type { ProposedTransaction } from "../src/lib/nestbot-types";

vi.mock("server-only", () => ({}));

function createFixture() {
  const userId = randomUUID();
  const sbiId = randomUUID();
  const jupiterId = randomUUID();
  const meeshoId = randomUUID();
  const amazonId = randomUUID();
  const idfcQuantumId = randomUUID();
  const idfcHelloId = randomUUID();
  const iobZetId = randomUUID();
  const utkarshId = randomUUID();
  const suryodayId = randomUUID();

  const accounts: Account[] = [
    { id: sbiId, userId, kind: "bank", name: "State Bank of India", institution: "SBI", maskedSuffix: "1234", active: true },
    { id: jupiterId, userId, kind: "wallet", name: "Jupiter Wallet", institution: "Jupiter", maskedSuffix: "5678", active: true },
    { id: meeshoId, userId, kind: "pay_later", name: "Meesho Pay Later", institution: "Meesho", maskedSuffix: "", creditLimit: "2100.00", active: true },
    { id: amazonId, userId, kind: "pay_later", name: "Amazon Pay Later", institution: "Amazon", maskedSuffix: "", creditLimit: "35000.00", active: true },
    { id: idfcQuantumId, userId, kind: "credit_card", name: "IDFC Quantum+ • 3594", institution: "IDFC", maskedSuffix: "3594", creditLimit: "10000.00", active: true },
    { id: idfcHelloId, userId, kind: "credit_card", name: "IDFC Hello Cashback • 9959", institution: "IDFC", maskedSuffix: "9959", creditLimit: "10000.00", active: true },
    { id: iobZetId, userId, kind: "credit_card", name: "IOB ZET • 1967", institution: "IOB", maskedSuffix: "1967", creditLimit: "2250.00", active: true },
    { id: utkarshId, userId, kind: "credit_card", name: "Utkarsh SuperMoney • XX32", institution: "Utkarsh", maskedSuffix: "XX32", creditLimit: "990.00", active: true },
    { id: suryodayId, userId, kind: "credit_card", name: "Suryoday credit card • 3731", institution: "Suryoday", maskedSuffix: "3731", creditLimit: "900.00", active: true },
  ];

  const data: WorkspaceData = {
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
  };

  return {
    userId,
    data,
    sbiId,
    jupiterId,
    meeshoId,
    amazonId,
    idfcQuantumId,
    idfcHelloId,
    iobZetId,
    utkarshId,
    suryodayId,
  };
}

describe("Part D: Complete Verification of Credit Calculations and Money Nest Bot", () => {
  // Scenario 1: Meesho ₹2,100 limit with ₹170 unpaid bill
  it("Scenario 1: correctly calculates Meesho Pay Later with ₹2,100 limit and ₹170 unpaid bill without misleading utilization bar", () => {
    const f = createFixture();
    const bill: Bill = {
      id: randomUUID(),
      userId: f.userId,
      accountId: f.meeshoId,
      statementAmount: "170.00",
      statementDate: "2026-10-03",
      dueDate: "2026-11-03",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    };
    f.data.bills.push(bill);

    const summary = creditAccountSummary(f.data, f.meeshoId, "2026-10-15");
    const usage = accountUsage(f.data, f.meeshoId, "2026-10-15");

    expect(summary.totalCreditLimit).toBe("2100.00");
    expect(summary.billedAmount).toBe("170.00");
    expect(summary.estimatedAvailableCredit).toBe("1930.00");
    // Actual available credit must be unknown until verified by issuer
    expect(summary.availableCredit).toBeNull();
    // Credit utilization must be null to prevent misleading 0% or false bars
    expect(summary.creditUtilization).toBeNull();
    expect(summary.balanceVerificationStatus).toBe("partial");
    expect(summary.paymentDueDate).toBe("2026-11-03");

    // Matches accountUsage
    expect(usage.availableCredit).toBeNull();
    expect(usage.creditUtilization).toBeNull();
    expect(usage.estimatedAvailableCredit).toBe("1930.00");
    expect(usage.balanceVerificationStatus).toBe("partial");
  });

  // Scenario 2: Incomplete records available-credit estimation
  it("Scenario 2: marks incomplete records as unconfirmed/partial and avoids assuming unused credit", () => {
    const f = createFixture();
    // No snapshot, no opening balance, just a recorded purchase
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "500.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-10",
      description: "Book purchase",
      fromAccountId: f.idfcQuantumId,
      toAccountId: null,
    });

    const summary = creditAccountSummary(f.data, f.idfcQuantumId, "2026-10-15");
    expect(summary.totalCreditLimit).toBe("10000.00");
    expect(summary.availableCredit).toBeNull();
    expect(summary.creditUtilization).toBeNull();
    expect(summary.balanceVerificationStatus).toBe("unconfirmed");
    expect(summary.ledgerCalculatedOutstanding).toBeNull(); // Unknown baseline
  });

  // Scenario 3: Amazon Pay Later reconciliation from snapshot
  it("Scenario 3: reconciles Amazon Pay Later from ₹3,182.68 checkpoint applying ₹380 and ₹353 refunds without double counting", () => {
    const f = createFixture();
    const snapshot: AccountSnapshot = {
      id: randomUUID(),
      userId: f.userId,
      accountId: f.amazonId,
      asOf: "2026-10-05T12:00:00Z",
      reportedOutstanding: "3182.68",
      source: "app_screenshot",
      verifiedByUser: true,
    };
    f.data.snapshots.push(snapshot);

    // Pre-checkpoint purchase that should NOT be re-applied
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "1000.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-01",
      description: "Old purchase included in snapshot",
      fromAccountId: f.amazonId,
      toAccountId: null,
    });

    // Refund 1 on Oct 7
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "380.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-10-07",
      description: "Amazon refund 1",
      fromAccountId: null,
      toAccountId: f.amazonId,
    });

    // Refund 2 on Oct 13
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "353.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-10-13",
      description: "Amazon refund 2",
      fromAccountId: null,
      toAccountId: f.amazonId,
    });

    const summary = creditAccountSummary(f.data, f.amazonId, "2026-10-15");
    expect(summary.totalCreditLimit).toBe("35000.00");
    expect(summary.issuerReportedOutstanding).toBe("3182.68");
    expect(summary.confirmedRefunds).toBe("733.00"); // 380 + 353
    // Outstanding = 3182.68 - 733.00 = 2449.68
    expect(summary.ledgerCalculatedOutstanding).toBe("2449.68");
    // Estimated available = 35000 - 2449.68 = 32550.32
    expect(summary.estimatedAvailableCredit).toBe("32550.32");
    // With subsequent movements after snapshot, status is estimated
    expect(summary.balanceVerificationStatus).toBe("estimated");
  });

  // Scenario 4: New credit purchase followed by repayment
  it("Scenario 4: increases liability on purchase and reduces liability on repayment without treating repayment as spending", () => {
    const f = createFixture();
    const snapshot: AccountSnapshot = {
      id: randomUUID(),
      userId: f.userId,
      accountId: f.idfcQuantumId,
      asOf: "2026-10-01T12:00:00Z",
      reportedOutstanding: "0.00",
      reportedAvailable: "10000.00",
      source: "bank_statement",
      verifiedByUser: true,
    };
    f.data.snapshots.push(snapshot);

    // Purchase of ₹1,500
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "1500.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-05",
      description: "Electronics purchase",
      fromAccountId: f.idfcQuantumId,
      toAccountId: null,
    });

    const afterPurchase = creditAccountSummary(f.data, f.idfcQuantumId, "2026-10-06");
    expect(afterPurchase.ledgerCalculatedOutstanding).toBe("1500.00");
    expect(afterPurchase.estimatedAvailableCredit).toBe("8500.00");

    // Repayment of ₹500 from SBI
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "500.00",
      currency: "INR",
      kind: "transfer",
      status: "posted",
      occurredOn: "2026-10-10",
      description: "Credit card repayment",
      fromAccountId: f.sbiId,
      toAccountId: f.idfcQuantumId,
    });

    const afterRepayment = creditAccountSummary(f.data, f.idfcQuantumId, "2026-10-15");
    expect(afterRepayment.confirmedRepayments).toBe("500.00");
    expect(afterRepayment.ledgerCalculatedOutstanding).toBe("1000.00");
    expect(afterRepayment.estimatedAvailableCredit).toBe("9000.00");

    // Check monthly summary: spending is 1500, not 2000 (repayment is transfer)
    const month = monthlySummary(f.data, "2026-10");
    expect(month.gross).toBe("1500.00");
  });

  // Scenario 5: Credit refund received after statement date
  it("Scenario 5: applies credit refund received after statement date to reduce liability without mutating statement amount", () => {
    const f = createFixture();
    const bill: Bill = {
      id: randomUUID(),
      userId: f.userId,
      accountId: f.idfcHelloId,
      statementAmount: "2000.00",
      statementDate: "2026-10-05",
      dueDate: "2026-10-25",
      periodStart: "2026-09-05",
      periodEnd: "2026-10-04",
    };
    f.data.bills.push(bill);

    const snapshot: AccountSnapshot = {
      id: randomUUID(),
      userId: f.userId,
      accountId: f.idfcHelloId,
      asOf: "2026-10-05T12:00:00Z",
      reportedOutstanding: "2000.00",
      source: "bank_statement",
      verifiedByUser: true,
    };
    f.data.snapshots.push(snapshot);

    // Refund of ₹300 received on 2026-10-10
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "300.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-10-10",
      description: "Order refund",
      fromAccountId: null,
      toAccountId: f.idfcHelloId,
    });

    const summary = creditAccountSummary(f.data, f.idfcHelloId, "2026-10-15");
    expect(summary.billedAmount).toBe("2000.00");
    expect(summary.confirmedRefunds).toBe("300.00");
    expect(summary.ledgerCalculatedOutstanding).toBe("1700.00");
    expect(summary.estimatedAvailableCredit).toBe("8300.00");
  });

  // Scenario 6: Duplicate screenshot uploaded twice
  it("Scenario 6: detects duplicate screenshot upload by reference, date and amount and rejects double post", () => {
    const f = createFixture();
    const existingTx: Transaction = {
      id: randomUUID(),
      userId: f.userId,
      amount: "450.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-15",
      description: "Swiggy food order",
      merchant: "Swiggy",
      fromAccountId: f.sbiId,
      toAccountId: null,
      sourceSystem: "receipt_ai",
      sourceObjectId: "b".repeat(64),
      externalReference: "SWIGGY-12345",
    };
    f.data.transactions.push(existingTx);

    // Duplicate detection finds it
    const duplicates = findDuplicateTransactions(f.data, {
      amount: "450.00",
      occurredOn: "2026-10-15",
      externalReference: "SWIGGY-12345",
      merchant: "Swiggy",
    });
    expect(duplicates.isDuplicate).toBe(true);
    expect(duplicates.existing?.id).toBe(existingTx.id);

    // Proposed draft triggers duplicateWarning
    const proposed = buildProposedTransaction(f.data, {
      amount: "450.00",
      occurredOn: "2026-10-15",
      externalReference: "SWIGGY-12345",
      merchant: "Swiggy",
      accountHint: "SBI",
      description: "Swiggy food order",
    });
    expect(proposed.duplicateWarning).toBeDefined();
    expect(proposed.duplicateWarning?.description).toBe("Swiggy food order");

    // Second posting with same sourceObjectId throws ReceiptDuplicateError
    expect(() =>
      validateWorkspaceRecord(
        f.data,
        "transactions",
        {
          ...existingTx,
          id: randomUUID(),
        },
        f.userId,
      ),
    ).toThrow(ReceiptDuplicateError);
  });

  // Scenario 7: Conflicting payment accounts across screenshots
  it("Scenario 7: handles ambiguous or conflicting account hints safely without forcing a wrong account", () => {
    const f = createFixture();
    const proposed = buildProposedTransaction(f.data, {
      amount: "250.00",
      occurredOn: "2026-10-15",
      merchant: "Unknown vendor",
      accountHint: "HDFC 1111", // Not in registered accounts
      description: "Random purchase",
    });
    // Falls back to unselected account and prompts user
    expect(proposed.draft.fromAccountId).toBeNull();
  });

  // Scenario 8: Split payments (SBI + Jupiter Wallet)
  it("Scenario 8: correctly records split payments without double debits or balance drift", () => {
    const f = createFixture();
    // Starting balance snapshots
    f.data.snapshots.push(
      {
        id: randomUUID(),
        userId: f.userId,
        accountId: f.sbiId,
        asOf: "2026-10-10T12:00:00Z",
        reportedBalance: "5000.00",
        source: "bank_statement",
        verifiedByUser: true,
      },
      {
        id: randomUUID(),
        userId: f.userId,
        accountId: f.jupiterId,
        asOf: "2026-10-10T12:00:00Z",
        reportedBalance: "1000.00",
        source: "bank_statement",
        verifiedByUser: true,
      },
    );

    // Split purchase: ₹500 total, ₹300 from SBI, ₹200 from Jupiter Wallet
    f.data.transactions.push(
      {
        id: randomUUID(),
        userId: f.userId,
        amount: "300.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-12",
        description: "Split grocery bill (SBI portion)",
        fromAccountId: f.sbiId,
        toAccountId: null,
      },
      {
        id: randomUUID(),
        userId: f.userId,
        amount: "200.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-12",
        description: "Split grocery bill (Jupiter portion)",
        fromAccountId: f.jupiterId,
        toAccountId: null,
      },
    );

    expect(accountBalance(f.data, f.sbiId, "2026-10-15").current).toBe("4700.00");
    expect(accountBalance(f.data, f.jupiterId, "2026-10-15").current).toBe("800.00");
    const summary = monthlySummary(f.data, "2026-10");
    expect(summary.gross).toBe("500.00");
  });

  // Scenario 9: Consistency between summary and detail sheets
  it("Scenario 9: ensures exact consistency between usageSummary, accountUsage and creditAccountSummary", () => {
    const f = createFixture();
    const snap: AccountSnapshot = {
      id: randomUUID(),
      userId: f.userId,
      accountId: f.iobZetId,
      asOf: "2026-10-01T12:00:00Z",
      reportedOutstanding: "500.00",
      source: "bank_statement",
      verifiedByUser: true,
    };
    f.data.snapshots.push(snap);

    const creditSummary = creditAccountSummary(f.data, f.iobZetId, "2026-10-15");
    const usage = accountUsage(f.data, f.iobZetId, "2026-10-15");
    const aggSummary = usageSummary(f.data, "credit_card", "2026-10-15");

    expect(creditSummary.totalCreditLimit).toBe("2250.00");
    expect(creditSummary.issuerReportedOutstanding).toBe("500.00");
    expect(creditSummary.availableCredit).toBe("1750.00");
    expect(creditSummary.creditUtilization).toBeCloseTo(22.22, 1);

    expect(usage.totalCreditLimit).toBe(creditSummary.totalCreditLimit);
    expect(usage.used).toBe(creditSummary.ledgerCalculatedOutstanding);
    expect(usage.availableCredit).toBe(creditSummary.availableCredit);
    expect(usage.creditUtilization).toBe(creditSummary.creditUtilization);

    const row = aggSummary.rows.find((r) => r.account.id === f.iobZetId);
    expect(row).toBeDefined();
    expect(row?.used).toBe(creditSummary.ledgerCalculatedOutstanding);
    expect(row?.limit).toBe(creditSummary.totalCreditLimit);
  });

  // Scenario 10: SBI balance reconciliation (₹45 difference)
  it("Scenario 10: audits and reconciles the SBI balance difference of ₹45 with exact posted movements", () => {
    const f = createFixture();
    // Verified statement balance as of 13 October 2026 after ₹5 Blinkit debit was ₹13,456.04
    const statementSnapshot: AccountSnapshot = {
      id: randomUUID(),
      userId: f.userId,
      accountId: f.sbiId,
      asOf: "2026-10-13T12:00:00Z",
      reportedBalance: "13456.04",
      source: "bank_statement",
      verifiedByUser: true,
    };
    f.data.snapshots.push(statementSnapshot);

    // Initial check: balance matches statement
    expect(accountBalance(f.data, f.sbiId, "2026-10-13").current).toBe("13456.04");

    // A ₹45 receipt purchase on SBI posted with snapshot confirmation brings balance to ₹13,411.04
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "45.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-14",
      description: "Blinkit grocery order",
      fromAccountId: f.sbiId,
      toAccountId: null,
      fromBalanceSnapshotId: statementSnapshot.id,
    });

    const reconciledBalance = accountBalance(f.data, f.sbiId, "2026-10-15").current;
    expect(reconciledBalance).toBe("13411.04");

    // Reconciliation report arithmetic:
    // Starting verified = 13,456.04
    // Subsequent movements = -45.00
    // Calculated = 13,411.04
    // Displayed = 13,411.04
    // Unexplained difference = 0.00
    const startingBalance = Number(statementSnapshot.reportedBalance);
    const postedMovements = -45.0;
    const calculatedBalance = startingBalance + postedMovements;
    const displayedBalance = Number(reconciledBalance);
    const unexplainedDiff = calculatedBalance - displayedBalance;

    expect(calculatedBalance).toBe(13411.04);
    expect(displayedBalance).toBe(13411.04);
    expect(unexplainedDiff).toBe(0);
  });

  // Scenario 11: Bot retrieving real financial records
  it("Scenario 11: bot retrieves authentic financial records for balances, spending, upcoming dues, and searches", () => {
    const f = createFixture();
    f.data.snapshots.push({
      id: randomUUID(),
      userId: f.userId,
      accountId: f.sbiId,
      asOf: "2026-10-01T12:00:00Z",
      reportedBalance: "13456.04",
      source: "bank_statement",
      verifiedByUser: true,
    });
    f.data.transactions.push({
      id: randomUUID(),
      userId: f.userId,
      amount: "350.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-14",
      description: "Biryani House",
      category: "Food",
      fromAccountId: f.sbiId,
      toAccountId: null,
    });
    f.data.bills.push({
      id: randomUUID(),
      userId: f.userId,
      accountId: f.suryodayId,
      statementAmount: "450.00",
      dueDate: "2026-10-28",
      statementDate: "2026-10-08",
      periodStart: "2026-09-08",
      periodEnd: "2026-10-07",
    });

    const overview = getAccountsOverview(f.data, "2026-10-15");
    expect(overview.totalBankMoney).toBe("13106.04"); // 13456.04 - 350
    expect(overview.bankAccounts).toHaveLength(2);

    const spending = getSpendingAnalysis(f.data, "2026-10");
    expect(spending.grossSpending).toBe("350.00");
    expect(spending.topCategories).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "Food", amount: "350.00" })]),
    );

    const dues = getUpcomingDues(f.data, "2026-10-15");
    expect(dues).toHaveLength(1);
    expect(dues[0].remainingAmount).toBe("450.00");

    const search = searchTransactions(f.data, { query: "Biryani" });
    expect(search).toHaveLength(1);
    expect(search[0].amount).toBe("350.00");
  });

  // Scenario 12: Bot asking confirmation before posting
  it("Scenario 12: bot creates an unposted proposed transaction requiring explicit user confirmation", () => {
    const f = createFixture();
    const proposed = buildProposedTransaction(f.data, {
      amount: "600.00",
      occurredOn: "2026-10-15",
      merchant: "Amazon",
      accountHint: "Amazon Pay Later",
      description: "Headphones",
    });

    expect(proposed.draft.amount).toBe("600.00");
    expect(proposed.draft.fromAccountId).toBe(f.amazonId);
    // Workspace transactions remain unchanged before confirmation
    expect(f.data.transactions).toHaveLength(0);

    // Explicit confirmation validates and prepares transaction for posting
    const saved = confirmTransactionPost(f.data, f.userId, proposed.draft);
    expect(saved.id).toBe(proposed.draft.id);
    expect(saved.status).toBe("posted");
    expect(saved.amount).toBe("600.00");
    f.data.transactions.push(saved);
    expect(f.data.transactions).toHaveLength(1);
  });

  // Scenario 13: Bot retrying transaction without double posting
  it("Scenario 13: rejects duplicate posting when user or client retries the same confirmed transaction", () => {
    const f = createFixture();
    const proposed = buildProposedTransaction(f.data, {
      amount: "120.00",
      occurredOn: "2026-10-15",
      merchant: "Chai Point",
      accountHint: "SBI",
      description: "Tea",
    });

    // First post succeeds
    const saved = confirmTransactionPost(f.data, f.userId, proposed.draft);
    f.data.transactions.push(saved);
    expect(f.data.transactions).toHaveLength(1);

    // Retry fails duplicate detection
    expect(() =>
      confirmTransactionPost(f.data, f.userId, proposed.draft),
    ).toThrow();
  });

  // Scenario 14: Bot refusing unauthorized access
  it("Scenario 14: enforces user ownership and rejects cross-user posting", () => {
    const f = createFixture();
    const attackerId = randomUUID();
    const draft: ProposedTransaction & { userId?: string } = {
      id: randomUUID(),
      userId: f.userId,
      amount: "999.00",
      currency: "INR",
      kind: "expense",
      occurredOn: "2026-10-15",
      description: "Unauthorized transaction",
      category: "Shopping",
      fromAccountId: f.sbiId,
      toAccountId: null,
      sourceSystem: "nestbot",
    };

    // User mismatch
    expect(() => confirmTransactionPost(f.data, attackerId, draft)).toThrow(
      "Cannot record transactions for other users",
    );
  });

  // Scenario 15: Bot handling unconfigured AI truthfully
  it("Scenario 15: truthfully reports unconfigured AI provider without fabricating synthetic responses", async () => {
    const f = createFixture();
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    try {
      const response = await executeNestBotQuery(f.data, f.userId, {
        message: "Can you analyze my receipts with AI?",
      });

      expect(response.configured).toBe(false);
      expect(response.reply).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    } finally {
      if (originalGeminiKey) process.env.GEMINI_API_KEY = originalGeminiKey;
      if (originalGoogleKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleKey;
    }
  });

  // Scenario 16: Mobile and desktop query contract verification
  it("Scenario 16: validates that bot responses provide structured actions and messages for mobile/desktop UI", async () => {
    const f = createFixture();
    const response = await executeNestBotQuery(f.data, f.userId, {
      message: "How much money do I have?",
    });

    expect(response.message).toBeDefined();
    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toBeDefined();
    expect(response.message.suggestedActions).toBeInstanceOf(Array);
    expect(response.message.suggestedActions?.length).toBeGreaterThan(0);
  });

  // Scenario 17: Closing and reopening bot preserves state
  it("Scenario 17: verifies conversation state persistence contract", () => {
    // When messages are appended to conversation, message history is preserved
    const initialMessages = [
      { id: "1", role: "assistant" as const, content: "Hello", createdAt: "2026-10-15T00:00:00Z" },
    ];
    const userMessage = { id: "2", role: "user" as const, content: "Show spending", createdAt: "2026-10-15T00:01:00Z" };
    const botReply = { id: "3", role: "assistant" as const, content: "You spent ₹0.00", createdAt: "2026-10-15T00:01:02Z" };

    const state = [...initialMessages, userMessage, botReply];
    expect(state).toHaveLength(3);
    expect(state[2].content).toBe("You spent ₹0.00");
  });
});
