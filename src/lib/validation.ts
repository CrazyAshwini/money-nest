import { z } from "zod";
import Decimal from "decimal.js";
import {
  isDebtAccount,
  sumMoney,
  validateBillAllocation,
  validateEmiAllocation,
} from "./finance";
import type {
  Account,
  AccountSnapshot,
  Bill,
  Emi,
  EmiAllocation,
  ExpenseGroup,
  ExpenseShare,
  FixedDeposit,
  Loan,
  Reminder,
  Settlement,
  Transaction,
  WorkspaceData,
  BillAllocation,
} from "./types";

export const moneySchema = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,2})?$/,
    "Use an amount with at most two decimal places.",
  );
export const positiveMoneySchema = moneySchema.refine(
  (value) => !/^0+(\.0+)?$/.test(value),
  "Amount must be greater than zero.",
);
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Enter a real calendar date.");
const uuid = z.string().uuid();
const optionalMoney = moneySchema.nullish();
const optionalDate = isoDateSchema.nullish();
const boundedText = z.string().trim().max(500);
const ownedFields = { id: uuid, userId: uuid };
export const accountSchema = z
  .object({
    ...ownedFields,
    name: z.string().trim().min(1).max(100),
    institution: z.string().trim().min(1).max(100),
    kind: z.enum(["bank", "wallet", "credit_card", "pay_later"]),
    maskedSuffix: z
      .string()
      .regex(
        /^(?:\d{1,4})?$/,
        "Use only the last four digits, or leave blank.",
      ),
    creditLimit: optionalMoney,
    openingBalance: z
      .string()
      .regex(/^-?\d{1,12}(\.\d{1,2})?$/)
      .nullish(),
    openingBalanceDate: optionalDate,
    active: z.boolean(),
    notes: boundedText.optional(),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .superRefine((account, context) => {
    if (
      (account.openingBalance == null) !==
      (account.openingBalanceDate == null)
    )
      context.addIssue({
        code: "custom",
        path: ["openingBalanceDate"],
        message: "An opening balance and its date must be supplied together.",
      });
  });
export const transactionSchema = z
  .object({
    ...ownedFields,
    amount: positiveMoneySchema,
    currency: z.literal("INR"),
    kind: z.enum([
      "expense",
      "income",
      "transfer",
      "bill_payment",
      "refund",
      "adjustment",
    ]),
    status: z.enum(["posted", "pending_review", "voided"]),
    occurredOn: isoDateSchema.nullable(),
    description: z.string().trim().min(1).max(200),
    fromAccountId: uuid.nullable(),
    toAccountId: uuid.nullable(),
    category: boundedText.nullish(),
    subcategory: boundedText.nullish(),
    platform: z.string().trim().max(100).nullish(),
    merchant: boundedText.nullish(),
    externalPayer: boundedText.nullish(),
    externalReference: z.string().trim().max(100).nullish(),
    sourceSystem: z.string().trim().max(100).nullish(),
    sourceObjectId: z.string().trim().max(200).nullish(),
    receiptDocumentId: uuid.nullish(),
    refundOfTransactionId: uuid.nullish(),
    notes: z.string().max(2000).nullish(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((transaction, context) => {
    if (transaction.status === "posted" && !transaction.occurredOn)
      context.addIssue({
        code: "custom",
        path: ["occurredOn"],
        message: "A posted transaction needs a confirmed date.",
      });
    if (
      transaction.fromAccountId &&
      transaction.fromAccountId === transaction.toAccountId
    )
      context.addIssue({
        code: "custom",
        path: ["toAccountId"],
        message: "The source and destination must be different accounts.",
      });
    if (
      transaction.status === "posted" &&
      !transaction.fromAccountId &&
      !transaction.toAccountId &&
      !transaction.externalPayer
    )
      context.addIssue({
        code: "custom",
        path: ["fromAccountId"],
        message: "Choose an account or identify the external payer.",
      });
    if (transaction.kind === "income" && !transaction.toAccountId)
      context.addIssue({
        code: "custom",
        path: ["toAccountId"],
        message: "Income needs a receiving account.",
      });
    if (transaction.kind === "refund" && !transaction.toAccountId)
      context.addIssue({
        code: "custom",
        path: ["toAccountId"],
        message: "A refund needs a receiving account.",
      });
    if (
      transaction.kind === "expense" &&
      transaction.status === "posted" &&
      !transaction.fromAccountId &&
      !transaction.externalPayer
    )
      context.addIssue({
        code: "custom",
        path: ["fromAccountId"],
        message:
          "An expense needs a paying account or identified external payer.",
      });
    if (transaction.kind === "bill_payment" && !transaction.fromAccountId)
      context.addIssue({
        code: "custom",
        path: ["fromAccountId"],
        message: "A bill payment needs the source of the existing debit.",
      });
  });
export const snapshotSchema = z
  .object({
    ...ownedFields,
    accountId: uuid,
    asOf: z.string().datetime({ offset: true }),
    reportedBalance: z
      .string()
      .regex(/^-?\d{1,12}(\.\d{1,2})?$/)
      .nullish(),
    reportedOutstanding: optionalMoney,
    reportedUtilized: optionalMoney,
    reportedAvailable: optionalMoney,
    reportedUnbilled: optionalMoney,
    nextStatementDate: optionalDate,
    source: z.enum([
      "bank_statement",
      "app_screenshot",
      "user_report",
      "import",
    ]),
    verifiedByUser: z.boolean(),
  })
  .refine(
    (snapshot) =>
      [
        snapshot.reportedBalance,
        snapshot.reportedOutstanding,
        snapshot.reportedUtilized,
        snapshot.reportedAvailable,
        snapshot.reportedUnbilled,
      ].some((value) => value != null),
    "Enter at least one reported amount.",
  );
export const billSchema = z
  .object({
    ...ownedFields,
    accountId: uuid,
    statementAmount: moneySchema,
    statementDate: isoDateSchema,
    dueDate: isoDateSchema.nullable(),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    minimumDue: optionalMoney,
    statementCredits: moneySchema.optional(),
    notes: boundedText.optional(),
  })
  .superRefine((bill, context) => {
    if (bill.periodEnd < bill.periodStart)
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "The billing period cannot end before it starts.",
      });
    if (bill.dueDate && bill.dueDate < bill.statementDate)
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "The due date cannot precede the statement.",
      });
    if (bill.periodEnd > bill.statementDate)
      context.addIssue({
        code: "custom",
        path: ["statementDate"],
        message: "The statement cannot precede the end of its billing period.",
      });
    if (new Decimal(bill.statementCredits ?? "0").gt(bill.statementAmount))
      context.addIssue({
        code: "custom",
        path: ["statementCredits"],
        message:
          "Credits cannot exceed the statement amount. Track excess credit separately.",
      });
  });
export const allocationSchema = z.object({
  ...ownedFields,
  billId: uuid,
  transactionId: uuid,
  amount: positiveMoneySchema,
  verified: z.boolean(),
  createdAt: z.string().datetime({ offset: true }).optional(),
});
export const emiAllocationSchema = z.object({
  ...ownedFields,
  emiId: uuid,
  transactionId: uuid,
  amount: positiveMoneySchema,
  createdAt: z.string().datetime({ offset: true }).optional(),
});
export const loanSchema = z.object({
  ...ownedFields,
  name: z.string().trim().min(1).max(100),
  lender: z.string().trim().min(1).max(100),
  kind: z.enum(["institutional", "lent", "borrowed"]),
  contractualPrincipal: moneySchema.nullable(),
  netDisbursed: moneySchema.nullable(),
  reportedOutstanding: moneySchema.nullable(),
  reportedAsOf: isoDateSchema.nullable(),
  annualRate: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,4})?$/)
    .nullish(),
  scheduledTotal: optionalMoney,
  repaymentAccountId: uuid.nullable(),
  disbursedOn: isoDateSchema.nullable(),
  notes: boundedText.optional(),
});
export const emiSchema = z
  .object({
    ...ownedFields,
    loanId: uuid,
    number: z.number().int().positive().max(1200),
    dueDate: isoDateSchema,
    amount: positiveMoneySchema,
    principalPortion: optionalMoney,
    interestPortion: optionalMoney,
  })
  .refine(
    (emi) =>
      emi.principalPortion == null ||
      emi.interestPortion == null ||
      new Decimal(emi.principalPortion)
        .plus(emi.interestPortion)
        .eq(emi.amount),
    "Confirmed principal and interest portions must sum to the installment.",
  );
