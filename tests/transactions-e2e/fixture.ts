import type { Transaction, WorkspaceData } from "../../src/lib/types";
import {
  mockWorkspace,
  syntheticId,
  userId,
  workspaceFixture,
} from "../refinement-e2e/fixture";

export { mockWorkspace, syntheticId, userId };

export const ids = {
  bank: syntheticId(81000),
  card: syntheticId(81001),
  wallet: syntheticId(81002),
  food: syntheticId(82001),
  refund: syntheticId(82015),
  transfer: syntheticId(82017),
  repayment: syntheticId(82018),
};

/** Fictional, local browser records. Platform names are never used to infer category. */
export function transactionsFixture(): WorkspaceData {
  const data = workspaceFixture(0);
  data.accounts = [
    {
      id: ids.bank,
      userId,
      active: true,
      kind: "bank",
      name: "QA Current account",
      institution: "QA Bank",
      maskedSuffix: "0111",
    },
    {
      id: ids.card,
      userId,
      active: true,
      kind: "credit_card",
      name: "QA Credit account",
      institution: "QA Issuer",
      maskedSuffix: "0222",
      creditLimit: "10000.00",
    },
    {
      id: ids.wallet,
      userId,
      active: true,
      kind: "wallet",
      name: "QA Wallet account",
      institution: "QA Wallet",
      maskedSuffix: "0333",
    },
  ];
  const tx = (
    n: number,
    description: string,
    amount: string,
    category: string | null,
    platform: string | null,
    changes: Partial<Transaction> = {},
  ): Transaction => ({
    id: syntheticId(82000 + n),
    userId,
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: `2026-10-${n <= 8 ? "18" : "17"}`,
    description,
    merchant: null,
    amount,
    category,
    platform,
    fromAccountId: ids.bank,
    toAccountId: null,
    ...changes,
  });
  data.transactions = [
    tx(1, "QA Lunch order", "100.00", "Food", "Swiggy", {
      merchant: "QA Orchard Kitchen",
      externalReference: "QA-FOOD-REF-001",
      notes: "QA lunch meeting note",
      fromAccountId: ids.card,
    }),
    tx(2, "QA Food delivery", "50.00", "Food", "  bLiNkIt  "),
    tx(3, "QA Local food order", "20.00", "Food", "QA Local Kitchen"),
    tx(4, "QA Unassigned food", "30.00", "Food", null),
    tx(5, "QA Shopping purchase", "200.00", "Shopping", "Amazon"),
    tx(6, "QA Shopping delivery", "75.00", "Shopping", "Blinkit"),
    tx(7, "QA Grocery delivery", "60.00", "Groceries", "Blinkit"),
    tx(8, "QA Stationery delivery", "40.00", "Stationery Items", "Blinkit"),
    tx(9, "QA Notebook order", "90.00", "Stationery Items", "Amazon"),
    tx(10, "QA Rail ticket", "120.00", "Transport", "IRCTC"),
    tx(11, "QA Legacy course", "70.00", "Education", "QA Learning"),
    tx(
      12,
      "QA Custom category record",
      "10.00",
      "QA Donations",
      "QA Community",
    ),
    tx(13, "QA Food awaiting review", "900.00", "Food", "Swiggy", {
      status: "pending_review",
    }),
    tx(14, "QA Voided food", "800.00", "Food", "Swiggy", { status: "voided" }),
    tx(15, "QA Lunch refund", "40.00", "Food", "Swiggy", {
      kind: "refund",
      fromAccountId: null,
      toAccountId: ids.card,
      refundOfTransactionId: ids.food,
    }),
    tx(16, "QA Salary receipt", "1000.00", null, null, {
      kind: "income",
      fromAccountId: null,
      toAccountId: ids.bank,
    }),
    tx(17, "QA Wallet transfer", "300.00", null, null, {
      kind: "transfer",
      toAccountId: ids.wallet,
    }),
    tx(18, "QA Card repayment", "250.00", null, null, {
      kind: "bill_payment",
      toAccountId: ids.card,
    }),
    tx(19, "QA Balance correction", "500.00", null, null, {
      kind: "adjustment",
    }),
    tx(20, "QA September meal", "45.00", "Food", "Swiggy", {
      occurredOn: "2026-09-30",
    }),
    tx(21, "QA Undated expense", "5.00", "Food", null, { occurredOn: null }),
    tx(
      22,
      "FOREIGN FINANCIAL RECORD MUST STAY HIDDEN",
      "99999.00",
      "Food",
      "Swiggy",
      { userId: syntheticId(99999) },
    ),
  ].reverse();
  return data;
}
