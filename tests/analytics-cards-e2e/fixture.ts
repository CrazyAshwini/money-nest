import type { Transaction, WorkspaceData } from "../../src/lib/types";
import {
  mockWorkspace,
  syntheticId,
  userId,
  workspaceFixture,
} from "../refinement-e2e/fixture";

export { mockWorkspace, syntheticId, userId };

export const ids = {
  bank: syntheticId(100),
  verified: syntheticId(200),
  estimated: syntheticId(201),
  partial: syntheticId(302),
  unknownLimit: syntheticId(203),
  payVerified: syntheticId(300),
  payEstimated: syntheticId(301),
  food: syntheticId(90001),
  shopping: syntheticId(90002),
  refund: syntheticId(90003),
  travel: syntheticId(90004),
  oldPurchase: syntheticId(90005),
  oldRefund: syntheticId(90006),
  cappedRefund: syntheticId(90007),
  excessRefund: syntheticId(90008),
};

/** All records and institutions here are fictional, with no real credentials. */
export function analyticsFixture(): WorkspaceData {
  const data = workspaceFixture(0);
  data.accounts = [
    {
      id: ids.bank,
      userId,
      active: true,
      kind: "bank",
      name: "QA Current",
      institution: "QA Bank",
      maskedSuffix: "0111",
    },
    {
      id: ids.verified,
      userId,
      active: true,
      kind: "credit_card",
      name: "QA Verified Card",
      institution: "QA Issuer",
      maskedSuffix: "0222",
      creditLimit: "10000.00",
    },
    {
      id: ids.estimated,
      userId,
      active: true,
      kind: "credit_card",
      name: "QA Estimated Card",
      institution: "QA Issuer",
      maskedSuffix: "0333",
      creditLimit: "12000.00",
    },
    {
      id: ids.unknownLimit,
      userId,
      active: true,
      kind: "credit_card",
      name: "QA Unknown Limit",
      institution: "",
      maskedSuffix: "0444",
      creditLimit: null,
    },
    {
      id: ids.payVerified,
      userId,
      active: true,
      kind: "pay_later",
      name: "QA Verified Deferred",
      institution: "QA Deferred",
      maskedSuffix: "0555",
      creditLimit: "6000.00",
    },
    {
      id: ids.payEstimated,
      userId,
      active: true,
      kind: "pay_later",
      name: "QA Estimated Deferred",
      institution: "QA Deferred",
      maskedSuffix: "0666",
      creditLimit: "5000.00",
    },
    {
      id: ids.partial,
      userId,
      active: true,
      kind: "pay_later",
      name: "QA Bill Only",
      institution: "QA Deferred",
      maskedSuffix: "0777",
      creditLimit: "4000.00",
    },
  ];
  data.snapshots = [
    {
      id: syntheticId(91000),
      userId,
      accountId: ids.bank,
      asOf: "2026-10-18",
      reportedBalance: "25000.00",
      source: "user_report",
      verifiedByUser: true,
    },
    {
      id: syntheticId(91001),
      userId,
      accountId: ids.verified,
      asOf: "2026-10-18",
      reportedOutstanding: "1809.40",
      reportedAvailable: "8190.60",
      source: "user_report",
      verifiedByUser: true,
    },
    {
      id: syntheticId(91002),
      userId,
      accountId: ids.estimated,
      asOf: "2026-10-17",
      reportedOutstanding: "2000.00",
      source: "user_report",
      verifiedByUser: true,
    },
    {
      id: syntheticId(91003),
      userId,
      accountId: ids.unknownLimit,
      asOf: "2026-10-18",
      reportedOutstanding: "750.00",
      source: "user_report",
      verifiedByUser: true,
    },
    {
      id: syntheticId(91004),
      userId,
      accountId: ids.payVerified,
      asOf: "2026-10-18",
      reportedOutstanding: "1500.00",
      reportedAvailable: "4500.00",
      source: "user_report",
      verifiedByUser: true,
    },
    {
      id: syntheticId(91005),
      userId,
      accountId: ids.payEstimated,
      asOf: "2026-10-17",
      reportedOutstanding: "1000.00",
      source: "user_report",
      verifiedByUser: true,
    },
  ];
  data.bills = [
    {
      id: syntheticId(92001),
      userId,
      accountId: ids.verified,
      statementAmount: "1000.00",
      statementDate: "2026-10-01",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      dueDate: "2026-10-25",
    },
    {
      id: syntheticId(92002),
      userId,
      accountId: ids.partial,
      statementAmount: "800.00",
      statementDate: "2026-10-05",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      dueDate: "2026-10-23",
    },
  ];
  const txn = (
    id: number,
    occurredOn: string | null,
    description: string,
    amount: string,
    changes: Partial<Transaction> = {},
  ): Transaction => ({
    id: syntheticId(id),
    userId,
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn,
    description,
    amount,
    fromAccountId: ids.bank,
    toAccountId: null,
    category: "Other",
    ...changes,
  });
  data.transactions = [
    txn(90001, "2026-10-09", "QA Lunch", "100.00", {
      merchant: "QA Cafe",
      category: "Food",
      fromAccountId: ids.verified,
    }),
    txn(90002, "2026-10-09", "QA Supplies", "250.50", {
      category: "Shopping",
      fromAccountId: ids.payVerified,
    }),
    txn(90003, "2026-10-10", "QA Supplies refund", "120.00", {
      kind: "refund",
      fromAccountId: null,
      toAccountId: ids.payVerified,
      refundOfTransactionId: ids.shopping,
      category: "Shopping",
    }),
    txn(90004, "2026-10-10", "QA Metro", "30.00", {
      category: "Transport",
      fromAccountId: ids.estimated,
    }),
    txn(90005, "2026-09-25", "QA September equipment", "600.00", {
      category: "Shopping",
    }),
    txn(90006, "2026-09-30", "QA Earlier refund", "200.00", {
      kind: "refund",
      fromAccountId: null,
      toAccountId: ids.bank,
      refundOfTransactionId: ids.oldPurchase,
    }),
    txn(90007, "2026-10-12", "QA Capped reimbursement", "1000.00", {
      kind: "refund",
      fromAccountId: null,
      toAccountId: ids.bank,
      refundOfTransactionId: ids.oldPurchase,
    }),
    txn(90008, "2026-10-14", "QA Excess reimbursement", "50.00", {
      kind: "refund",
      fromAccountId: null,
      toAccountId: ids.bank,
      refundOfTransactionId: ids.oldPurchase,
    }),
    txn(90009, "2026-10-09", "QA Pending excluded", "999.00", {
      status: "pending_review",
    }),
    txn(90010, "2026-10-09", "QA Voided excluded", "888.00", {
      status: "voided",
    }),
    txn(90011, "2026-10-09", "QA Transfer excluded", "777.00", {
      kind: "transfer",
      toAccountId: ids.estimated,
    }),
    txn(90012, "2026-10-09", "QA Repayment excluded", "666.00", {
      kind: "bill_payment",
      toAccountId: ids.verified,
    }),
    txn(90013, "2026-10-12", "QA Unmatched refund", "70.00", {
      kind: "refund",
      fromAccountId: null,
      toAccountId: ids.bank,
    }),
    txn(90014, null, "QA Undated excluded", "555.00"),
  ];
  return data;
}
