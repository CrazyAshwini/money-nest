import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "../src/lib/types";
import {
  formatSignedTransactionAmount,
  formatTransactionDateHeading,
  groupTransactionsByDate,
  isRecordedDate,
} from "../src/components/unified-transaction-history";
import { getRecentAccountTransactions } from "../src/lib/account-presentation";

describe("Unified Transaction History UI - Date Grouping & Formatting", () => {
  it("validates recorded date format YYYY-MM-DD", () => {
    expect(isRecordedDate("2026-10-18")).toBe(true);
    expect(isRecordedDate("2026-02-29")).toBe(false); // Not a leap year
    expect(isRecordedDate("2026-10-18T10:00:00Z")).toBe(false);
    expect(isRecordedDate("invalid")).toBe(false);
    expect(isRecordedDate(null)).toBe(false);
    expect(isRecordedDate(undefined)).toBe(false);
  });

  it("formats date heading consistently", () => {
    expect(formatTransactionDateHeading("2026-10-18")).toContain("18 October 2026");
    expect(formatTransactionDateHeading(null)).toBe("Date unconfirmed");
    expect(formatTransactionDateHeading("__unavailable__")).toBe("Date unconfirmed");
    expect(formatTransactionDateHeading("not-a-date")).toBe("Date unavailable");
  });

  it("groups multiple transactions on the same date into a single date card", () => {
    const transactions: Transaction[] = [
      {
        id: "tx-1",
        userId: "user-1",
        occurredOn: "2026-10-18",
        amount: "30509.79",
        currency: "INR",
        kind: "expense",
        status: "posted",
        merchant: "Amazon",
        description: "Samsung 43-inch television",
        category: "Electronics",
        platform: "Amazon",
        fromAccountId: "acc-paylater",
        toAccountId: null,
      },
      {
        id: "tx-2",
        userId: "user-1",
        occurredOn: "2026-10-18",
        amount: "50.00",
        currency: "INR",
        kind: "transfer",
        status: "posted",
        merchant: "Suryoday Small",
        description: "Wallet reload",
        category: "Utilities",
        platform: "Paisabazaar",
        fromAccountId: "acc-wallet",
        toAccountId: "acc-card",
      },
      {
        id: "tx-3",
        userId: "user-1",
        occurredOn: "2026-10-18",
        amount: "384.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        merchant: "Food Purchase",
        description: "Dinner",
        category: "Food",
        platform: null,
        fromAccountId: "acc-bank",
        toAccountId: null,
      },
      {
        id: "tx-4",
        userId: "user-1",
        occurredOn: "2026-10-17",
        amount: "120.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        merchant: "Monginis",
        description: "Bakery",
        category: "Food",
        platform: "Swiggy",
        fromAccountId: "acc-bank",
        toAccountId: null,
      },
    ];

    const groups = groupTransactionsByDate(transactions, "newest");

    // Exactly 2 date groups: 18 Oct 2026 and 17 Oct 2026
    expect(groups).toHaveLength(2);

    expect(groups[0].dateKey).toBe("2026-10-18");
    expect(groups[0].dateLabel).toContain("18 October 2026");
    expect(groups[0].transactions).toHaveLength(3); // All 3 txs on 18 Oct inside the same container
    expect(groups[0].transactions.map((t) => t.id)).toEqual(["tx-1", "tx-2", "tx-3"]);

    expect(groups[1].dateKey).toBe("2026-10-17");
    expect(groups[1].dateLabel).toContain("17 October 2026");
    expect(groups[1].transactions).toHaveLength(1);
    expect(groups[1].transactions[0].id).toBe("tx-4");
  });

  it("supports sorting date groups oldest first", () => {
    const transactions: Transaction[] = [
      {
        id: "tx-1",
        userId: "user-1",
        occurredOn: "2026-10-18",
        amount: "100.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        merchant: "A",
        description: "A",
        fromAccountId: "acc-1",
        toAccountId: null,
      },
      {
        id: "tx-2",
        userId: "user-1",
        occurredOn: "2026-10-05",
        amount: "200.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        merchant: "B",
        description: "B",
        fromAccountId: "acc-1",
        toAccountId: null,
      },
    ];

    const oldest = groupTransactionsByDate(transactions, "oldest");
    expect(oldest[0].dateKey).toBe("2026-10-05");
    expect(oldest[1].dateKey).toBe("2026-10-18");

    const newest = groupTransactionsByDate(transactions, "newest");
    expect(newest[0].dateKey).toBe("2026-10-18");
    expect(newest[1].dateKey).toBe("2026-10-05");
  });

  it("places undated or unavailable transactions at the end of the date list", () => {
    const transactions: Transaction[] = [
      {
        id: "tx-dated",
        userId: "user-1",
        occurredOn: "2026-10-18",
        amount: "100.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        merchant: "Dated",
        description: "Dated",
        fromAccountId: "acc-1",
        toAccountId: null,
      },
      {
        id: "tx-undated",
        userId: "user-1",
        occurredOn: null,
        amount: "500.00",
        currency: "INR",
        kind: "expense",
        status: "pending_review",
        merchant: "Undated",
        description: "Undated",
        fromAccountId: "acc-1",
        toAccountId: null,
      },
    ];

    const groups = groupTransactionsByDate(transactions, "newest");
    expect(groups).toHaveLength(2);
    expect(groups[0].dateKey).toBe("2026-10-18");
    expect(groups[1].dateKey).toBe("__unconfirmed__");
    expect(groups[1].dateLabel).toBe("Date unconfirmed");
  });
});

