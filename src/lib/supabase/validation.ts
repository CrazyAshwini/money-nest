import { z } from "zod";

const money = z
  .string()
  .regex(
    /^-?\d{1,12}(?:\.\d{1,2})?$/,
    "Use a decimal amount with at most two decimal places.",
  );
const positive = money.refine(
  (v) => /^\d/.test(v) && !/^0+(?:\.0+)?$/.test(v),
  "Amount must be positive.",
);
const nonnegative = money.refine(
  (v) => !v.startsWith("-"),
  "Amount cannot be negative.",
);
const date = z.iso.date();
const nullableDate = date.nullable();
const id = z.uuid();
const text = z.string().max(2000);
const short = z.string().trim().min(1).max(120);
const owned = {
  id,
  userId: id,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
};
const optionalText = text.nullable().optional();
const rate = z
  .string()
  .regex(/^\d{1,3}(?:\.\d{1,4})?$/)
  .nullable()
  .optional();

export const transactionSchema = z
  .object({
    ...owned,
    amount: positive,
    currency: z.string().regex(/^[A-Z]{3}$/),
    kind: z.enum([
      "expense",
      "income",
      "transfer",
      "bill_payment",
      "refund",
      "adjustment",
    ]),
    status: z.enum(["posted", "pending_review", "voided"]),
    occurredOn: nullableDate,
    description: z.string().trim().min(1).max(500),
    fromAccountId: id.nullable(),
    toAccountId: id.nullable(),
    category: optionalText,
    subcategory: optionalText,
    platform: z.string().trim().max(100).nullish(),
    merchant: optionalText,
    externalPayer: optionalText,
    externalReference: optionalText,
    sourceSystem: optionalText,
    sourceObjectId: short.nullable().optional(),
    receiptDocumentId: id.nullable().optional(),
    refundOfTransactionId: id.nullable().optional(),
    notes: optionalText,
  })
  .superRefine((v, context) => {
    if (v.fromAccountId && v.fromAccountId === v.toAccountId)
      context.addIssue({
        code: "custom",
        message: "Source and destination must differ.",
      });
    if (v.status === "posted" && !v.occurredOn)
      context.addIssue({
        code: "custom",
        message: "A posted transaction needs a confirmed date.",
      });
    if (
      v.status === "posted" &&
      !v.fromAccountId &&
      !v.toAccountId &&
      !v.externalPayer
    )
      context.addIssue({
        code: "custom",
        message: "Choose an account or identify the external payer.",
      });
    if (v.kind === "income" && !v.toAccountId)
      context.addIssue({
        code: "custom",
        message: "Income needs a receiving account.",
      });
    if (v.kind === "bill_payment" && !v.fromAccountId)
      context.addIssue({
        code: "custom",
        message: "A bill payment needs its source bank debit.",
      });
  });