export const fixedDepositSchema = z
  .object({
    ...ownedFields,
    name: z.string().trim().min(1).max(100),
    institution: z.string().trim().min(1).max(100),
    maskedSuffix: z.string().regex(/^(?:\d{1,4})?$/),
    principal: positiveMoneySchema,
    openingDate: isoDateSchema,
    maturityDate: isoDateSchema,
    maturityAmount: optionalMoney,
    annualRate: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,4})?$/)
      .nullish(),
    payoutMethod: z.string().max(100),
    maturityInstruction: z.enum(["reinvest", "withdraw", "unconfirmed"]),
    pledged: z.boolean(),
    backingAccountId: uuid.nullable(),
    payoutAccountId: uuid.nullable(),
    reportedEncashmentValue: optionalMoney,
    reportedAsOf: optionalDate,
    notes: boundedText.optional(),
  })
  .superRefine((fd, context) => {
    if (fd.maturityDate < fd.openingDate)
      context.addIssue({
        code: "custom",
        path: ["maturityDate"],
        message: "Maturity must follow the opening date.",
      });
  });

const groupSchema = z.object({
  ...ownedFields,
  kind: z.enum(["expense", "contribution_pool"]).optional(),
  title: z.string().trim().min(1).max(120),
  occurredOn: isoDateSchema,
  merchant: z.string().max(500),
  totalCost: positiveMoneySchema,
  paidBy: z.string().trim().min(1).max(120),
  transactionId: uuid.nullable(),
  notes: boundedText.optional(),
});
const shareSchema = z.object({
  ...ownedFields,
  groupId: uuid,
  participant: z.string().trim().min(1).max(120),
  amount: moneySchema,
  isOwner: z.boolean(),
});
const settlementSchema = z.object({
  ...ownedFields,
  groupId: uuid,
  transactionId: uuid,
  counterparty: z.string().trim().min(1).max(120),
  direction: z.enum(["incoming", "outgoing"]),
  amount: positiveMoneySchema,
});
const reminderSchema = z.object({
  ...ownedFields,
  title: z.string().trim().min(1).max(120),
  billId: uuid.nullish(),
  emiId: uuid.nullish(),
  triggerAt: z.string().datetime({ offset: true }),
  channel: z.enum(["in_app", "email", "push"]),
  enabled: z.boolean(),
  state: z.enum(["scheduled", "sent", "dismissed"]),
});
const auditSchema = z.object({
  ...ownedFields,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  action: z.string().min(1),
  description: z.string().max(2000),
  occurredAt: z.string().datetime({ offset: true }),
});
export const workspaceRecordSchemas = {
  accounts: accountSchema,
  snapshots: snapshotSchema,
  transactions: transactionSchema,
  bills: billSchema,
  allocations: allocationSchema,
  fixedDeposits: fixedDepositSchema,
  loans: loanSchema,
  emis: emiSchema,
  emiAllocations: emiAllocationSchema,
  groups: groupSchema,
  shares: shareSchema,
  settlements: settlementSchema,
  reminders: reminderSchema,
  auditEvents: auditSchema,
};

