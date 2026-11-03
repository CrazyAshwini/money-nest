import { z } from "zod";
import Decimal from "decimal.js";
import type { Loan, Transaction, WorkspaceData } from "./types";
import {
  isDebtAccount,
  latestAccountBalanceSnapshot,
  localDateISO,
  sumMoney,
} from "./finance";
import { isoDateSchema, positiveMoneySchema } from "./validation";

const uuid = z.string().uuid();
export const personalLoanCommandSchema = z.object({
  id: uuid,
  interestId: uuid,
  loanId: uuid,
  action: z.enum(["create", "repay", "reverse"]),
  direction: z.enum(["lent", "borrowed"]).optional(),
  person: z.string().trim().min(1).max(100).optional(),
  amount: positiveMoneySchema,
  interest: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,2})?$/)
    .default("0.00"),
  occurredOn: isoDateSchema,
  accountId: uuid,
  dueDate: isoDateSchema.nullish(),
  notes: z.string().max(2000).default(""),
  interestTerms: z.string().max(2000).optional(),
  reversesTransactionId: uuid.optional(),
  balanceSnapshotId: uuid.nullish(),
  balanceIncluded: z.boolean().optional(),
});
export type PersonalLoanCommand = z.infer<typeof personalLoanCommandSchema>;
export function personalLoanSummary(
  data: WorkspaceData,
  loan: Loan,
  today: string,
) {
  const events = data.transactions.filter(
    (t) =>
      t.userId === loan.userId && t.loanId === loan.id && t.status === "posted",
  );
  const principal = sumMoney(
    events.filter((t) => t.loanEvent === "disbursement").map((t) => t.amount),
  );
  const repaid = sumMoney(
    events.filter((t) => t.loanEvent === "repayment").map((t) => t.amount),
  );
  const restored = sumMoney(
    events
      .filter(
        (t) =>
          t.loanEvent === "reversal" &&
          events.some(
            (original) =>
              original.id === t.reversesTransactionId &&
              original.loanEvent === "repayment",
          ),
      )
      .map((t) => t.amount),
  );
  const netRepaid = new Decimal(repaid).minus(restored).toFixed(2);
  const outstanding = new Decimal(principal).minus(netRepaid).toFixed(2);
  return {
    principal,
    repaid: netRepaid,
    outstanding,
    events,
    status: new Decimal(outstanding).isZero()
      ? "Settled"
      : loan.dueDate && loan.dueDate < today
        ? "Overdue"
        : "Active",
  };
}
/** Atomic state transition used by private storage and cloud CAS; balances use the existing ledger. */
export function applyPersonalLoanCommand(
  data: WorkspaceData,
  userId: string,
  input: unknown,
): WorkspaceData {
  const c = personalLoanCommandSchema.parse(input);
  if (c.id === c.interestId) throw new Error("Event identities must differ.");
  const previous = data.transactions.find((t) => t.id === c.id);
  const identity = JSON.stringify(c);
  if (previous) {
    if (
      previous.userId === userId &&
      previous.sourceSystem === "personal_loan" &&
      previous.loanCommand === identity
    )
      return data;
    throw new Error(
      "This event identity was already used for different details.",
    );
  }
  if (data.transactions.some((t) => t.id === c.interestId))
    throw new Error("Interest event identity already exists.");
  const account = data.accounts.find(
    (a) => a.id === c.accountId && a.userId === userId && a.active,
  );
  if (!account || isDebtAccount(account))
    throw new Error("Choose an active bank or wallet in your workspace.");
  let loan = data.loans.find((l) => l.id === c.loanId && l.userId === userId);
  if (c.action === "create") {
    if (data.loans.some((l) => l.id === c.loanId) || !c.direction || !c.person)
      throw new Error("Choose a direction and person for a new agreement.");
    if (c.dueDate && c.dueDate < c.occurredOn)
      throw new Error("Due date cannot precede disbursement.");
    if (!new Decimal(c.interest).isZero())
      throw new Error(
        "Record interest when paid, separately from disbursement.",
      );
    loan = {
      id: c.loanId,
      userId,
      name: c.person,
      lender: c.person,
      kind: c.direction,
      ledgerManaged: true,
      contractualPrincipal: new Decimal(c.amount).toFixed(2),
      netDisbursed: new Decimal(c.amount).toFixed(2),
      reportedOutstanding: null,
      reportedAsOf: null,
      repaymentAccountId: c.accountId,
      disbursedOn: c.occurredOn,
      dueDate: c.dueDate ?? null,
      interestTerms: c.interestTerms ?? null,
      notes: c.notes,
    };
  }
  if (!loan?.ledgerManaged || loan.kind === "institutional")
    throw new Error("Use a linked personal loan agreement.");
  if (loan.disbursedOn && c.occurredOn < loan.disbursedOn)
    throw new Error("An event cannot precede disbursement.");
  const summary = personalLoanSummary(data, loan, c.occurredOn);
  if (c.action === "repay" && new Decimal(c.amount).gt(summary.outstanding))
    throw new Error("Principal repayment exceeds the outstanding balance.");
  let outgoing =
    c.action === "create" ? loan.kind === "lent" : loan.kind === "borrowed";
  let original: Transaction | undefined;
  if (c.action === "reverse") {
    original = summary.events.find(
      (t) => t.id === c.reversesTransactionId && t.loanEvent === "repayment",
    );
    if (
      !original ||
      summary.events.some((t) => t.reversesTransactionId === original!.id) ||
      original.amount !== new Decimal(c.amount).toFixed(2) ||
      c.occurredOn < original.occurredOn!
    )
      throw new Error(
        "Choose an unreversed repayment and its exact principal amount.",
      );
    outgoing = Boolean(original.toAccountId);
    if (c.accountId !== (original.fromAccountId ?? original.toAccountId))
      throw new Error("Reverse to the original repayment account.");
    if (!new Decimal(c.interest).isZero())
      throw new Error("Reversal interest is derived from the original event.");
  }
  const snapshot = latestAccountBalanceSnapshot(data, account.id, c.occurredOn);
  let anchor: string | null = null;
  if (snapshot && localDateISO(snapshot.asOf) === c.occurredOn) {
    if (c.balanceSnapshotId !== snapshot.id || c.balanceIncluded === undefined)
      throw new Error(
        "Confirm whether the reported balance includes this movement.",
      );
    if (!c.balanceIncluded) anchor = snapshot.id;
  }
  const principal: Transaction = {
    id: c.id,
    userId,
    amount: new Decimal(c.amount).toFixed(2),
    currency: "INR",
    kind: "transfer",
    status: "posted",
    occurredOn: c.occurredOn,
    description: `${c.action === "create" ? (loan.kind === "lent" ? "Loan Given" : "Loan Received") : c.action === "reverse" ? "Repayment reversal" : "Loan repayment"} · ${loan.name}`,
    fromAccountId: outgoing ? account.id : null,
    toAccountId: outgoing ? null : account.id,
    fromBalanceSnapshotId: outgoing ? anchor : null,
    toBalanceSnapshotId: outgoing ? null : anchor,
    loanId: loan.id,
    loanEvent:
      c.action === "create"
        ? "disbursement"
        : c.action === "reverse"
          ? "reversal"
          : "repayment",
    reversesTransactionId: original?.id ?? null,
    sourceSystem: "personal_loan",
    sourceObjectId: c.id,
    loanCommand: identity,
    notes: c.notes,
  };
  const added = [principal];
  const originalInterest =
    original &&
    summary.events.find((t) => t.sourceObjectId === `${original!.id}:interest`);
  const interestAmount = originalInterest?.amount ?? c.interest;
  if (new Decimal(interestAmount).gt(0))
    added.push({
      ...principal,
      id: c.interestId,
      amount: new Decimal(interestAmount).toFixed(2),
      kind: originalInterest
        ? originalInterest.kind === "expense"
          ? "refund"
          : "adjustment"
        : outgoing
          ? "expense"
          : "income",
      refundOfTransactionId:
        originalInterest?.kind === "expense" ? originalInterest.id : null,
      category: "Interest",
      loanEvent: originalInterest ? "reversal" : "interest",
      reversesTransactionId: originalInterest?.id ?? null,
      sourceObjectId: `${c.id}:interest`,
      loanCommand: null,
      description: `${originalInterest ? "Interest reversal" : "Loan interest"} · ${loan.name}`,
    });
  // Existing app allows negative asset balances; retain that policy (no invented overdraft rules).
  const next = {
    ...data,
    loans: c.action === "create" ? [...data.loans, loan] : data.loans,
    transactions: [...data.transactions, ...added],
  };
  if (
    new Decimal(personalLoanSummary(next, loan, c.occurredOn).outstanding).lt(0)
  )
    throw new Error("Principal cannot be overpaid.");
  return next;
}
export function assertPersonalLoanRecordEdit(
  data: WorkspaceData,
  collection: string,
  record: { id: string; loanId?: string | null; ledgerManaged?: boolean },
) {
  if (
    (collection === "transactions" &&
      (record.loanId ||
        data.transactions.some((t) => t.id === record.id && t.loanId))) ||
    (collection === "loans" &&
      (record.ledgerManaged ||
        data.loans.some((l) => l.id === record.id && l.ledgerManaged)))
  )
    throw new Error(
      "Use Loans & Borrowings to record an auditable loan event.",
    );
}
