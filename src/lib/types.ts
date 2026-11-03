/** All monetary values are base-ten decimal strings. Dates are ISO 8601. */
export type Money = string;
export type AccountKind = "bank" | "wallet" | "credit_card" | "pay_later";
export type TransactionKind =
  "expense" | "income" | "transfer" | "bill_payment" | "refund" | "adjustment";
export type TransactionStatus = "posted" | "pending_review" | "voided";
export type Category =
  | "Food"
  | "Food & Drinks"
  | "Groceries"
  | "Shopping"
  | "Stationery"
  | "Transport"
  | "Education"
  | "Housing"
  | "Utilities"
  | "Subscriptions"
  | "Health"
  | "Travel"
  | "Entertainment"
  | "Gift Given"
  | "Gift Received"
  | "Personal Care"
  | "Other";

export interface OwnedRecord {
  id: string;
  userId: string;
}
export interface Account extends OwnedRecord {
  name: string;
  institution: string;
  kind: AccountKind;
  maskedSuffix: string;
  billingDay?: number | null;
  dueDay?: number | null;
  creditLimit?: Money | null;
  openingBalance?: Money | null;
  openingBalanceDate?: string | null;
  active: boolean;
  notes?: string;
  accent?: string;
}
export interface AccountSnapshot extends OwnedRecord {
  accountId: string;
  asOf: string;
  reportedBalance?: Money | null;
  reportedOutstanding?: Money | null;
  reportedUtilized?: Money | null;
  reportedAvailable?: Money | null;
  reportedUnbilled?: Money | null;
  nextStatementDate?: string | null;
  source: "bank_statement" | "app_screenshot" | "user_report" | "import";
  verifiedByUser: boolean;
}
export interface Transaction extends OwnedRecord {
  amount: Money;
  currency: string;
  kind: TransactionKind;
  status: TransactionStatus;
  occurredOn: string | null;
  description: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  /** Explicit confirmation that this source-account report excludes this same-day movement. */
  fromBalanceSnapshotId?: string | null;
  /** Explicit confirmation that this destination-account report excludes this same-day movement. */
  toBalanceSnapshotId?: string | null;
  category?: string | null;
  subcategory?: string | null;
  /** App or service used to place the purchase, separate from its seller. */
  platform?: string | null;
  /** Seller or restaurant shown on the receipt. */
  merchant?: string | null;
  externalPayer?: string | null;
  externalReference?: string | null;
  sourceSystem?: string | null;
  sourceObjectId?: string | null;
  receiptDocumentId?: string | null;
  refundOfTransactionId?: string | null;
  loanCommand?: string | null;
  loanId?: string | null;
  loanEvent?: "disbursement" | "repayment" | "interest" | "reversal" | null;
  reversesTransactionId?: string | null;
  refundReason?: "merchant_refund" | "shared_reimbursement" | "other" | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface Bill extends OwnedRecord {
  accountId: string;
  statementAmount: Money;
  statementDate: string;
  dueDate: string | null;
  periodStart: string;
  periodEnd: string;
  minimumDue?: Money | null;
  statementCredits?: Money;
  notes?: string;
}
export interface BillAllocation extends OwnedRecord {
  billId: string;
  transactionId: string;
  amount: Money;
  verified: boolean;
  createdAt?: string;
}
export interface FixedDeposit extends OwnedRecord {
  name: string;
  institution: string;
  maskedSuffix: string;
  principal: Money;
  openingDate: string | null;
  maturityDate: string | null;
  maturityAmount?: Money | null;
  annualRate?: string | null;
  payoutMethod: string;
  maturityInstruction: "reinvest" | "withdraw" | "unconfirmed";
  pledged: boolean | null;
  backingAccountId: string | null;
  payoutAccountId: string | null;
  reportedEncashmentValue?: Money | null;
  reportedAsOf?: string | null;
  notes?: string;
}
export interface Loan extends OwnedRecord {
  /** Only new, atomically disbursed agreements use event-derived balances. */
  ledgerManaged?: boolean;
  dueDate?: string | null;
  interestTerms?: string | null;
  name: string;
  lender: string;
  kind: "institutional" | "lent" | "borrowed";
  contractualPrincipal: Money | null;
  netDisbursed: Money | null;
  reportedOutstanding: Money | null;
  reportedAsOf: string | null;
  annualRate?: string | null;
  scheduledTotal?: Money | null;
  repaymentAccountId: string | null;
  disbursedOn: string | null;
  notes?: string;
}
export interface Emi extends OwnedRecord {
  loanId: string;
  number: number;
  dueDate: string;
  amount: Money;
  principalPortion?: Money | null;
  interestPortion?: Money | null;
}
export interface EmiAllocation extends OwnedRecord {
  emiId: string;
  transactionId: string;
  amount: Money;
  createdAt?: string;
}
export type EmiAgreementStatus = "active" | "completed" | "cancelled" | "provisional";
export type EmiInstallmentStatus = "upcoming" | "due" | "partially_paid" | "paid" | "overdue";

export interface EmiInstallment extends OwnedRecord {
  agreementId: string;
  installmentNumber: number;
  billingDate: string;
  dueDate: string;
  principalComponent: Money;
  interestComponent: Money;
  feeComponent: Money;
  totalDue: Money;
  amountPaid: Money;
  principalRepaid: Money;
  status: EmiInstallmentStatus;
}

export interface EmiAgreement extends OwnedRecord {
  accountId: string;
  purchaseTransactionId?: string | null;
  orderIds?: string[];
  purchaseDate: string;
  merchant: string;
  description: string;
  category?: string;
  financedPrincipal: Money;
  annualInterestRate?: string | null;
  totalScheduledInterest: Money;
  processingFee: Money;
  totalScheduledRepayment: Money;
  emiCount: number;
  monthlyPayment: Money;
  principalOutstanding: Money;
  principalRepaid: Money;
  interestBilled: Money;
  interestPaid: Money;
  unbilledFutureInterest: Money;
  feesBilled: Money;
  feesPaid: Money;
  firstBillingDate?: string | null;
  firstDueDate?: string | null;
  status: EmiAgreementStatus;
  installments?: EmiInstallment[];
  notes?: string;
}
export interface ExpenseGroup extends OwnedRecord {
  kind?: "expense" | "contribution_pool";
  title: string;
  occurredOn: string;
  merchant: string;
  totalCost: Money;
  paidBy: string;
  transactionId: string | null;
  notes?: string;
}
export interface ExpenseShare extends OwnedRecord {
  groupId: string;
  participant: string;
  amount: Money;
  isOwner: boolean;
}
export interface Settlement extends OwnedRecord {
  groupId: string;
  transactionId: string;
  counterparty: string;
  direction: "incoming" | "outgoing";
  amount: Money;
}
export interface Reminder extends OwnedRecord {
  title: string;
  billId?: string | null;
  emiId?: string | null;
  triggerAt: string;
  channel: "in_app" | "email" | "push";
  enabled: boolean;
  state: "scheduled" | "sent" | "dismissed";
}
export interface AuditEvent extends OwnedRecord {
  entityType: string;
  entityId: string;
  action: string;
  description: string;
  occurredAt: string;
}
export interface WorkspaceData {
  accounts: Account[];
  snapshots: AccountSnapshot[];
  transactions: Transaction[];
  bills: Bill[];
  allocations: BillAllocation[];
  fixedDeposits: FixedDeposit[];
  loans: Loan[];
  emis: Emi[];
  emiAllocations: EmiAllocation[];
  groups: ExpenseGroup[];
  shares: ExpenseShare[];
  settlements: Settlement[];
  reminders: Reminder[];
  auditEvents: AuditEvent[];
}
export interface WorkspaceDataWithEmi extends WorkspaceData {
  emiAgreements?: EmiAgreement[];
}
export const CATEGORIES: Category[] = [
  "Food",
  "Food & Drinks",
  "Groceries",
  "Shopping",
  "Stationery",
  "Transport",
  "Education",
  "Housing",
  "Utilities",
  "Subscriptions",
  "Health",
  "Travel",
  "Entertainment",
  "Gift Given",
  "Gift Received",
  "Personal Care",
  "Other",
];
export const TRANSACTION_KINDS: TransactionKind[] = [
  "expense",
  "income",
  "transfer",
  "bill_payment",
  "refund",
  "adjustment",
];
export const ACCOUNT_KINDS: AccountKind[] = [
  "bank",
  "wallet",
  "credit_card",
  "pay_later",
];

/** Creation choices only. Legacy adjustment remains a readable internal kind. */
export const ENTRY_TRANSACTION_KINDS: TransactionKind[] = ["expense", "income", "bill_payment", "transfer", "refund"];
export const TRANSACTION_LABELS: Record<TransactionKind, string> = {expense: "Expense", income: "Income", bill_payment: "Bill Repayment", transfer: "Transfer", refund: "Refund / Money Back", adjustment: "Adjustment"};