describe("Unified Transaction History UI - Amount & Semantic Formatting", () => {
  it("formats expense amounts with − sign and dark tone", () => {
    const tx: Transaction = {
      id: "tx-exp",
      userId: "user-1",
      occurredOn: "2026-10-18",
      amount: "120.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      merchant: "Swiggy",
      description: "Food",
      fromAccountId: "acc-bank",
      toAccountId: null,
    };

    const result = formatSignedTransactionAmount(tx);
    expect(result.sign).toBe("−");
    expect(result.formatted).toBe("−₹120.00");
    expect(result.tone).toBe("outgoing");
  });

  it("formats income amounts with + sign and incoming green tone", () => {
    const tx: Transaction = {
      id: "tx-inc",
      userId: "user-1",
      occurredOn: "2026-10-01",
      amount: "1500.00",
      currency: "INR",
      kind: "income",
      status: "posted",
      merchant: "Employer",
      description: "Salary",
      fromAccountId: null,
      toAccountId: "acc-bank",
    };

    const result = formatSignedTransactionAmount(tx);
    expect(result.sign).toBe("+");
    expect(result.formatted).toBe("+₹1,500.00");
    expect(result.tone).toBe("incoming");
  });

  it("formats inter-account transfers with ↔ sign and between tone in global view", () => {
    const tx: Transaction = {
      id: "tx-trf",
      userId: "user-1",
      occurredOn: "2026-10-18",
      amount: "50.00",
      currency: "INR",
      kind: "transfer",
      status: "posted",
      merchant: "Self",
      description: "Wallet transfer",
      fromAccountId: "acc-wallet",
      toAccountId: "acc-card",
    };

    const result = formatSignedTransactionAmount(tx);
    expect(result.sign).toBe("↔ ");
    expect(result.formatted).toBe("↔ ₹50.00");
    expect(result.tone).toBe("between");
  });

  it("formats transfers from an account's perspective when currentAccountId is provided", () => {
    const tx: Transaction = {
      id: "tx-trf",
      userId: "user-1",
      occurredOn: "2026-10-18",
      amount: "675.00",
      currency: "INR",
      kind: "bill_payment",
      status: "posted",
      merchant: "BBPS",
      description: "Card Payment",
      fromAccountId: "acc-sbi",
      toAccountId: "acc-zet",
    };

    // From SBI's perspective: outgoing money (−₹675.00)
    const fromSbi = formatSignedTransactionAmount(tx, "acc-sbi");
    expect(fromSbi.sign).toBe("−");
    expect(fromSbi.formatted).toBe("−₹675.00");
    expect(fromSbi.tone).toBe("outgoing");

    // From ZET's perspective: incoming payment (+₹675.00)
    const toZet = formatSignedTransactionAmount(tx, "acc-zet");
    expect(toZet.sign).toBe("+");
    expect(toZet.formatted).toBe("+₹675.00");
    expect(toZet.tone).toBe("incoming");
  });

  it("preserves exact paise arithmetic in formatted amounts", () => {
    const tx: Transaction = {
      id: "tx-paise",
      userId: "user-1",
      occurredOn: "2026-10-18",
      amount: "30509.79",
      currency: "INR",
      kind: "expense",
      status: "posted",
      merchant: "Amazon",
      description: "Samsung TV",
      fromAccountId: "acc-paylater",
      toAccountId: null,
    };

    const result = formatSignedTransactionAmount(tx);
    expect(result.formatted).toBe("−₹30,509.79");
  });
});

