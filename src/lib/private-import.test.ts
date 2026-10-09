import { describe, expect, it } from "vitest";
import { mapPrivateFinanceExport } from "./private-import";
import {
  accountBalance,
  groupSummary,
  latestSnapshot,
  monthlySummary,
} from "./finance";

const OWNER = "20000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "20000000-0000-4000-8000-000000000002";

function fixture() {
  const transaction = (
    id: string,
    type: string,
    value: string,
    from: string | null,
    to: string | null,
    date: string | null = "2026-10-04",
  ) => ({
    id,
    type,
    amount: value,
    from_account: from,
    to_account: to,
    date,
    currency: "INR",
    title: `Synthetic ${id}`,
    direction: to === "bank-alpha" && from === null ? "credit" : "debit",
    category: type === "Expense" ? "Other" : null,
    source: "synthetic fixture",
    source_row: 1,
    action: "Confirm source detail",
    evidence: "Synthetic evidence only",
  });
  return {
    currency: "INR",
    export_as_of: "2026-10-09",
    schema_version: "fixture-v1",
    accounts: [
      {
        id: "bank-alpha",
        name: "Synthetic bank",
        kind: "Bank",
        masked_suffix: "1234",
        opening_balance: "100.00",
        opening_date: "2026-10-01",
        bank_balance: "230.00",
        statement_as_of: "2026-10-08",
      },
      {
        id: "card-alpha",
        name: "Synthetic card",
        kind: "Credit Card",
        masked_suffix: "xx42",
        credit_limit: "1000.00",
        reported_outstanding: "100.00",
        reported_as_of: "2026-10-09",
        next_bill_date: "2026-11-03",
        next_bill_date_type: "unconfirmed_statement_generation_assumption",
      },
      {
        id: "wallet-alpha",
        name: "Synthetic wallet",
        kind: "Wallet",
        reported_balance: null,
      },
      {
        id: "later-alpha",
        name: "Synthetic later",
        kind: "Pay Later",
        approved_in_principle_limit: "2000.00",
        known_order_due: "75.00",
        known_order_due_date: "2026-10-20",
        total_outstanding: null,
      },
    ],
    ledger_transactions: [
      transaction("income", "Income", "200.00", null, "bank-alpha"),
      transaction("purchase", "Expense", "20.00", "bank-alpha", "bank-alpha"),
      transaction("returned-out", "Transfer", "10.00", "bank-alpha", null),
      transaction("returned-in", "Refund", "10.00", null, "bank-alpha"),
      transaction("verify-out", "Transfer", "5.00", "bank-alpha", null),
      transaction("verify-in", "Refund", "5.00", null, "bank-alpha"),
      transaction("rail-out", "Expense", "50.00", "bank-alpha", "bank-alpha"),
      transaction("rail-in", "Refund", "60.00", null, "bank-alpha"),
      transaction(
        "wallet-fund",
        "Transfer",
        "20.00",
        "bank-alpha",
        "wallet-alpha",
      ),
      transaction("wallet-buy", "Expense", "15.00", "wallet-alpha", null),
      transaction(
        "bill-pay",
        "Bill Payment",
        "40.00",
        "bank-alpha",
        "card-alpha",
      ),
      transaction(
        "unconfirmed-payer",
        "Expense",
        "25.00",
        "unconfirmed account",
        null,
      ),
      transaction("undated", "Expense", "30.00", "card-alpha", null, null),
      transaction("order", "Expense", "75.00", "later-alpha", null),
    ],
    matched_cashflows: [
      {
        kind: "returned_transfer",
        outgoing_id: "returned-out",
        incoming_id: "returned-in",
        amount: "10.00",
      },
      {
        kind: "verification_refund",
        outgoing_id: "verify-out",
        incoming_id: "verify-in",
        amount: "5.00",
      },
      {
        kind: "rail_ticket_reimbursement",
        outgoing_id: "rail-out",
        incoming_id: "rail-in",
        outgoing: "50.00",
        reimbursed: "60.00",
        unexplained_difference: "10.00",
      },
      {
        kind: "wallet_funding_not_extra_expense",
        outgoing_id: "wallet-fund",
        purchase_id: "wallet-buy",
        topup: "20.00",
        book_purchase: "15.00",
      },
    ],
    fixed_deposits: [
      {
        bank: "Synthetic deposit bank",
        principal: "1000.00",
        annual_rate_percent: "4.00",
        opened: "2026-01-01",
        maturity: "2027-01-01",
        maturity_amount: "1040.00",
        expected_interest: "40.00",
        maturity_instruction: "Auto renewal",
        secured_card: "card-alpha Secured",
      },
    ],
    loans: [
      {
        name: "Synthetic lender",
        net_received: "100.00",
        disbursement_date: "2026-10-01",
        contractual_principal: null,
        interest_rate: null,
        total_planned_emis: "120.00",
        interest_and_fee_split: null,
      },
    ],
    emis: [
      {
        loan: "Synthetic lender",
        installment: 1,
        due_date: "2026-11-01",
        amount: "120.00",
        paid: "0.00",
        status: "Scheduled",
      },
    ],
    bills: [
      {
        account: "later-alpha",
        kind: "order_bill",
        description: "Synthetic order",
        amount: "75.00",
        already_paid: "0.00",
        remaining: "75.00",
        due_date: "2026-10-20",
        status: "Unpaid",
      },
    ],
    splits: [
      {
        name: "Synthetic pool",
        date: "2026-10-04",
        incoming_contributions: [{ payer: "returned-in", amount: "10.00" }],
        payments_to: [{ payee: "Synthetic organizer", amount: "8.00" }],
        unallocated_difference: "2.00",
        personal_share: null,
      },
    ],
    known_gaps: ["Synthetic scope is incomplete"],
  };
}

