import { describe, expect, it, vi } from "vitest";
import { sanitizeWorkspaceTransactions } from "../src/lib/workspace-cleaner";
import { accountBalance } from "../src/lib/finance";
import { accountUsage } from "../src/lib/usage";
import type { Account, WorkspaceData, Transaction } from "../src/lib/types";

vi.mock("server-only", () => ({}));

describe("IOB ZET RuPay Credit Card Reconciliation", () => {
  const userId = "4aed7ac5-23e7-4878-aa7a-13ad6d24b597";
  const sbiAccountId = "c2010001-0001-4000-8000-000000000001";
  const iobAccountId = "91a03483-ffae-59a8-ae34-9a66df28395f";

  const createInitialWorkspace = (): WorkspaceData => {
    const accounts: Account[] = [
      {
        id: sbiAccountId,
        userId,
        name: "State Bank of India",
        institution: "SBI",
        kind: "bank",
        maskedSuffix: "6338",
        openingBalance: "50000.00",
        openingBalanceDate: "2026-10-01",
        active: true,
      },
      {
        id: iobAccountId,
        userId,
        name: "IOB Credit Card",
        institution: "Indian Overseas Bank",
        kind: "credit_card",
        maskedSuffix: "1967",
        creditLimit: "2250.00",
        openingBalance: "836.60", // previous corrupt opening balance
        openingBalanceDate: "2026-10-16",
        active: true,
      },
    ];

    const transactions: Transaction[] = [
      {
        id: "df50998d-a0a1-4793-b743-3916a3bd17ab",
        userId,
        amount: "1273.00",
        currency: "INR",
        kind: "bill_payment",
        status: "posted",
        occurredOn: "2026-10-21",
        description: "IOB Credit Card Bill Payment via POP",
        fromAccountId: sbiAccountId,
        toAccountId: iobAccountId,
        category: "Credit Card Payment",
        platform: "POP",
      },
      {
        id: "tx-amazon-ruffpad-001",
        userId,
        amount: "479.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-21",
        description: "Amazon · RuffPad 8.5 LCD",
        fromAccountId: iobAccountId,
        toAccountId: null,
        category: "Shopping",
        platform: "Amazon",
      },
      {
        id: "tx-aman-enterprises-002",
        userId,
        amount: "66.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-11-02",
        description: "Aman Enterprises",
        fromAccountId: iobAccountId,
        toAccountId: null,
        category: "Shopping",
      },
    ];

    return {
      accounts,
      snapshots: [],
      transactions,
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
  };

  it("clears corrupt opening balance and establishes 2250 credit limit", () => {
    const raw = createInitialWorkspace();
    const sanitized = sanitizeWorkspaceTransactions(raw);

    const iob = sanitized.accounts.find((a) => a.id === iobAccountId);
    expect(iob).toBeDefined();
    expect(iob?.creditLimit).toBe("2250.00");
    expect(iob?.openingBalance).toBeNull();
    expect(iob?.openingBalanceDate).toBeNull();
  });

  it("creates historical statement snapshots for 20 Aug, 20 Sep, 20 Oct, and checkpoint 02 Nov", () => {
    const raw = createInitialWorkspace();
    const sanitized = sanitizeWorkspaceTransactions(raw);

    const augSnap = sanitized.snapshots.find(
      (s) => s.accountId === iobAccountId && s.asOf.startsWith("2026-08-20"),
    );
    expect(augSnap).toBeDefined();
    expect(augSnap?.reportedOutstanding).toBe("139.10");

    const sepSnap = sanitized.snapshots.find(
      (s) => s.accountId === iobAccountId && s.asOf.startsWith("2026-09-20"),
    );
    expect(sepSnap).toBeDefined();
    expect(sepSnap?.reportedOutstanding).toBe("674.10");

    const octSnap = sanitized.snapshots.find(
      (s) => s.accountId === iobAccountId && s.asOf.startsWith("2026-10-20"),
    );
    expect(octSnap).toBeDefined();
    expect(octSnap?.reportedOutstanding).toBe("1269.40");
    expect(octSnap?.reportedAvailable).toBe("980.60");

    const novSnap = sanitized.snapshots.find(
      (s) => s.accountId === iobAccountId && s.asOf.startsWith("2026-11-02"),
    );
    expect(novSnap).toBeDefined();
    expect(novSnap?.reportedOutstanding).toBe("539.40");
    expect(novSnap?.reportedAvailable).toBe("1710.60");
  });

  it("verifies October statement reconciliation formula: 674.10 - 1630.19 + 2225.49 = 1269.40", () => {
    const prevBalance = 674.10;
    const paymentsAndCredits = 1630.19;
    const purchasesAndDebits = 2225.49;
    const calculatedClosing = prevBalance - paymentsAndCredits + purchasesAndDebits;

    expect(Number(calculatedClosing.toFixed(2))).toBe(1269.40);
  });

  it("handles composite POP bill settlement: SBI cash 1,273 + POP discount 2 = Card 1,275", () => {
    const raw = createInitialWorkspace();
    const sanitized = sanitizeWorkspaceTransactions(raw);

    // 1. Primary payment from SBI remains 1273
    const sbiPayment = sanitized.transactions.find(
      (t) => t.id === "df50998d-a0a1-4793-b743-3916a3bd17ab",
    );
    expect(sbiPayment).toBeDefined();
    expect(sbiPayment?.amount).toBe("1273.00");
    expect(sbiPayment?.fromAccountId).toBe(sbiAccountId);
    expect(sbiPayment?.toAccountId).toBe(iobAccountId);
    expect(sbiPayment?.discountProvider).toBe("POP");
    expect(sbiPayment?.discountAmount).toBe("2.00");

    // 2. POP discount adjustment of 2.00
    const popAdj = sanitized.transactions.find(
      (t) =>
        t.parentTransactionId === "df50998d-a0a1-4793-b743-3916a3bd17ab" ||
        (t.kind === "adjustment" && t.toAccountId === iobAccountId && t.amount === "2.00"),
    );
    expect(popAdj).toBeDefined();
    expect(popAdj?.amount).toBe("2.00");
    expect(popAdj?.fromAccountId).toBeNull(); // Non-cash credit subsidy
    expect(popAdj?.toAccountId).toBe(iobAccountId);
    expect(popAdj?.platform).toBe("POP");

    // 3. Combined credit on card is 1,275.00
    const cardRepaymentMovements = sanitized.transactions.filter(
      (t) =>
        t.toAccountId === iobAccountId &&
        t.status === "posted" &&
        (t.kind === "bill_payment" || t.kind === "adjustment"),
    );
    const totalCardCredit = cardRepaymentMovements.reduce(
      (sum, t) => sum + Number(t.amount),
      0,
    );
    expect(totalCardCredit).toBe(1275.00);

    // 4. Bank debit is only 1,273.00
    const bankDebits = sanitized.transactions.filter(
      (t) => t.fromAccountId === sbiAccountId && t.id === "df50998d-a0a1-4793-b743-3916a3bd17ab",
    );
    expect(bankDebits.reduce((sum, t) => sum + Number(t.amount), 0)).toBe(1273.00);
  });

  it("allocates 1269.40 to October statement bill, marking it fully settled", () => {
    const raw = createInitialWorkspace();
    const sanitized = sanitizeWorkspaceTransactions(raw);

    const octBill = sanitized.bills.find(
      (b) => b.accountId === iobAccountId && b.statementDate === "2026-10-20",
    );
    expect(octBill).toBeDefined();
    expect(octBill?.statementAmount).toBe("1269.40");

    const alloc = sanitized.allocations.find((a) => a.billId === octBill?.id);
    expect(alloc).toBeDefined();
    expect(alloc?.amount).toBe("1269.40");
    expect(alloc?.transactionId).toBe("df50998d-a0a1-4793-b743-3916a3bd17ab");
  });

  it("calculates accurate post-statement position as of 02 Nov 2026", () => {
    const raw = createInitialWorkspace();
    const sanitized = sanitizeWorkspaceTransactions(raw);

    // Reconciled math from 20 Oct statement:
    // Statement: 1,269.40
    // + Amazon: 479.00
    // - SBI Cash: 1,273.00
    // - POP Discount: 2.00
    // + Aman: 66.00
    // = 539.40
    const usage = accountUsage(sanitized, iobAccountId, "2026-11-02");
    expect(usage.used).toBe("539.40");
    expect(usage.currentOutstanding).toBe("539.40");
    expect(usage.available).toBe("1710.60");
    expect(usage.availableCredit).toBe("1710.60");
    expect(usage.billedAmount).toBe("0.00"); // fully paid
    expect(usage.unbilledAmount).toBe("539.40");

    // Utilization: 539.40 / 2250.00 = 23.97%
    expect(usage.percentage).toBeCloseTo(23.97, 1);
    expect(usage.creditUtilization).toBeCloseTo(23.97, 1);

    const balance = accountBalance(sanitized, iobAccountId, "2026-11-02");
    expect(balance.current).toBe("539.40");
  });

  it("is strictly idempotent over multiple sanitization passes", () => {
    const raw = createInitialWorkspace();
    const pass1 = sanitizeWorkspaceTransactions(raw);
    const pass2 = sanitizeWorkspaceTransactions(pass1);

    const popAdjustments = pass2.transactions.filter(
      (t) =>
        t.toAccountId === iobAccountId &&
        t.kind === "adjustment" &&
        t.amount === "2.00",
    );
    expect(popAdjustments).toHaveLength(1);

    const octBills = pass2.bills.filter(
      (b) => b.accountId === iobAccountId && b.statementDate === "2026-10-20",
    );
    expect(octBills).toHaveLength(1);

    const novSnapshots = pass2.snapshots.filter(
      (s) => s.accountId === iobAccountId && s.asOf.startsWith("2026-11-02"),
    );
    expect(novSnapshots).toHaveLength(1);
  });
});
