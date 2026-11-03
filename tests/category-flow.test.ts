import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATALOG_CATEGORIES,
  INCOME_CATALOG_CATEGORIES,
  BILL_REPAYMENT_CATALOG_CATEGORIES,
  TRANSFER_CATALOG_CATEGORIES,
  REFUND_CATALOG_CATEGORIES,
  getCategoriesForKind,
  getSubcategoriesForCategory,
  getDefaultCategoryForKind,
  isCategoryValidForKind,
  transactionTypeLabel,
  getCategoryPlatformOptions,
  OTHER_PLATFORM,
} from "../src/lib/category-platforms";
import { CATEGORIES, type Transaction, type WorkspaceData } from "../src/lib/types";
import { EVERYDAY_TRANSACTION_KINDS } from "../src/components/editors";
import { validateWorkspaceRecord } from "../src/lib/validation";
import { accountBalance, computeEqualShares, consumptionAmount, groupSummary } from "../src/lib/finance";

const USER_ID = "4aed7ac5-23e7-4878-aa7a-13ad6d24b597";
const BANK_1_ID = "2e84b7fc-dc55-4052-a087-7910619c3f2e";
const BANK_2_ID = "a4efa024-1d0c-59a2-aabd-c330a661be77";
const CARD_1_ID = "5d9bc626-5ee8-514f-a2ff-fca8b5618b74";
const PAYLATER_1_ID = "476fa60a-ab35-5769-a18c-839e8a88d283";