describe("private finance mapping", () => {
  it("preserves bank cash movements, gross spending, and capped reimbursements without counting transfers twice", () => {
    const { workspace } = mapPrivateFinanceExport(fixture(), OWNER);
    const bank = workspace.accounts.find((account) => account.kind === "bank")!;
    expect(accountBalance(workspace, bank.id, "2026-10-09")).toMatchObject({
      calculated: "230.00",
      reported: "230.00",
      difference: "0.00",
      reconciliation: "matched",
    });
    expect(monthlySummary(workspace, "2026-10")).toMatchObject({
      gross: "185.00",
      refunds: "50.00",
      unexplainedRefunds: "10.00",
      net: "135.00",
      income: "200.00",
      expenseCount: 5,
    });
    expect(
      workspace.transactions
        .filter((transaction) =>
          ["returned-in", "verify-in"].includes(transaction.sourceObjectId!),
        )
        .map((transaction) => transaction.kind),
    ).toEqual(["transfer", "transfer"]);
  });

  it("does not invent dates, active credit limits, statement deadlines or total Pay Later debt", () => {
    const { workspace } = mapPrivateFinanceExport(fixture(), OWNER);
    const undated = workspace.transactions.find(
      (transaction) => transaction.sourceObjectId === "undated",
    )!;
    expect(undated).toMatchObject({
      occurredOn: null,
      status: "pending_review",
    });
    const later = workspace.accounts.find(
      (account) => account.kind === "pay_later",
    )!;
    expect(later.creditLimit).toBeNull();
    expect(latestSnapshot(workspace, later.id, "2026-10-09")).toBeUndefined();
    expect(workspace.bills[0]).toMatchObject({
      statementDate: "2026-10-04",
      dueDate: "2026-10-20",
      statementAmount: "75.00",
    });
    const card = workspace.accounts.find(
      (account) => account.kind === "credit_card",
    )!;
    expect(
      latestSnapshot(workspace, card.id, "2026-10-09")?.nextStatementDate,
    ).toBeNull();
    expect(latestSnapshot(workspace, card.id, "2026-10-08")).toBeUndefined();
    expect(card.maskedSuffix).toBe("42");
    expect(card.notes).toContain("xx42");
  });

  it("counts dated purchases with an unconfirmed paying account without touching the bank", () => {
    const { workspace, warnings } = mapPrivateFinanceExport(fixture(), OWNER);
    expect(
      workspace.transactions.find(
        (transaction) => transaction.sourceObjectId === "unconfirmed-payer",
      ),
    ).toMatchObject({
      fromAccountId: null,
      toAccountId: null,
      externalPayer: "Payment account unconfirmed",
      status: "posted",
    });
    expect(
      warnings.some((warning) =>
        warning.includes("unconfirmed payment account"),
      ),
    ).toBe(true);
  });

  it("retains a CRED bank debit without assigning provisional receiving-card credit", () => {
    const source = fixture();
    const payment = source.ledger_transactions.find(
      (row) => row.id === "bill-pay",
    )!;
    payment.title = "Synthetic CRED payment";
    payment.action = "Provisional receiving card; confirm routing";
    const { workspace } = mapPrivateFinanceExport(source, OWNER);
    const mapped = workspace.transactions.find(
      (row) => row.sourceObjectId === "bill-pay",
    )!;
    expect(mapped).toMatchObject({
      kind: "bill_payment",
      status: "posted",
      toAccountId: null,
    });
    expect(mapped.fromAccountId).toBe(
      workspace.accounts.find((account) => account.kind === "bank")!.id,
    );
    expect(mapped.notes).toContain("Receiving credit account unconfirmed");
    expect(mapped.notes).toContain("card-alpha");
    expect(workspace.allocations).toHaveLength(0);
    const bank = workspace.accounts.find((account) => account.kind === "bank")!;
    expect(accountBalance(workspace, bank.id, "2026-10-09").difference).toBe(
      "0.00",
    );
  });

  it("keeps deposits, loan schedules, and transfer pools separate from available cash or invented personal debt", () => {
    const { workspace, counts } = mapPrivateFinanceExport(fixture(), OWNER);
    expect(workspace.fixedDeposits[0]).toMatchObject({
      pledged: true,
      reportedEncashmentValue: null,
      payoutAccountId: null,
      maturityInstruction: "reinvest",
    });
    expect(workspace.fixedDeposits[0].backingAccountId).toBe(
      workspace.accounts.find((account) => account.kind === "credit_card")!.id,
    );
    expect(workspace.loans[0]).toMatchObject({
      contractualPrincipal: null,
      reportedOutstanding: null,
      scheduledTotal: "120.00",
      repaymentAccountId: null,
    });
    expect(workspace.emis).toHaveLength(1);
    expect(counts.allocations + counts.emiAllocations + counts.shares).toBe(0);
    expect(workspace.groups[0]).toMatchObject({
      kind: "contribution_pool",
      transactionId: null,
      totalCost: "8.00",
    });
    expect(workspace.settlements).toHaveLength(1);
    expect(workspace.settlements[0].transactionId).toBe(
      workspace.transactions.find(
        (transaction) => transaction.sourceObjectId === "returned-in",
      )!.id,
    );
    expect(groupSummary(workspace, workspace.groups[0].id)).toMatchObject({
      ownerShareKnown: false,
      poolRemaining: "2.00",
    });
    expect(
      workspace.auditEvents.find((event) => event.entityType === "split_pool")
        ?.description,
    ).toContain("personal_share");
    expect(
      workspace.auditEvents.find((event) => event.entityType === "split_pool")
        ?.description,
    ).toContain("no expense or receivable invented");
  });

  it("generates repeatable owner-scoped UUIDs and retains evidence, action notes and refund links", () => {
    const first = mapPrivateFinanceExport(fixture(), OWNER).workspace;
    const repeated = mapPrivateFinanceExport(fixture(), OWNER).workspace;
    const anotherOwner = mapPrivateFinanceExport(
      fixture(),
      OTHER_OWNER,
    ).workspace;
    expect(first).toEqual(repeated);
    expect(first.accounts[0].id).not.toBe(anotherOwner.accounts[0].id);
    expect(
      Object.values(first)
        .flat()
        .every((record) => record.userId === OWNER),
    ).toBe(true);
    const refund = first.transactions.find(
      (transaction) => transaction.sourceObjectId === "rail-in",
    )!;
    expect(refund.refundOfTransactionId).toBe(
      first.transactions.find(
        (transaction) => transaction.sourceObjectId === "rail-out",
      )!.id,
    );
    expect(refund.notes).toContain("Synthetic evidence only");
    expect(refund.notes).toContain("Confirm source detail");
    expect(refund.notes).toContain("matched_cashflows");
  });

  it("rejects invalid calendar dates, ownership and currency before creating a profile", () => {
    const source = fixture();
    source.ledger_transactions[0].date = "2026-02-30";
    expect(() => mapPrivateFinanceExport(source, OWNER)).toThrow(
      "date is invalid",
    );
    expect(() => mapPrivateFinanceExport(fixture(), "invalid-owner")).toThrow(
      "valid workspace owner",
    );
    const wrongCurrency = fixture();
    wrongCurrency.ledger_transactions[0].currency = "USD";
    expect(() => mapPrivateFinanceExport(wrongCurrency, OWNER)).toThrow(
      "unsupported currency",
    );
  });

  it("refuses unsupported paid schedules and duplicate source records instead of inventing allocations or losing cash", () => {
    const source = fixture();
    source.emis[0].paid = "20.00";
    expect(() => mapPrivateFinanceExport(source, OWNER)).toThrow(
      "identified payment transaction",
    );
    const duplicate = fixture();
    duplicate.ledger_transactions.push({ ...duplicate.ledger_transactions[0] });
    expect(() => mapPrivateFinanceExport(duplicate, OWNER)).toThrow(
      "duplicated",
    );
  });
});
