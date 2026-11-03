import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyPersonalLoanCommand,
  personalLoanSummary,
  type PersonalLoanCommand,
} from "./personal-loans";
import {
  accountBalance,
  monthlyCashFlow,
  monthlySummary,
  groupSummary,
  dailySpending,
  spendingByCategory,
} from "./finance";
import {
  ENTRY_TRANSACTION_KINDS,
  type Transaction,
  type WorkspaceData,
} from "./types";
import { validateWorkspaceRecord } from "./validation";
import { transactionSchema, recordSchemas } from "./supabase/validation";
export const owner = "11111111-1111-4111-8111-111111111111";
export const bank = "22222222-2222-4222-8222-222222222222";
function fixture(): WorkspaceData {
  return {
    accounts: [
      {
        id: bank,
        userId: owner,
        name: "Synthetic bank",
        institution: "Test",
        kind: "bank",
        maskedSuffix: "",
        active: true,
        openingBalance: "10000.00",
        openingBalanceDate: "2026-09-01",
      },
    ],
    snapshots: [],
    transactions: [],
    loans: [],
    bills: [],
    allocations: [],
    fixedDeposits: [],
    emis: [],
    emiAllocations: [],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
  };
}
function command(
  overrides: Partial<PersonalLoanCommand> = {},
): PersonalLoanCommand {
  return {
    id: randomUUID(),
    interestId: randomUUID(),
    loanId: randomUUID(),
    action: "create",
    direction: "lent",
    person: "Friend",
    amount: "5000.00",
    interest: "0.00",
    occurredOn: "2026-10-01",
    accountId: bank,
    notes: "",
    ...overrides,
  };
}
function summary(data: WorkspaceData) {
  return personalLoanSummary(data, data.loans[0], "2026-11-02");
}
describe("personal loans share the precise account ledger", () => {
  it("offers five creation choices in order, retaining adjustments only in legacy types", () =>
    expect(ENTRY_TRANSACTION_KINDS).toEqual([
      "expense",
      "income",
      "bill_payment",
      "transfer",
      "refund",
    ]));
  it("lends 5000, receives 2000 + 3000, settles without earned income", () => {
    const create = command();
    let data = applyPersonalLoanCommand(fixture(), owner, create);
    expect(accountBalance(data, bank, "2026-11-02").current).toBe("5000.00");
    expect(summary(data)).toMatchObject({
      outstanding: "5000.00",
      status: "Active",
    });
    for (const amount of ["2000.00", "3000.00"])
      data = applyPersonalLoanCommand(
        data,
        owner,
        command({
          action: "repay",
          loanId: create.loanId,
          amount,
          occurredOn: "2026-10-05",
        }),
      );
    expect(accountBalance(data, bank, "2026-11-02").current).toBe("10000.00");
    expect(summary(data)).toMatchObject({
      outstanding: "0.00",
      repaid: "5000.00",
      status: "Settled",
    });
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      gross: "0.00",
      income: "0.00",
    });
    expect(monthlyCashFlow(data, "2026-10")).toEqual({
      incoming: "5000.00",
      outgoing: "5000.00",
    });
  });
  it("borrows 3000 then repays without spending; interest is a separate expense", () => {
    const create = command({ direction: "borrowed", amount: "3000.00" });
    let data = applyPersonalLoanCommand(fixture(), owner, create);
    expect(accountBalance(data, bank, "2026-11-02").current).toBe("13000.00");
    const repay = command({
      action: "repay",
      loanId: create.loanId,
      amount: "3000.00",
      interest: "100.00",
      occurredOn: "2026-10-06",
    });
    data = applyPersonalLoanCommand(data, owner, repay);
    expect(accountBalance(data, bank, "2026-11-02").current).toBe("9900.00");
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      gross: "100.00",
      income: "0.00",
    });
    expect(summary(data).outstanding).toBe("0.00");
    data = applyPersonalLoanCommand(
      data,
      owner,
      command({
        action: "reverse",
        loanId: create.loanId,
        amount: repay.amount,
        reversesTransactionId: repay.id,
        occurredOn: "2026-10-07",
      }),
    );
    expect(summary(data).outstanding).toBe("3000.00");
    expect(accountBalance(data, bank, "2026-11-02").current).toBe("13000.00");
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      net: "0.00",
      income: "0.00",
    });
  });
  it("interest received is income and a reversal cancels it without spending", () => {
    const create = command();
    let data = applyPersonalLoanCommand(fixture(), owner, create);
    const repay = command({
      action: "repay",
      loanId: create.loanId,
      amount: "2000.00",
      interest: "10.05",
      occurredOn: "2026-10-02",
    });
    data = applyPersonalLoanCommand(data, owner, repay);
    expect(monthlySummary(data, "2026-10").income).toBe("10.05");
    data = applyPersonalLoanCommand(
      data,
      owner,
      command({
        action: "reverse",
        loanId: create.loanId,
        amount: repay.amount,
        reversesTransactionId: repay.id,
        occurredOn: "2026-10-03",
      }),
    );
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      income: "0.00",
      gross: "0.00",
    });
    expect(data.transactions).toHaveLength(5);
  });
  it("deduplicates retry identities and rejects reuse with changed payload", () => {
    const c = command();
    const data = applyPersonalLoanCommand(fixture(), owner, c);
    expect(applyPersonalLoanCommand(data, owner, c)).toBe(data);
    expect(() =>
      applyPersonalLoanCommand(data, owner, { ...c, amount: "1.00" }),
    ).toThrow(/identity/);
  });
  it.each(["0", "-1", "1.001", "NaN", "1e3"])(
    "rejects invalid principal %s without changing data",
    (amount) => {
      const data = fixture();
      expect(() =>
        applyPersonalLoanCommand(data, owner, command({ amount })),
      ).toThrow();
      expect(data.transactions).toEqual([]);
      expect(data.loans).toEqual([]);
    },
  );
  it("rejects overpayment and cross-owner/archived accounts", () => {
    const c = command();
    const data = applyPersonalLoanCommand(fixture(), owner, c);
    expect(() =>
      applyPersonalLoanCommand(
        data,
        owner,
        command({ action: "repay", loanId: c.loanId, amount: "5000.01" }),
      ),
    ).toThrow(/exceeds/);
    expect(() =>
      applyPersonalLoanCommand(
        data,
        randomUUID(),
        command({ action: "repay", loanId: c.loanId }),
      ),
    ).toThrow();
    expect(() =>
      applyPersonalLoanCommand(
        {
          ...data,
          accounts: data.accounts.map((a) => ({ ...a, active: false })),
        },
        owner,
        command({ action: "repay", loanId: c.loanId }),
      ),
    ).toThrow(/active/);
  });
  it("independently tracks multiple agreements with the same person and due status", () => {
    let data = applyPersonalLoanCommand(
      fixture(),
      owner,
      command({ dueDate: "2026-10-05" }),
    );
    data = applyPersonalLoanCommand(data, owner, command({ amount: "100.00" }));
    expect(summary(data).status).toBe("Overdue");
    expect(
      personalLoanSummary(data, data.loans[1], "2026-11-02"),
    ).toMatchObject({ outstanding: "100.00", status: "Active" });
  });
  it("round trips cloud schemas and rejects generic edits to managed events", () => {
    const data = applyPersonalLoanCommand(fixture(), owner, command());
    expect(transactionSchema.parse(data.transactions[0])).toMatchObject({
      loanId: data.loans[0].id,
      loanEvent: "disbursement",
    });
    expect(recordSchemas.loans.parse(data.loans[0])).toMatchObject({
      ledgerManaged: true,
    });
    expect(() =>
      validateWorkspaceRecord(
        data,
        "transactions",
        data.transactions[0],
        owner,
      ),
    ).toThrow(/Loans/);
    expect(() =>
      validateWorkspaceRecord(data, "loans", data.loans[0], owner),
    ).toThrow(/Loans/);
  });
  it("requires same-day snapshot treatment and preserves exact paise", () => {
    const data = fixture();
    const snapshotId = randomUUID();
    data.snapshots.push({
      id: snapshotId,
      userId: owner,
      accountId: bank,
      asOf: "2026-10-01T05:00:00Z",
      reportedBalance: "10000.00",
      source: "user_report",
      verifiedByUser: true,
    });
    const c = command({ amount: "0.10" });
    expect(() => applyPersonalLoanCommand(data, owner, c)).toThrow(/Confirm/);
    const next = applyPersonalLoanCommand(data, owner, {
      ...c,
      balanceSnapshotId: snapshotId,
      balanceIncluded: false,
    });
    expect(accountBalance(next, bank, "2026-10-01").current).toBe("9999.90");
  });
  it("card October spending and November repayment remain distinct", () => {
    const data = fixture();
    const card = randomUUID();
    data.accounts.push({
      ...data.accounts[0],
      id: card,
      kind: "credit_card",
      creditLimit: "10000.00",
    });
    const t: Transaction = {
      id: randomUUID(),
      userId: owner,
      amount: "2000.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-01",
      description: "Purchase",
      fromAccountId: card,
      toAccountId: null,
    };
    data.transactions = [
      t,
      {
        ...t,
        id: randomUUID(),
        kind: "bill_payment",
        occurredOn: "2026-11-01",
        fromAccountId: bank,
        toAccountId: card,
      },
    ];
    expect(monthlySummary(data, "2026-10").gross).toBe("2000.00");
    expect(monthlySummary(data, "2026-11").gross).toBe("0.00");
    expect(monthlyCashFlow(data, "2026-10").outgoing).toBe("0.00");
    expect(monthlyCashFlow(data, "2026-11").outgoing).toBe("2000.00");
  });
  it("shared 600 payment recognizes 200 personal expense and 400 receivable until reimbursement", () => {
    const data = fixture();
    const t: Transaction = {
      id: randomUUID(),
      userId: owner,
      amount: "600.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-01",
      description: "Shared purchase",
      fromAccountId: bank,
      toAccountId: null,
      category: "Food",
    };
    data.transactions = [t];
    const groupId = randomUUID();
    data.groups = [
      {
        id: groupId,
        userId: owner,
        title: "Meal",
        occurredOn: t.occurredOn!,
        merchant: "",
        totalCost: t.amount,
        paidBy: "You",
        transactionId: t.id,
      },
    ];
    data.shares = [
      {
        id: randomUUID(),
        userId: owner,
        groupId,
        participant: "You",
        isOwner: true,
        amount: "200.00",
      },
      {
        id: randomUUID(),
        userId: owner,
        groupId,
        participant: "Friend",
        isOwner: false,
        amount: "400.00",
      },
    ];
    expect(groupSummary(data, groupId).receivable).toBe("400.00");
    const reimbursement = {
      ...t,
      id: randomUUID(),
      kind: "transfer" as const,
      fromAccountId: null,
      toAccountId: bank,
      amount: "400.00",
    };
    data.transactions.push(reimbursement);
    data.settlements = [
      {
        id: randomUUID(),
        userId: owner,
        groupId,
        transactionId: reimbursement.id,
        counterparty: "Friend",
        direction: "incoming",
        amount: "400.00",
      },
    ];
    expect(groupSummary(data, groupId).receivable).toBe("0.00");
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      gross: "200.00",
      net: "200.00",
      income: "0.00",
    });
    expect(accountBalance(data, bank, "2026-10-31").current).toBe("9800.00");
    expect(dailySpending(data, "2026-10")[0].amount).toBe("200.00");
    expect(spendingByCategory(data, "2026-10")[0].amount).toBe("200.00");
  });
});