function mockWorkspace(): WorkspaceData {
  return {
    accounts: [
      {
        id: BANK_1_ID,
        userId: USER_ID,
        name: "ICICI Bank",
        institution: "ICICI Bank",
        kind: "bank",
        maskedSuffix: "3888",
        openingBalance: "10000.00",
        openingBalanceDate: "2026-10-01",
        active: true,
      },
      {
        id: BANK_2_ID,
        userId: USER_ID,
        name: "SBI Savings",
        institution: "State Bank of India",
        kind: "bank",
        maskedSuffix: "1234",
        openingBalance: "5000.00",
        openingBalanceDate: "2026-10-01",
        active: true,
      },
      {
        id: CARD_1_ID,
        userId: USER_ID,
        name: "ICICI Sapphiro Credit Card",
        institution: "ICICI Bank",
        kind: "credit_card",
        maskedSuffix: "5005",
        creditLimit: "100000.00",
        openingBalance: "0.00",
        openingBalanceDate: "2026-10-01",
        active: true,
      },
      {
        id: PAYLATER_1_ID,
        userId: USER_ID,
        name: "Amazon Pay Later",
        institution: "Axio",
        kind: "pay_later",
        maskedSuffix: "9999",
        creditLimit: "25000.00",
        openingBalance: "0.00",
        openingBalanceDate: "2026-10-01",
        active: true,
      },
    ],
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
}

describe("Everyday transaction types", () => {
  it("presents the 5 transaction types in the exact order and labels", () => {
    expect(EVERYDAY_TRANSACTION_KINDS).toEqual([
      { kind: "expense", label: "Expense" },
      { kind: "income", label: "Income" },
      { kind: "bill_payment", label: "Bill Repayment" },
      { kind: "transfer", label: "Transfer" },
      { kind: "refund", label: "Refund / Money Back" },
    ]);
  });

  it("formats human-readable labels for all transaction types", () => {
    expect(transactionTypeLabel("expense")).toBe("Expense");
    expect(transactionTypeLabel("income")).toBe("Income");
    expect(transactionTypeLabel("bill_payment")).toBe("Bill Repayment");
    expect(transactionTypeLabel("transfer")).toBe("Transfer");
    expect(transactionTypeLabel("refund")).toBe("Refund / Money Back");
    expect(transactionTypeLabel("adjustment")).toBe("Adjustment");
  });
});

describe("Context-aware category catalog", () => {
  it("provides correct categories for Expense with Food & Drinks, Utilities, and Stationery preserved", () => {
    const expenseCategories = getCategoriesForKind("expense");
    expect(expenseCategories).toEqual(EXPENSE_CATALOG_CATEGORIES);
    expect(expenseCategories).toContain("Food & Drinks");
    expect(expenseCategories).toContain("Utilities");
    expect(expenseCategories).toContain("Education");
    expect(expenseCategories).toContain("Gift Given");
    expect(expenseCategories).toContain("Personal Care");
    expect(expenseCategories).toContain("Housing");
    expect(expenseCategories).toContain("Other");

    // Backward compatibility: legacy Stationery preserved if present on record
    const withStationery = getCategoriesForKind("expense", "Stationery");
    expect(withStationery).toContain("Stationery");
    expect(CATEGORIES).toContain("Stationery");
  });

  it("provides correct categories for Income", () => {
    const incomeCategories = getCategoriesForKind("income");
    expect(incomeCategories).toEqual(INCOME_CATALOG_CATEGORIES);
    expect(incomeCategories).toContain("Salary / Fellowship");
    expect(incomeCategories).toContain("Gift Received");
    expect(incomeCategories).toContain("Business / Freelance");
    expect(incomeCategories).toContain("Interest / Rewards");
    expect(incomeCategories).toContain("Investment Income");
    expect(incomeCategories).toContain("Other Income");
  });

  it("provides correct categories for Bill Repayment", () => {
    const billCategories = getCategoriesForKind("bill_payment");
    expect(billCategories).toEqual(BILL_REPAYMENT_CATALOG_CATEGORIES);
    expect(billCategories).toContain("Credit Card Payment");
    expect(billCategories).toContain("Pay Later Payment");
    expect(billCategories).toContain("Loan EMI");
  });

  it("provides correct categories for Transfer", () => {
    const transferCategories = getCategoriesForKind("transfer");
    expect(transferCategories).toEqual(TRANSFER_CATALOG_CATEGORIES);
    expect(transferCategories).toContain("Own Account Transfer");
    expect(transferCategories).toContain("Wallet Top-up");
    expect(transferCategories).toContain("Savings / Investment");
    expect(transferCategories).toContain("Cash Withdrawal / Deposit");
  });

  it("provides correct categories for Refund / Money Back", () => {
    const refundCategories = getCategoriesForKind("refund");
    expect(refundCategories).toEqual(REFUND_CATALOG_CATEGORIES);
    expect(refundCategories).toContain("Purchase Refund");
    expect(refundCategories).toContain("Split Bill Reimbursement");
    expect(refundCategories).toContain("Overpayment Refund");
    expect(refundCategories).toContain("Other Money Back");
  });

  it("offers sensible default categories for each transaction kind", () => {
    expect(getDefaultCategoryForKind("expense")).toBe("Food & Drinks");
    expect(getDefaultCategoryForKind("income")).toBe("Salary / Fellowship");
    expect(getDefaultCategoryForKind("bill_payment")).toBe("Credit Card Payment");
    expect(getDefaultCategoryForKind("transfer")).toBe("Own Account Transfer");
    expect(getDefaultCategoryForKind("refund")).toBe("Purchase Refund");
  });

  it("accurately validates category belonging to transaction kinds", () => {
    expect(isCategoryValidForKind("expense", "Food & Drinks")).toBe(true);
    expect(isCategoryValidForKind("expense", "Utilities")).toBe(true);
    expect(isCategoryValidForKind("expense", "Salary / Fellowship")).toBe(false);

    expect(isCategoryValidForKind("income", "Salary / Fellowship")).toBe(true);
    expect(isCategoryValidForKind("income", "Interest / Rewards")).toBe(true);
    expect(isCategoryValidForKind("income", "Food & Drinks")).toBe(false);

    expect(isCategoryValidForKind("bill_payment", "Credit Card Payment")).toBe(true);
    expect(isCategoryValidForKind("bill_payment", "Pay Later Payment")).toBe(true);
    expect(isCategoryValidForKind("bill_payment", "Salary / Fellowship")).toBe(false);
  });
});

describe("Subcategories handling", () => {
  it("provides subcategories only for categories with meaningful subcategories", () => {
    expect(getSubcategoriesForCategory("expense", "Food & Drinks")).toEqual([
      "Groceries",
      "Restaurant",
      "Snacks",
    ]);
    expect(getSubcategoriesForCategory("expense", "Shopping")).toEqual([
      "Clothing",
      "Electronics",
      "Household",
    ]);
    expect(getSubcategoriesForCategory("expense", "Transport")).toEqual([
      "Auto/Cab",
      "Bus/Train",
      "Fuel",
    ]);
    expect(getSubcategoriesForCategory("expense", "Utilities")).toEqual([
      "Electricity",
      "Mobile Recharge",
      "Internet",
      "Water",
    ]);
    expect(getSubcategoriesForCategory("expense", "Education")).toEqual([
      "Books",
      "Stationery",
      "Courses",
    ]);
    expect(getSubcategoriesForCategory("expense", "Housing")).toEqual([
      "Rent",
      "Maintenance",
    ]);

    // Categories without subcategories return an empty array
    expect(getSubcategoriesForCategory("expense", "Gift Given")).toEqual([]);
    expect(getSubcategoriesForCategory("expense", "Personal Care")).toEqual([]);
    expect(getSubcategoriesForCategory("expense", "Other")).toEqual([]);

    // Non-expense categories do not have subcategories
    expect(getSubcategoriesForCategory("income", "Salary / Fellowship")).toEqual([]);
    expect(getSubcategoriesForCategory("bill_payment", "Credit Card Payment")).toEqual([]);
    expect(getSubcategoriesForCategory("transfer", "Own Account Transfer")).toEqual([]);
  });

  it("supports legacy alias Food with the same subcategories as Food & Drinks", () => {
    expect(getSubcategoriesForCategory("expense", "Food")).toEqual([
      "Groceries",
      "Restaurant",
      "Snacks",
    ]);
  });
});

describe("Platform options and separation", () => {
  it("provides preset platforms for Food & Drinks, Gift Given, and Personal Care", () => {
    const foodPlatforms = getCategoryPlatformOptions("Food & Drinks");
    expect(foodPlatforms).toContain("Swiggy");
    expect(foodPlatforms).toContain("Zomato");
    expect(foodPlatforms).toContain("Blinkit");
    expect(foodPlatforms.at(-1)).toBe(OTHER_PLATFORM);

    const giftPlatforms = getCategoryPlatformOptions("Gift Given");
    expect(giftPlatforms).toContain("Amazon");
    expect(giftPlatforms.at(-1)).toBe(OTHER_PLATFORM);

    const carePlatforms = getCategoryPlatformOptions("Personal Care");
    expect(carePlatforms).toContain("Nykaa");
    expect(carePlatforms.at(-1)).toBe(OTHER_PLATFORM);
  });
});

describe("Account and ledger validation across transaction types", () => {
  it("accepts an Expense transaction with Utilities category and subcategory Mobile Recharge", () => {
    const ws = mockWorkspace();
    const txn: Transaction = {
      id: "90000000-0000-4000-8000-000000000001",
      userId: USER_ID,
      amount: "299.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Jio Mobile Recharge",
      fromAccountId: BANK_1_ID,
      toAccountId: null,
      category: "Utilities",
      subcategory: "Mobile Recharge",
      platform: "Jio",
      merchant: "Reliance Jio",
      externalPayer: null,
      externalReference: "UPI-JIO-123",
      refundOfTransactionId: null,
      notes: null,
    };

    const validated = validateWorkspaceRecord(ws, "transactions", txn, USER_ID);
    expect(validated.category).toBe("Utilities");
    expect(validated.subcategory).toBe("Mobile Recharge");
  });

  it("validates that Credit Card Payment destination must be a credit card account", () => {
    const ws = mockWorkspace();
    const badTxn: Transaction = {
      id: "90000000-0000-4000-8000-000000000002",
      userId: USER_ID,
      amount: "2000.00",
      currency: "INR",
      kind: "bill_payment",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Credit card payment",
      fromAccountId: BANK_1_ID,
      toAccountId: PAYLATER_1_ID, // Wrong! Destination is Pay Later, not credit card
      category: "Credit Card Payment",
      subcategory: null,
      platform: null,
      merchant: null,
      externalPayer: null,
      externalReference: null,
      refundOfTransactionId: null,
      notes: null,
    };

    expect(() =>
      validateWorkspaceRecord(ws, "transactions", badTxn, USER_ID),
    ).toThrowError("Credit Card Payment destination must be a credit card account.");

    // With correct credit card destination
    const goodTxn: Transaction = {
      ...badTxn,
      toAccountId: CARD_1_ID,
    };
    const validated = validateWorkspaceRecord(ws, "transactions", goodTxn, USER_ID);
    expect(validated.toAccountId).toBe(CARD_1_ID);
  });

  it("validates that Pay Later Payment destination must be a Pay Later account", () => {
    const ws = mockWorkspace();
    const badTxn: Transaction = {
      id: "90000000-0000-4000-8000-000000000003",
      userId: USER_ID,
      amount: "170.00",
      currency: "INR",
      kind: "bill_payment",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Meesho bill payment",
      fromAccountId: BANK_1_ID,
      toAccountId: CARD_1_ID, // Wrong! Destination is a credit card, not Pay Later
      category: "Pay Later Payment",
      subcategory: null,
      platform: null,
      merchant: null,
      externalPayer: null,
      externalReference: null,
      refundOfTransactionId: null,
      notes: null,
    };

    expect(() =>
      validateWorkspaceRecord(ws, "transactions", badTxn, USER_ID),
    ).toThrowError("Pay Later Payment destination must be a Pay Later account.");

    // With correct Pay Later destination
    const goodTxn: Transaction = {
      ...badTxn,
      toAccountId: PAYLATER_1_ID,
    };
    const validated = validateWorkspaceRecord(ws, "transactions", goodTxn, USER_ID);
    expect(validated.toAccountId).toBe(PAYLATER_1_ID);
  });

  it("rejects transfer with identical source and destination accounts", () => {
    const ws = mockWorkspace();
    const badTxn: Transaction = {
      id: "90000000-0000-4000-8000-000000000004",
      userId: USER_ID,
      amount: "1000.00",
      currency: "INR",
      kind: "transfer",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Transfer to self",
      fromAccountId: BANK_1_ID,
      toAccountId: BANK_1_ID, // Same account!
      category: "Own Account Transfer",
      subcategory: null,
      platform: null,
      merchant: null,
      externalPayer: null,
      externalReference: null,
      refundOfTransactionId: null,
      notes: null,
    };

    expect(() =>
      validateWorkspaceRecord(ws, "transactions", badTxn, USER_ID),
    ).toThrowError("The source and destination must be different accounts.");
  });

  it("records Income (Gift Received) increasing the receiving bank balance", () => {
    const ws = mockWorkspace();
    const incomeTxn: Transaction = {
      id: "90000000-0000-4000-8000-000000000005",
      userId: USER_ID,
      amount: "1500.00",
      currency: "INR",
      kind: "income",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Birthday gift from parents",
      fromAccountId: null,
      toAccountId: BANK_1_ID,
      category: "Gift Received",
      subcategory: null,
      platform: null,
      merchant: "Parents",
      externalPayer: null,
      externalReference: null,
      refundOfTransactionId: null,
      notes: null,
    };

    const validated = validateWorkspaceRecord(ws, "transactions", incomeTxn, USER_ID);
    ws.transactions.push(validated);

    // Initial balance was 10000.00, now should be 11500.00
    const balance = accountBalance(ws, BANK_1_ID, "2026-11-03").current;
    expect(balance).toBe("11500.00");
  });

  it("preserves historical transactions and Stationery category without mutation", () => {
    const ws = mockWorkspace();
    const legacyTxn: Transaction = {
      id: "90000000-0000-4000-8000-000000000006",
      userId: USER_ID,
      amount: "150.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-15",
      description: "Notebook and pens",
      fromAccountId: BANK_1_ID,
      toAccountId: null,
      category: "Stationery",
      subcategory: null,
      platform: "Local stationery shop",
      merchant: "College store",
      externalPayer: null,
      externalReference: null,
      refundOfTransactionId: null,
      notes: null,
    };

    const validated = validateWorkspaceRecord(ws, "transactions", legacyTxn, USER_ID);
    expect(validated.category).toBe("Stationery");
  });
});

describe("Split Expense, Ordered for Someone Else & Repayment Accounting", () => {
  it("calculates deterministic equal shares with paise rounding", () => {
    // ₹600 split 3 ways (User + 2 friends)
    const split600 = computeEqualShares("600.00", true, 2);
    expect(split600.myShare).toBe("200.00");
    expect(split600.perPersonShares).toEqual(["200.00", "200.00"]);

    // ₹100 split 3 ways: 10000 paise / 3 = 3333 with 1 remainder
    const split100 = computeEqualShares("100.00", true, 2);
    expect(split100.myShare).toBe("33.34");
    expect(split100.perPersonShares).toEqual(["33.33", "33.33"]);

    // ₹500 ordered for 1 friend (user not included)
    const order500 = computeEqualShares("500.00", false, 1);
    expect(order500.myShare).toBe("0.00");
    expect(order500.perPersonShares).toEqual(["500.00"]);

    // ₹500 ordered for 2 friends (user not included)
    const order500_2 = computeEqualShares("500.00", false, 2);
    expect(order500_2.perPersonShares).toEqual(["250.00", "250.00"]);
  });

  it("Example A: ₹600 food order split 3 ways -> source -600, consumption 200, receivable 400, repayment 200", () => {
    const ws = mockWorkspace();
    const expenseTx: Transaction = {
      id: "tx-split-food-600",
      userId: USER_ID,
      amount: "600.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Dinner at Bistro",
      fromAccountId: BANK_1_ID,
      toAccountId: null,
      category: "Food & Drinks",
      subcategory: "Restaurant",
    };
    ws.transactions.push(expenseTx);

    // Group and shares
    const groupId = "grp-split-food-600";
    ws.groups.push({
      id: groupId,
      userId: USER_ID,
      kind: "expense",
      title: "Dinner at Bistro",
      occurredOn: "2026-11-03",
      merchant: "Bistro",
      totalCost: "600.00",
      paidBy: "You",
      transactionId: expenseTx.id,
    });

    ws.shares.push(
      {
        id: "sh-owner-200",
        userId: USER_ID,
        groupId,
        participant: "You",
        amount: "200.00",
        isOwner: true,
      },
      {
        id: "sh-lalit-200",
        userId: USER_ID,
        groupId,
        participant: "Lalit",
        amount: "200.00",
        isOwner: false,
      },
      {
        id: "sh-dhiraj-200",
        userId: USER_ID,
        groupId,
        participant: "Dhiraj",
        amount: "200.00",
        isOwner: false,
      },
    );

    // 1. Bank 1 balance was 10000 - 600 = 9400
    expect(accountBalance(ws, BANK_1_ID, "2026-11-03").current).toBe("9400.00");

    // 2. Personal consumption expense is user's share (200.00)
    expect(consumptionAmount(ws, expenseTx)).toBe("200.00");

    // 3. Receivable is 400.00
    const summaryBefore = groupSummary(ws, groupId);
    expect(summaryBefore.receivable).toBe("400.00");

    // 4. Lalit repays ₹200 into Bank 2
    const repaymentTx: Transaction = {
      id: "tx-lalit-repay-200",
      userId: USER_ID,
      amount: "200.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Reimbursement from Lalit · Dinner at Bistro",
      fromAccountId: null,
      toAccountId: BANK_2_ID,
      category: "Shared Expense / Paid-for-Others Repayment",
      refundReason: "shared_reimbursement",
      refundOfTransactionId: expenseTx.id,
      externalPayer: "Lalit",
    };
    ws.transactions.push(repaymentTx);
    ws.settlements.push({
      id: "st-lalit-200",
      userId: USER_ID,
      groupId,
      transactionId: repaymentTx.id,
      counterparty: "Lalit",
      direction: "incoming",
      amount: "200.00",
    });

    // Bank 2 balance was 5000 + 200 = 5200
    expect(accountBalance(ws, BANK_2_ID, "2026-11-03").current).toBe("5200.00");

    // Receivable reduced to 200.00 (Dhiraj only)
    const summaryAfter = groupSummary(ws, groupId);
    expect(summaryAfter.receivable).toBe("200.00");
  });

  it("Example B1: ₹500 ordered for someone as full Gift -> personal expense 500, receivable 0", () => {
    const ws = mockWorkspace();
    const giftTx: Transaction = {
      id: "tx-gift-500",
      userId: USER_ID,
      amount: "500.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Birthday present for Friend",
      fromAccountId: BANK_1_ID,
      toAccountId: null,
      category: "Gift Given",
      merchant: "Friend",
    };
    ws.transactions.push(giftTx);

    // Group with 100% owner consumption as Gift, ₹0 allocated to friend
    const groupId = "grp-gift-500";
    ws.groups.push({
      id: groupId,
      userId: USER_ID,
      kind: "expense",
      title: "Birthday present",
      occurredOn: "2026-11-03",
      merchant: "Friend",
      totalCost: "500.00",
      paidBy: "You",
      transactionId: giftTx.id,
    });
    ws.shares.push(
      {
        id: "sh-owner-gift-500",
        userId: USER_ID,
        groupId,
        participant: "You",
        amount: "500.00",
        isOwner: true,
      },
      {
        id: "sh-friend-gift-0",
        userId: USER_ID,
        groupId,
        participant: "Friend",
        amount: "0.00",
        isOwner: false,
      },
    );

    expect(consumptionAmount(ws, giftTx)).toBe("500.00");
    expect(groupSummary(ws, groupId).receivable).toBe("0.00");
  });

  it("Example B2: ₹500 ordered for someone Not Paid Yet -> consumption 0, receivable 500", () => {
    const ws = mockWorkspace();
    const orderTx: Transaction = {
      id: "tx-order-500",
      userId: USER_ID,
      amount: "500.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Shoes ordered for Rahul",
      fromAccountId: BANK_1_ID,
      toAccountId: null,
      category: "Shopping",
    };
    ws.transactions.push(orderTx);

    const groupId = "grp-order-500";
    ws.groups.push({
      id: groupId,
      userId: USER_ID,
      kind: "expense",
      title: "Shoes for Rahul",
      occurredOn: "2026-11-03",
      merchant: "Rahul",
      totalCost: "500.00",
      paidBy: "You",
      transactionId: orderTx.id,
    });
    ws.shares.push(
      {
        id: "sh-owner-0",
        userId: USER_ID,
        groupId,
        participant: "You",
        amount: "0.00",
        isOwner: true,
      },
      {
        id: "sh-rahul-500",
        userId: USER_ID,
        groupId,
        participant: "Rahul",
        amount: "500.00",
        isOwner: false,
      },
    );

    expect(consumptionAmount(ws, orderTx)).toBe("0.00");
    expect(groupSummary(ws, groupId).receivable).toBe("500.00");
  });

  it("Example B3 & B4: ₹500 ordered with Partial ₹200 then Full settlement", () => {
    const ws = mockWorkspace();
    const orderTx: Transaction = {
      id: "tx-order-500-b3",
      userId: USER_ID,
      amount: "500.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Books for Priya",
      fromAccountId: BANK_1_ID,
      toAccountId: null,
      category: "Shopping",
    };
    ws.transactions.push(orderTx);

    const groupId = "grp-order-500-b3";
    ws.groups.push({
      id: groupId,
      userId: USER_ID,
      kind: "expense",
      title: "Books for Priya",
      occurredOn: "2026-11-03",
      merchant: "Priya",
      totalCost: "500.00",
      paidBy: "You",
      transactionId: orderTx.id,
    });
    ws.shares.push(
      {
        id: "sh-owner-0-b3",
        userId: USER_ID,
        groupId,
        participant: "You",
        amount: "0.00",
        isOwner: true,
      },
      {
        id: "sh-priya-500",
        userId: USER_ID,
        groupId,
        participant: "Priya",
        amount: "500.00",
        isOwner: false,
      },
    );

    // Initial receivable: 500
    expect(groupSummary(ws, groupId).receivable).toBe("500.00");

    // Partial payment of 200
    const partialTx: Transaction = {
      id: "tx-priya-partial-200",
      userId: USER_ID,
      amount: "200.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Reimbursement from Priya · Books",
      fromAccountId: null,
      toAccountId: BANK_1_ID,
      category: "Shared Expense / Paid-for-Others Repayment",
      refundReason: "shared_reimbursement",
      refundOfTransactionId: orderTx.id,
      externalPayer: "Priya",
    };
    ws.transactions.push(partialTx);
    ws.settlements.push({
      id: "st-priya-200",
      userId: USER_ID,
      groupId,
      transactionId: partialTx.id,
      counterparty: "Priya",
      direction: "incoming",
      amount: "200.00",
    });

    // Remaining receivable: 300
    expect(groupSummary(ws, groupId).receivable).toBe("300.00");

    // Remaining payment of 300 to fully settle
    const finalTx: Transaction = {
      id: "tx-priya-final-300",
      userId: USER_ID,
      amount: "300.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Final reimbursement from Priya · Books",
      fromAccountId: null,
      toAccountId: BANK_1_ID,
      category: "Shared Expense / Paid-for-Others Repayment",
      refundReason: "shared_reimbursement",
      refundOfTransactionId: orderTx.id,
      externalPayer: "Priya",
    };
    ws.transactions.push(finalTx);
    ws.settlements.push({
      id: "st-priya-300",
      userId: USER_ID,
      groupId,
      transactionId: finalTx.id,
      counterparty: "Priya",
      direction: "incoming",
      amount: "300.00",
    });

    // Fully paid: receivable is 0.00
    expect(groupSummary(ws, groupId).receivable).toBe("0.00");
  });

  it("Mixed split: Alice fully paid ₹200, Bob owes ₹200 -> distinct participant tracking", () => {
    const ws = mockWorkspace();
    const mixedTx: Transaction = {
      id: "tx-mixed-600",
      userId: USER_ID,
      amount: "600.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Movie tickets and popcorn",
      fromAccountId: BANK_1_ID,
      toAccountId: null,
      category: "Entertainment",
    };
    ws.transactions.push(mixedTx);

    const groupId = "grp-mixed-600";
    ws.groups.push({
      id: groupId,
      userId: USER_ID,
      kind: "expense",
      title: "Movie night",
      occurredOn: "2026-11-03",
      merchant: "PVR",
      totalCost: "600.00",
      paidBy: "You",
      transactionId: mixedTx.id,
    });
    ws.shares.push(
      {
        id: "sh-owner-200-m",
        userId: USER_ID,
        groupId,
        participant: "You",
        amount: "200.00",
        isOwner: true,
      },
      {
        id: "sh-alice-200",
        userId: USER_ID,
        groupId,
        participant: "Alice",
        amount: "200.00",
        isOwner: false,
      },
      {
        id: "sh-bob-200",
        userId: USER_ID,
        groupId,
        participant: "Bob",
        amount: "200.00",
        isOwner: false,
      },
    );

    // Alice paid her share immediately
    const aliceTx: Transaction = {
      id: "tx-alice-200",
      userId: USER_ID,
      amount: "200.00",
      currency: "INR",
      kind: "refund",
      status: "posted",
      occurredOn: "2026-11-03",
      description: "Reimbursement from Alice · Movie",
      fromAccountId: null,
      toAccountId: BANK_1_ID,
      category: "Shared Expense / Paid-for-Others Repayment",
      refundReason: "shared_reimbursement",
      refundOfTransactionId: mixedTx.id,
      externalPayer: "Alice",
    };
    ws.transactions.push(aliceTx);
    ws.settlements.push({
      id: "st-alice-200",
      userId: USER_ID,
      groupId,
      transactionId: aliceTx.id,
      counterparty: "Alice",
      direction: "incoming",
      amount: "200.00",
    });

    const summary = groupSummary(ws, groupId);
    // Bob owes 200, Alice owes 0, total receivable is 200
    expect(summary.receivable).toBe("200.00");
  });
});