/** Shared client boundary validation, including links and reserved payment amounts. */
export function validateWorkspaceRecord<K extends keyof WorkspaceData>(
  data: WorkspaceData,
  collection: K,
  input: WorkspaceData[K][number],
  userId: string,
): WorkspaceData[K][number] {
  const parsed = workspaceRecordSchemas[collection].safeParse(input);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Check the record details.",
    );
  const record = parsed.data;
  if (record.userId !== userId)
    throw new Error("Record ownership does not match this workspace.");
  const existing = data[collection].find((row) => row.id === record.id);
  if (existing && existing.userId !== userId)
    throw new Error("This record belongs to a different workspace.");
  const account = (id: string | null | undefined) => {
    if (!id) return undefined;
    const found = data.accounts.find((a) => a.id === id && a.userId === userId);
    if (!found)
      throw new Error("A linked account was not found in this workspace.");
    return found;
  };
  if (collection === "accounts") {
    const next = record as Account;
    const previous = existing as Account | undefined;
    if (
      previous &&
      previous.kind !== next.kind &&
      (data.transactions.some(
        (t) => t.fromAccountId === next.id || t.toAccountId === next.id,
      ) ||
        data.snapshots.some((s) => s.accountId === next.id) ||
        data.bills.some((b) => b.accountId === next.id) ||
        data.loans.some((l) => l.repaymentAccountId === next.id) ||
        data.fixedDeposits.some(
          (fd) =>
            fd.backingAccountId === next.id || fd.payoutAccountId === next.id,
        ))
    )
      throw new Error("An account with financial history cannot change type.");
  } else if (collection === "transactions") {
    const next = record as Transaction;
    const previous = existing as Transaction | undefined;
    account(next.fromAccountId);
    account(next.toAccountId);
    const allocated =
      data.allocations.some((a) => a.transactionId === next.id) ||
      data.emiAllocations.some((a) => a.transactionId === next.id) ||
      data.settlements.some((s) => s.transactionId === next.id) ||
      data.groups.some((g) => g.transactionId === next.id);
    const protectedFields = [
      "amount",
      "currency",
      "kind",
      "status",
      "occurredOn",
      "fromAccountId",
      "toAccountId",
    ] as const;
    if (
      previous &&
      allocated &&
      protectedFields.some((field) => previous[field] !== next[field])
    )
      throw new Error(
        "This transaction has payment or shared-expense allocations. Its amount, date, accounts and posting state cannot change while linked.",
      );
    if (next.refundOfTransactionId) {
      const original = data.transactions.find(
        (t) =>
          t.id === next.refundOfTransactionId &&
          t.userId === userId &&
          t.status === "posted" &&
          t.occurredOn,
      );
      if (
        next.kind !== "refund" ||
        !original ||
        !["expense", "transfer"].includes(original.kind) ||
        original.id === next.id
      )
        throw new Error(
          "Link a refund to a posted purchase or returned transfer in your workspace.",
        );
      if (next.occurredOn && original.occurredOn! > next.occurredOn)
        throw new Error(
          "The refund date cannot precede the original transaction.",
        );
    }
    if (
      previous &&
      data.transactions.some((t) => t.refundOfTransactionId === next.id) &&
      ["amount", "kind", "status", "occurredOn"].some(
        (field) =>
          previous[field as keyof Transaction] !==
          next[field as keyof Transaction],
      )
    )
      throw new Error(
        "This purchase has linked refunds. Its amount, type and date cannot change while linked.",
      );
  } else if (collection === "snapshots") {
    account((record as AccountSnapshot).accountId);
  } else if (collection === "bills") {
    const next = record as Bill;
    if (!isDebtAccount(account(next.accountId)!))
      throw new Error(
        "Statements must belong to a credit card or Pay Later account.",
      );
    const reserved = data.allocations.filter((a) => a.billId === next.id);
    if (
      reserved.length &&
      (existing as Bill | undefined)?.accountId !== next.accountId
    )
      throw new Error("A statement with allocations cannot change accounts.");
    if (
      new Decimal(sumMoney(reserved.map((a) => a.amount)))
        .plus(next.statementCredits ?? "0")
        .gt(next.statementAmount)
    )
      throw new Error(
        "Statement amount and credits must leave room for all confirmed and provisional payment allocations.",
      );
  } else if (collection === "allocations") {
    const next = record as BillAllocation;
    const result = validateBillAllocation(
      data,
      next.billId,
      next.transactionId,
      next.amount,
      next.id,
    );
    if (!result.valid) throw new Error(result.error!);
  } else if (collection === "emiAllocations") {
    const next = record as EmiAllocation;
    const result = validateEmiAllocation(
      data,
      next.emiId,
      next.transactionId,
      next.amount,
      next.id,
    );
    if (!result.valid) throw new Error(result.error!);
  } else if (collection === "fixedDeposits") {
    const next = record as FixedDeposit;
    const backing = account(next.backingAccountId);
    const payout = account(next.payoutAccountId);
    if (
      next.pledged !== Boolean(backing) ||
      (backing && backing.kind !== "credit_card")
    )
      throw new Error(
        "A pledged deposit must link to its backing credit card.",
      );
    if (payout && isDebtAccount(payout))
      throw new Error("A deposit payout must go to a bank or wallet.");
  } else if (collection === "loans") {
    const next = record as Loan;
    const source = account(next.repaymentAccountId);
    if (source && isDebtAccount(source))
      throw new Error("Repayments must come from a bank or wallet.");
    if (next.reportedOutstanding != null && !next.reportedAsOf)
      throw new Error("Reported outstanding needs its as-of date.");
    if (
      next.disbursedOn &&
      next.reportedAsOf &&
      next.reportedAsOf < next.disbursedOn
    )
      throw new Error("A lender report cannot precede disbursement.");
    if (
      existing &&
      (existing as Loan).repaymentAccountId !== next.repaymentAccountId &&
      data.emis.some(
        (e) =>
          e.loanId === next.id &&
          data.emiAllocations.some((a) => a.emiId === e.id),
      )
    )
      throw new Error(
        "A loan with allocated installments cannot change its repayment account.",
      );
  } else if (collection === "emis") {
    const next = record as Emi;
    const loan = data.loans.find(
      (l) => l.id === next.loanId && l.userId === userId,
    );
    if (!loan) throw new Error("The loan was not found in this workspace.");
    if (loan.disbursedOn && next.dueDate < loan.disbursedOn)
      throw new Error("An installment cannot be due before loan disbursement.");
    if (
      data.emis.some(
        (e) =>
          e.id !== next.id &&
          e.loanId === next.loanId &&
          e.number === next.number,
      )
    )
      throw new Error("This loan already has that installment number.");
    const reserved = data.emiAllocations.filter((a) => a.emiId === next.id);
    if (
      reserved.length &&
      (existing as Emi | undefined)?.loanId !== next.loanId
    )
      throw new Error("An allocated installment cannot change loans.");
    if (new Decimal(sumMoney(reserved.map((a) => a.amount))).gt(next.amount))
      throw new Error(
        "The installment amount cannot fall below its allocations.",
      );
  } else if (collection === "groups") {
    const next = record as ExpenseGroup;
    const previous = existing as ExpenseGroup | undefined;
    if (
      previous &&
      (previous.kind ?? "expense") !== (next.kind ?? "expense")
    )
      throw new Error("An existing shared record cannot change its type.");
    if (next.kind === "contribution_pool") {
      if (next.transactionId !== null)
        throw new Error("A contribution pool must keep its separate ledger payments.");
    } else {
      const purchase = data.transactions.find(
        (t) =>
          t.id === next.transactionId &&
          t.userId === userId &&
          t.kind === "expense" &&
          t.status === "posted" &&
          t.occurredOn,
      );
      if (
        !purchase ||
        purchase.amount !== next.totalCost ||
        purchase.occurredOn !== next.occurredOn
      )
        throw new Error(
          "A shared expense must match an existing dated posted purchase.",
        );
      if (
        next.paidBy !== (purchase.fromAccountId ? "You" : purchase.externalPayer)
      )
        throw new Error("The group's payer must match the linked purchase.");
      if (
        data.groups.some(
          (g) => g.id !== next.id && g.transactionId === purchase.id,
        )
      )
        throw new Error("This purchase is already linked to a shared expense.");
    }
    if (
      new Decimal(
        sumMoney(
          data.shares.filter((s) => s.groupId === next.id).map((s) => s.amount),
        ),
      ).gt(next.totalCost)
    )
      throw new Error("Group cost cannot be less than its confirmed shares.");
  } else if (collection === "shares") {
    const next = record as ExpenseShare;
    const group = data.groups.find(
      (g) => g.id === next.groupId && g.userId === userId,
    );
    if (!group) throw new Error("The shared expense was not found.");
    const others = data.shares.filter(
      (s) => s.groupId === next.groupId && s.id !== next.id,
    );
    if (
      others.some(
        (s) =>
          s.participant.toLocaleLowerCase() ===
            next.participant.toLocaleLowerCase() ||
          (s.isOwner && next.isOwner),
      )
    )
      throw new Error(
        "This participant already has a share. Edit the existing share instead.",
      );
    if (
      new Decimal(sumMoney(others.map((s) => s.amount)))
        .plus(next.amount)
        .gt(group.totalCost)
    )
      throw new Error("Shares cannot exceed the actual group expense.");
  } else if (collection === "settlements") {
    const next = record as Settlement;
    if (!data.groups.some((g) => g.id === next.groupId && g.userId === userId))
      throw new Error("The shared expense was not found.");
    const movement = data.transactions.find(
      (t) =>
        t.id === next.transactionId &&
        t.userId === userId &&
        t.status === "posted" &&
        t.occurredOn &&
        ["transfer", "refund"].includes(t.kind),
    );
    if (
      !movement ||
      (next.direction === "incoming" && !movement.toAccountId) ||
      (next.direction === "outgoing" && !movement.fromAccountId)
    )
      throw new Error(
        "Choose a dated posted movement with the correct contribution direction.",
      );
    if (
      new Decimal(
        sumMoney(
          data.settlements
            .filter(
              (s) => s.transactionId === next.transactionId && s.id !== next.id,
            )
            .map((s) => s.amount),
        ),
      )
        .plus(next.amount)
        .gt(movement.amount)
    )
      throw new Error("Settlements cannot exceed the linked bank movement.");
  } else if (collection === "reminders") {
    const next = record as Reminder;
    if (
      (next.billId &&
        !data.bills.some((b) => b.id === next.billId && b.userId === userId)) ||
      (next.emiId &&
        !data.emis.some((e) => e.id === next.emiId && e.userId === userId))
    )
      throw new Error("A reminder's linked bill or installment was not found.");
    if (next.enabled && next.channel !== "in_app")
      throw new Error(
        "Email and push delivery require an opted-in notification provider. Use in-app reminders for now.",
      );
  }
  return record as WorkspaceData[K][number];
}
