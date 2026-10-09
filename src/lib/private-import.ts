/** Server/CLI only: private exports must never enter a browser bundle or a public seed. */
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { isoDateSchema, validateWorkspaceRecord } from "./validation";
import type {
  Account,
  Transaction,
  TransactionKind,
  WorkspaceData,
} from "./types";

type SourceRecord = Record<string, unknown>;
export interface PrivateImportResult {
  workspace: WorkspaceData;
  warnings: string[];
  counts: Record<keyof WorkspaceData, number>;
}

const normal = (value: unknown) =>
  typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;
const suffix = (value: unknown) => text(value).match(/\d{1,4}$/)?.[0] ?? "";
const date = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  const result = isoDateSchema.safeParse(value);
  if (!result.success) throw new Error("A private export date is invalid.");
  return result.data;
};
const amount = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(value))
    throw new Error("A private export amount is invalid.");
  return new Decimal(value).toFixed(2);
};
const requiredAmount = (value: unknown): string => {
  const result = amount(value);
  if (result === null)
    throw new Error("A required private export amount is missing.");
  return result;
};
const notes = (value: unknown, prefix = "", limit = 500) =>
  `${prefix}${prefix ? "\n" : ""}Source: ${JSON.stringify(value)}`.slice(
    0,
    limit,
  );