export const recordSchemas = {
  accounts: z
    .object({
      ...owned,
      name: short,
      institution: z.string().max(120),
      kind: z.enum(["bank", "wallet", "credit_card", "pay_later"]),
      maskedSuffix: z
        .string()
        .regex(/^\d{0,4}$/, "Use only the last four digits, or leave blank."),
      creditLimit: nonnegative.nullable().optional(),
      openingBalance: money.nullable().optional(),
      openingBalanceDate: nullableDate.optional(),
      active: z.boolean(),
      notes: text.optional(),
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .refine(
      (v) => (v.openingBalance == null) === (v.openingBalanceDate == null),
      "Supply an opening balance and its cutoff date together.",
    ),
  snapshots: z
    .object({
      ...owned,
      accountId: id,
      asOf: z
        .union([z.iso.date(), z.iso.datetime({ offset: true })])
        .transform((v) => (v.length === 10 ? `${v}T00:00:00.000Z` : v)),
      reportedBalance: money.nullable().optional(),
      reportedOutstanding: money.nullable().optional(),
      reportedUtilized: money.nullable().optional(),
      reportedAvailable: money.nullable().optional(),
      reportedUnbilled: money.nullable().optional(),
      nextStatementDate: nullableDate.optional(),
      source: z.enum([
        "bank_statement",
        "app_screenshot",
        "user_report",
        "import",
      ]),
      verifiedByUser: z.boolean(),
    })
    .refine(
      (v) =>
        [
          v.reportedBalance,
          v.reportedOutstanding,
          v.reportedUtilized,
          v.reportedAvailable,
          v.reportedUnbilled,
        ].some((m) => m != null),
      "A snapshot needs at least one reported amount.",
    ),
  transactions: transactionSchema,
  bills: z
    .object({
      ...owned,
      accountId: id,
      statementAmount: nonnegative,
      statementDate: date,
      dueDate: nullableDate,
      periodStart: date,
      periodEnd: date,
      minimumDue: nonnegative.nullable().optional(),
      statementCredits: nonnegative.optional(),
      notes: text.optional(),
    })
    .refine(
      (v) =>
        v.periodStart <= v.periodEnd &&
        (!v.dueDate || v.dueDate >= v.statementDate),
      "Statement period or due date is invalid.",
    ),
  allocations: z.object({
    ...owned,
    billId: id,
    transactionId: id,
    amount: positive,
    verified: z.boolean(),
  }),
  fixedDeposits: z
    .object({
      ...owned,
      name: short,
      institution: short,
      maskedSuffix: z.string().regex(/^\d{0,4}$/),
      principal: positive,
      openingDate: date,
      maturityDate: date,
      maturityAmount: nonnegative.nullable().optional(),
      annualRate: rate,
      payoutMethod: short,
      maturityInstruction: z.enum(["reinvest", "withdraw", "unconfirmed"]),
      pledged: z.boolean(),
      backingAccountId: id.nullable(),
      payoutAccountId: id.nullable(),
      reportedEncashmentValue: nonnegative.nullable().optional(),
      reportedAsOf: nullableDate.optional(),
      notes: text.optional(),
    })
    .refine(
      (v) => v.maturityDate >= v.openingDate,
      "Maturity must follow opening.",
    ),
  loans: z.object({
    ...owned,
    name: short,
    lender: short,
    kind: z.enum(["institutional", "lent", "borrowed"]),
    contractualPrincipal: nonnegative.nullable(),
    netDisbursed: nonnegative.nullable(),
    reportedOutstanding: nonnegative.nullable(),
    reportedAsOf: nullableDate,
    annualRate: rate,
    scheduledTotal: nonnegative.nullable().optional(),
    repaymentAccountId: id.nullable(),
    disbursedOn: nullableDate,
    notes: text.optional(),
  }),
  emis: z.object({
    ...owned,
    loanId: id,
    number: z.number().int().min(1).max(1200),
    dueDate: date,
    amount: positive,
    principalPortion: nonnegative.nullable().optional(),
    interestPortion: nonnegative.nullable().optional(),
  }),
  emiAllocations: z.object({
    ...owned,
    emiId: id,
    transactionId: id,
    amount: positive,
  }),
  groups: z.object({
    ...owned,
    kind: z.enum(["expense", "contribution_pool"]).optional(),
    title: short,
    occurredOn: date,
    merchant: z.string().max(120),
    totalCost: positive,
    paidBy: short,
    transactionId: id.nullable(),
    notes: text.optional(),
  }),
  shares: z.object({
    ...owned,
    groupId: id,
    participant: short,
    amount: nonnegative,
    isOwner: z.boolean(),
  }),
  settlements: z.object({
    ...owned,
    groupId: id,
    transactionId: id,
    counterparty: short,
    direction: z.enum(["incoming", "outgoing"]),
    amount: positive,
  }),
  reminders: z.object({
    ...owned,
    title: short,
    billId: id.nullable().optional(),
    emiId: id.nullable().optional(),
    triggerAt: z.iso.datetime({ offset: true }),
    channel: z.enum(["in_app", "email", "push"]),
    enabled: z.boolean(),
    state: z.enum(["scheduled", "sent", "dismissed"]),
  }),
} as const;

export type MutableCollection = keyof typeof recordSchemas;
export const tables = {
  accounts: "accounts",
  snapshots: "account_snapshots",
  transactions: "transactions",
  bills: "bills",
  allocations: "bill_payment_allocations",
  fixedDeposits: "fixed_deposits",
  loans: "loans",
  emis: "emis",
  emiAllocations: "emi_payment_allocations",
  groups: "expense_groups",
  shares: "expense_shares",
  settlements: "settlements",
  reminders: "reminders",
  auditEvents: "audit_events",
} as const;

export function toDatabase(record: Record<string, unknown>, userId: string) {
  return Object.fromEntries(
    Object.entries({ ...record, userId })
      .filter(([key]) => !["createdAt", "updatedAt"].includes(key))
      .map(([key, value]) => [
        key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`),
        value,
      ]),
  );
}
export function fromDatabase(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
}

export function safeDatabaseError(code?: string, message?: string) {
  if (code === "23503")
    return "A linked record was not found in your workspace.";
  if (code === "23505")
    return "This record or source reference already exists.";
  if (code === "42501")
    return "You do not have permission to change this record.";
  if (
    code === "P0001" &&
    message?.startsWith("This transaction is linked to an order or refund")
  )
    return "This transaction is linked to an order or refund. Review its payment links before changing it.";
  if (code === "23514" || code === "22P02")
    return "The record contains an invalid amount, date, or field.";
  if (
    code === "P0001" &&
    message &&
    /^(Allocations exceed|Allocation exceeds|Payment destination|A dated posted|Bill allocation requires|EMI requires|Remove payment allocations|Bill change conflicts|EMI change conflicts|Repayment account has|Account kind with|Shares exceed|Group cost cannot|Settlement needs|Bills require|Allocation does not)/.test(
      message,
    )
  )
    return message;
  return "The database could not save this change. Confirm that migrations are applied and retry.";
}