describe("classification and linked reimbursement", () => {
  it.each([
    ["expense", "Utilities"],
    ["expense", "Gift Given"],
    ["income", "Gift Received"],
  ] as const)(
    "keeps %s / %s in its proper analytics bucket",
    (kind, category) => {
      const data = fixture();
      data.transactions.push({
        id: randomUUID(),
        userId: owner,
        amount: "125.25",
        currency: "INR",
        kind,
        category,
        status: "posted",
        occurredOn: "2026-10-02",
        description: category,
        fromAccountId: kind === "expense" ? bank : null,
        toAccountId: kind === "income" ? bank : null,
      });
      expect(monthlySummary(data, "2026-10")).toMatchObject({
        gross: kind === "expense" ? "125.25" : "0.00",
        income: kind === "income" ? "125.25" : "0.00",
      });
    },
  );
  it("settles a shared receivable atomically from the linked refund event without new income", () => {
    const data = fixture(),
      groupId = randomUUID(),
      purchaseId = randomUUID();
    const purchase: Transaction = {
      id: purchaseId,
      userId: owner,
      amount: "600.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-01",
      description: "Meal",
      category: "Food",
      fromAccountId: bank,
      toAccountId: null,
    };
    data.transactions = [purchase];
    data.groups = [
      {
        id: groupId,
        userId: owner,
        title: "Meal",
        occurredOn: "2026-10-01",
        merchant: "",
        totalCost: "600.00",
        paidBy: "You",
        transactionId: purchaseId,
      },
    ];
    data.shares = [
      {
        id: randomUUID(),
        userId: owner,
        groupId,
        participant: "You",
        isOwner: true,
        amount: "200.00",
      },
      {
        id: randomUUID(),
        userId: owner,
        groupId,
        participant: "Friend",
        isOwner: false,
        amount: "400.00",
      },
    ];
    const reimbursement: Transaction = {
      ...purchase,
      id: randomUUID(),
      amount: "400.00",
      kind: "refund",
      fromAccountId: null,
      toAccountId: bank,
      refundOfTransactionId: purchaseId,
      refundReason: "shared_reimbursement",
      externalPayer: "Friend",
    };
    const checked = validateWorkspaceRecord(
      data,
      "transactions",
      reimbursement,
      owner,
    );
    data.transactions.push(checked);
    expect(groupSummary(data, groupId).receivable).toBe("0.00");
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      net: "200.00",
      income: "0.00",
      refunds: "0.00",
    });
    expect(() =>
      validateWorkspaceRecord(
        data,
        "transactions",
        { ...reimbursement, id: randomUUID(), amount: "0.01" },
        owner,
      ),
    ).toThrow(/exceeds/);
    expect(data.settlements).toEqual([]);
  });
  it("rejects foreign loan references even with an owned account", () => {
    const data = fixture();
    const c = command();
    const foreign = applyPersonalLoanCommand(data, owner, c);
    foreign.loans[0].userId = randomUUID();
    expect(() =>
      applyPersonalLoanCommand(
        foreign,
        owner,
        command({ action: "repay", loanId: c.loanId }),
      ),
    ).toThrow(/linked/);
  });
});