const uuidFor = (ownerId: string, collection: string, sourceId: string) => {
  const hash = createHash("sha256")
    .update(`private-finance-import:v1:${ownerId}:${collection}:${sourceId}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const array = (
  input: SourceRecord,
  key: string,
  required = false,
): SourceRecord[] => {
  const value = input[key];
  if (value == null && !required) return [];
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error(`The private export ${key} collection is invalid.`);
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`The private export ${key} contains an invalid record.`);
    return item as SourceRecord;
  });
};

/** Stable, loss-aware mapping. Unknown dates, balances and payment allocations stay unknown. */
export function mapPrivateFinanceExport(
  input: unknown,
  ownerId: string,
): PrivateImportResult {
  if (!z.string().uuid().safeParse(ownerId).success)
    throw new Error("The private import needs a valid workspace owner.");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("The private export must be a JSON object.");
  const source = input as SourceRecord;
  if (source.currency !== "INR")
    throw new Error("The private export currency must be INR.");
  const exportedOn = date(source.export_as_of);
  if (!exportedOn) throw new Error("The private export needs its as-of date.");
  const importedAt = `${exportedOn}T23:59:59+05:30`;
  const accounts = array(source, "accounts", true);
  const ledger = array(source, "ledger_transactions", true);
  const matches = array(source, "matched_cashflows");
  const warnings: string[] = [];
  const workspace: WorkspaceData = {
    accounts: [],
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
  const owned = (collection: string, id: string) => ({
    id: uuidFor(ownerId, collection, id),
    userId: ownerId,
  });
  const accountRefs = new Map<string, Account>();
  const accountKinds = {
    Bank: "bank",
    Wallet: "wallet",
    "Credit Card": "credit_card",
    "Pay Later": "pay_later",
  } as const;
  accounts.forEach((raw, index) => {
    const sourceId = text(raw.id);
    const name = text(raw.name);
    const kind = accountKinds[text(raw.kind) as keyof typeof accountKinds];
    if (!sourceId || !name || !kind || accountRefs.has(normal(sourceId)))
      throw new Error(
        `Private account record ${index + 1} is invalid or duplicated.`,
      );
    let notePrefix = "Imported report; confirm against provider.";
    if (raw.approved_in_principle_limit != null) {
      notePrefix =
        "Approved-in-principle limit is unconfirmed; no active credit limit assumed.";
      warnings.push(
        "An approved-in-principle Pay Later limit remains unconfirmed.",
      );
    }
    if (raw.known_order_due != null && raw.total_outstanding == null) {
      notePrefix =
        "Known order bill only; total account outstanding is unconfirmed.";
      warnings.push(
        "A known Pay Later order bill is separate from unknown total account debt.",
      );
    }
    const account: Account = {
      ...owned("accounts", sourceId),
      name,
      institution: text(raw.institution, name),
      kind,
      maskedSuffix: suffix(raw.masked_suffix),
      active: true,
      creditLimit: amount(raw.credit_limit),
      openingBalance: amount(raw.opening_balance),
      openingBalanceDate: date(raw.opening_date),
      notes: notes(raw, notePrefix),
    };
    workspace.accounts.push(account);
    accountRefs.set(normal(sourceId), account);
    if (
      accountRefs.has(normal(name)) &&
      accountRefs.get(normal(name)) !== account
    )
      throw new Error(
        `Private account record ${index + 1} has an ambiguous name.`,
      );
    accountRefs.set(normal(name), account);
    const asOf = date(raw.statement_as_of ?? raw.reported_as_of);
    const values = {
      reportedBalance: amount(raw.bank_balance ?? raw.reported_balance),
      reportedOutstanding: amount(
        raw.reported_outstanding ?? raw.total_outstanding,
      ),
      reportedUtilized: amount(raw.reported_utilized),
      reportedAvailable: amount(raw.reported_available),
      reportedUnbilled: amount(raw.reported_unbilled),
    };
    if (asOf && Object.values(values).some((value) => value !== null)) {
      workspace.snapshots.push({
        ...owned("snapshots", sourceId),
        accountId: account.id,
        asOf: `${asOf}T23:59:59+05:30`,
        ...values,
        nextStatementDate: date(raw.next_statement_generation),
        source: "import",
        verifiedByUser: false,
      });
    } else if (Object.values(values).some((value) => value !== null)) {
      warnings.push(
        "A reported balance has no confirmed as-of date and remains in account notes.",
      );
    }
    if (raw.next_bill_date != null) {
      warnings.push(
        "An assumed statement-generation date was preserved as a note, not a payment deadline.",
      );
    }
  });
  const resolveAccount = (reference: unknown): Account | undefined =>
    accountRefs.get(normal(reference));
  const transactions = new Map<string, Transaction>();
  const transactionTypes: Record<string, TransactionKind> = {
    Expense: "expense",
    Income: "income",
    Transfer: "transfer",
    Refund: "refund",
    "Bill Payment": "bill_payment",
  };
  ledger.forEach((raw, index) => {
    const sourceId = text(raw.id);
    let kind = transactionTypes[text(raw.type)];
    if (!sourceId || !kind || transactions.has(sourceId))
      throw new Error(
        `Private transaction record ${index + 1} is invalid or duplicated.`,
      );
    if (raw.currency !== "INR")
      throw new Error(
        `Private transaction record ${index + 1} uses an unsupported currency.`,
      );
    const occurredOn = date(raw.date);
    const linkedMatches = matches.filter(
      (match) =>
        match.incoming_id === sourceId ||
        match.outgoing_id === sourceId ||
        match.purchase_id === sourceId,
    );
    if (
      linkedMatches.some(
        (match) =>
          match.incoming_id === sourceId &&
          ["returned_transfer", "verification_refund"].includes(
            text(match.kind),
          ),
      )
    )
      kind = "transfer";
    let fromAccountId = resolveAccount(raw.from_account)?.id ?? null;
    let toAccountId = resolveAccount(raw.to_account)?.id ?? null;
    const provisionalCardRouting =
      kind === "bill_payment" &&
      /cred/i.test(text(raw.title)) &&
      /unconfirmed|provisional|verify|confirm|assum/i.test(
        `${text(raw.action)} ${text(raw.evidence)}`,
      );
    if (provisionalCardRouting) {
      toAccountId = null;
      warnings.push(
        "A provisional card-payment routing remains unconfirmed; its bank debit is preserved.",
      );
    }
    if (kind === "expense") toAccountId = null;
    if (kind === "income" || kind === "refund") fromAccountId = null;
    if (kind === "bill_payment" && fromAccountId === toAccountId)
      toAccountId = null;
    if (kind === "transfer" && fromAccountId === toAccountId) {
      if (raw.direction === "credit") fromAccountId = null;
      else toAccountId = null;
    }
    const unconfirmedPayer = kind === "expense" && !fromAccountId;
    if (unconfirmedPayer && occurredOn)
      warnings.push(
        "A dated purchase keeps an unconfirmed payment account; it does not change a bank balance.",
      );
    let notePrefix = occurredOn
      ? ""
      : "Date unconfirmed; excluded from posted monthly spending.";
    if (unconfirmedPayer)
      notePrefix += `${notePrefix ? " " : ""}Payment account unconfirmed.`;
    if (kind === "bill_payment" && !toAccountId)
      notePrefix += `${notePrefix ? " " : ""}Receiving credit account unconfirmed; no statement payment allocation assumed.`;
    const transaction: Transaction = {
      ...owned("transactions", sourceId),
      amount: requiredAmount(raw.amount),
      currency: "INR",
      kind,
      status: occurredOn ? "posted" : "pending_review",
      occurredOn,
      description: text(raw.title, `Imported transaction ${index + 1}`),
      fromAccountId,
      toAccountId,
      category: kind === "expense" ? text(raw.category, "Other") : null,
      externalPayer: unconfirmedPayer ? "Payment account unconfirmed" : null,
      sourceSystem: "private_finance_export",
      sourceObjectId: sourceId,
      externalReference: raw.source_row == null ? null : String(raw.source_row),
      notes: notes(
        {
          ...raw,
          ...(linkedMatches.length ? { matched_cashflows: linkedMatches } : {}),
        },
        notePrefix,
        2000,
      ),
      createdAt: importedAt,
      updatedAt: importedAt,
    };
    transactions.set(sourceId, transaction);
    workspace.transactions.push(transaction);
  });
  for (const match of matches) {
    if (match.kind === "rail_ticket_reimbursement") {
      const original = transactions.get(text(match.outgoing_id));
      const refund = transactions.get(text(match.incoming_id));
      if (
        !original ||
        original.kind !== "expense" ||
        !refund ||
        refund.kind !== "refund"
      )
        throw new Error(
          "An imported purchase reimbursement has invalid links.",
        );
      refund.refundOfTransactionId = original.id;
    }
  }
  array(source, "fixed_deposits").forEach((raw, index) => {
    const backingCandidates = accounts.filter(
      (account) =>
        account.kind === "Credit Card" &&
        (normal(raw.secured_card) === normal(account.name) ||
          normal(raw.secured_card).includes(normal(account.id))),
    );
    const backing =
      backingCandidates.length === 1
        ? resolveAccount(backingCandidates[0].id)
        : undefined;
    if (raw.secured_card && !backing)
      throw new Error(
        `Private fixed deposit ${index + 1} has an unconfirmed backing account.`,
      );
    const instruction = text(raw.maturity_instruction).toLowerCase();
    const maturityInstruction = /reinvest|renew/.test(instruction)
      ? "reinvest"
      : /withdraw/.test(instruction)
        ? "withdraw"
        : "unconfirmed";
    const opened = date(raw.opened);
    const maturity = date(raw.maturity);
    if (!opened || !maturity)
      throw new Error(
        `Private fixed deposit ${index + 1} needs confirmed dates.`,
      );
    workspace.fixedDeposits.push({
      ...owned("fixedDeposits", text(raw.id, `${index}:${raw.bank}:${opened}`)),
      name: text(
        raw.name,
        `${text(raw.bank, "Imported bank")} fixed deposit ${index + 1}`,
      ),
      institution: text(raw.bank, "Imported bank"),
      maskedSuffix: suffix(raw.masked_suffix),
      principal: requiredAmount(raw.principal),
      openingDate: opened,
      maturityDate: maturity,
      maturityAmount: amount(raw.maturity_amount),
      annualRate:
        raw.annual_rate_percent == null ? null : text(raw.annual_rate_percent),
      payoutMethod: text(raw.payout, "Unconfirmed"),
      maturityInstruction,
      pledged: Boolean(backing),
      backingAccountId: backing?.id ?? null,
      payoutAccountId: resolveAccount(raw.payout_account)?.id ?? null,
      reportedEncashmentValue: null,
      reportedAsOf: null,
      notes: notes(
        raw,
        "Maturity value is not current cash or a reported encashment value.",
      ),
    });
  });
  const loanRefs = new Map<string, string>();
  array(source, "loans").forEach((raw, index) => {
    const name = text(raw.name);
    if (!name || loanRefs.has(normal(name)))
      throw new Error(`Private loan ${index + 1} is invalid or duplicated.`);
    const loan = {
      ...owned("loans", text(raw.id, name)),
      name,
      lender: text(raw.lender, name),
      kind: "institutional" as const,
      contractualPrincipal: amount(raw.contractual_principal),
      netDisbursed: amount(raw.net_received),
      reportedOutstanding: amount(raw.reported_outstanding),
      reportedAsOf: date(raw.reported_as_of),
      annualRate: raw.interest_rate == null ? null : text(raw.interest_rate),
      scheduledTotal: amount(raw.total_planned_emis),
      repaymentAccountId: resolveAccount(raw.repayment_account)?.id ?? null,
      disbursedOn: date(raw.disbursement_date),
      notes: notes(
        raw,
        "Scheduled total is not lender-confirmed principal or outstanding debt.",
      ),
    };
    workspace.loans.push(loan);
    loanRefs.set(normal(raw.id ?? name), loan.id);
    loanRefs.set(normal(name), loan.id);
  });
  array(source, "emis").forEach((raw, index) => {
    const loanId = loanRefs.get(normal(raw.loan));
    const dueDate = date(raw.due_date);
    if (!loanId || !dueDate || typeof raw.installment !== "number")
      throw new Error(
        `Private installment ${index + 1} has invalid links or dates.`,
      );
    if (new Decimal(amount(raw.paid) ?? "0").gt(0))
      throw new Error(
        "A paid installment needs an identified payment transaction before import.",
      );
    workspace.emis.push({
      ...owned("emis", text(raw.id, `${loanId}:${raw.installment}`)),
      loanId,
      number: raw.installment,
      dueDate,
      amount: requiredAmount(raw.amount),
      principalPortion: null,
      interestPortion: null,
    });
  });
  array(source, "bills").forEach((raw, index) => {
    const account = resolveAccount(raw.account);
    const dueDate = date(raw.due_date);
    const statementAmount = requiredAmount(raw.amount);
    const purchaseMatches = workspace.transactions.filter(
      (transaction) =>
        transaction.kind === "expense" &&
        transaction.status === "posted" &&
        transaction.fromAccountId === account?.id &&
        transaction.amount === statementAmount,
    );
    const statementDate =
      date(raw.statement_date) ??
      (purchaseMatches.length === 1 ? purchaseMatches[0].occurredOn : null);
    if (!account || !statementDate)
      throw new Error(
        `Private bill ${index + 1} needs a confirmed account and purchase/statement date.`,
      );
    if (new Decimal(amount(raw.already_paid) ?? "0").gt(0))
      throw new Error(
        "A paid bill needs an identified payment transaction before import.",
      );
    workspace.bills.push({
      ...owned("bills", text(raw.id, `${account.id}:${index}`)),
      accountId: account.id,
      statementAmount,
      statementDate,
      dueDate,
      periodStart: statementDate,
      periodEnd: statementDate,
      minimumDue: null,
      statementCredits: "0.00",
      notes: notes(
        raw,
        raw.kind === "order_bill"
          ? "Order bill; purchase date used. Statement cycle and total account debt unconfirmed."
          : "Imported bill; billing cycle unconfirmed.",
      ),
    });
  });
  const splits = array(source, "splits");
  splits.forEach((raw, index) => {
    const occurredOn = date(raw.date);
    const name = text(raw.name, `Imported contribution pool ${index + 1}`);
    const payments = array(raw, "payments_to");
    const contributions = array(raw, "incoming_contributions");
    const totalCost = payments
      .reduce(
        (total, payment) => total.plus(requiredAmount(payment.amount)),
        new Decimal(0),
      )
      .toFixed(2);
    if (!occurredOn || new Decimal(totalCost).lte(0))
      throw new Error(
        `Private contribution pool ${index + 1} needs confirmed date and costs.`,
      );
    const group = {
      ...owned("groups", text(raw.id, `${name}:${occurredOn}`)),
      kind: "contribution_pool" as const,
      title: name,
      occurredOn,
      merchant: "Contribution pool",
      totalCost,
      paidBy: "Contribution pool",
      transactionId: null,
      notes: notes(
        raw,
        `Known pool costs already recorded separately. Unallocated difference: ${requiredAmount(raw.unallocated_difference)}. Personal share unconfirmed.`,
      ),
    };
    workspace.groups.push(group);
    contributions.forEach((contribution, contributionIndex) => {
      const contributionAmount = requiredAmount(contribution.amount);
      const payer = text(contribution.payer);
      const candidates = ledger.filter((movement) => {
        const mapped = transactions.get(text(movement.id));
        return (
          payer &&
          movement.date === occurredOn &&
          amount(movement.amount) === contributionAmount &&
          movement.direction === "credit" &&
          mapped?.status === "posted" &&
          mapped.toAccountId &&
          ["transfer", "refund"].includes(mapped.kind) &&
          normal(movement.title).includes(normal(payer))
        );
      });
      if (candidates.length !== 1) {
        warnings.push(
          "An incoming pool contribution has no unique bank movement match and remains unallocated.",
        );
        return;
      }
      workspace.settlements.push({
        ...owned("settlements", `${group.id}:incoming:${contributionIndex}`),
        groupId: group.id,
        transactionId: transactions.get(text(candidates[0].id))!.id,
        counterparty: payer,
        direction: "incoming",
        amount: contributionAmount,
      });
    });
    workspace.auditEvents.push({
      ...owned("auditEvents", `split:${index}`),
      entityType: "split_pool",
      entityId: group.id,
      action: "review_required",
      description: notes(
        raw,
        "Contribution pool preserved. Personal share and purchase allocation unconfirmed; no expense or receivable invented.",
        2000,
      ),
      occurredAt: importedAt,
    });
  });
  if (splits.length)
    warnings.push(
      "A contribution pool is preserved for review; its personal share remains unconfirmed.",
    );
  workspace.auditEvents.push({
    ...owned("auditEvents", "import-summary"),
    entityType: "workspace",
    entityId: ownerId,
    action: "private_import",
    description: notes(
      {
        coverage: source.coverage,
        bank_reconciliation: source.bank_reconciliation,
        known_gaps: source.known_gaps,
      },
      "Private export imported with original cash movements and uncertainty preserved.",
      2000,
    ),
    occurredAt: importedAt,
  });
  // Validate against the complete graph so reimbursements may refer to later source rows.
  for (const collection of Object.keys(workspace) as (keyof WorkspaceData)[]) {
    workspace[collection].forEach((record, index) => {
      try {
        validateWorkspaceRecord(workspace, collection, record, ownerId);
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "invalid record";
        throw new Error(
          `Private import validation failed for ${collection} record ${index + 1}: ${detail}`,
        );
      }
    });
  }
  const counts = Object.fromEntries(
    Object.entries(workspace).map(([collection, rows]) => [
      collection,
      rows.length,
    ]),
  ) as Record<keyof WorkspaceData, number>;
  return { workspace, warnings: [...new Set(warnings)], counts };
}