describe("Unified Transaction History UI - Account Details & Recent Preview", () => {
  it("filters and limits recent transactions for a selected account", () => {
    const accounts: Account[] = [
      { id: "acc-sbi", userId: "u1", name: "SBI Savings", institution: "SBI", kind: "bank", maskedSuffix: "1234", active: true },
      { id: "acc-zet", userId: "u1", name: "IOB ZET", institution: "IOB", kind: "credit_card", maskedSuffix: "1967", active: true },
    ];

    const transactions: Transaction[] = [
      {
        id: "tx-1",
        userId: "u1",
        occurredOn: "2026-10-15",
        amount: "500.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        description: "Grocery",
        fromAccountId: "acc-sbi",
        toAccountId: null,
      },
      {
        id: "tx-2",
        userId: "u1",
        occurredOn: "2026-10-16",
        amount: "166.54",
        currency: "INR",
        kind: "expense",
        status: "posted",
        description: "Zomato",
        fromAccountId: "acc-zet",
        toAccountId: null,
      },
      {
        id: "tx-3",
        userId: "u1",
        occurredOn: "2026-10-17",
        amount: "164.00",
        currency: "INR",
        kind: "expense",
        status: "posted",
        description: "Blinkit",
        fromAccountId: "acc-zet",
        toAccountId: null,
      },
    ];

    // Query for ZET credit card only
    const zetRecent = getRecentAccountTransactions(
      { accounts, transactions },
      "acc-zet",
      4,
    );

    expect(zetRecent).toHaveLength(2);
    expect(zetRecent.every((t) => t.fromAccountId === "acc-zet" || t.toAccountId === "acc-zet")).toBe(true);
    expect(zetRecent[0].id).toBe("tx-3"); // 17 Oct (newest first)
    expect(zetRecent[1].id).toBe("tx-2"); // 16 Oct
  });

  it("formats transactions with long descriptions without corrupting data or amount formatting", () => {
    const longDescTx: Transaction = {
      id: "tx-long-desc",
      userId: "u1",
      occurredOn: "2026-10-25",
      amount: "410.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      merchant: "Homestrap Adhesive Hooks, Happilo Kimia Dates, Vadilal Matka Kulfi, Sunfeast Bounce",
      description: "Homestrap Adhesive Hooks, Happilo Kimia Dates, Vadilal Matka Kulfi, Sunfeast Bounce",
      category: "Groceries",
      platform: "Blinkit",
      fromAccountId: "acc-sbi",
      toAccountId: null,
    };

    const { formatted, tone, sign } = formatSignedTransactionAmount(longDescTx);
    expect(sign).toBe("−");
    expect(formatted).toBe("−₹410.00");
    expect(tone).toBe("outgoing");
    expect(longDescTx.merchant!.length).toBeGreaterThan(60);
  });
});
