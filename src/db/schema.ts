// Generated with scripts/generate-db-schema.py. Canonical DDL/security: supabase/migrations.
import { pgTable, uuid, text, numeric, boolean, integer, date, timestamp, jsonb, unique, foreignKey } from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  preferences: jsonb("preferences").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.name),
  foreignKey({ columns: [table.userId, table.parentId], foreignColumns: [table.userId, table.id] }),
]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  institution: text("institution").notNull().default(""),
  kind: text("kind").notNull(),
  maskedSuffix: text("masked_suffix").notNull().default(""),
  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }),
  openingBalanceDate: date("opening_balance_date", { mode: "string" }),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  accent: text("accent"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
]);

export const accountSnapshots = pgTable("account_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  accountId: uuid("account_id").notNull(),
  asOf: timestamp("as_of", { withTimezone: true, mode: "string" }).notNull(),
  reportedBalance: numeric("reported_balance", { precision: 14, scale: 2 }),
  reportedOutstanding: numeric("reported_outstanding", { precision: 14, scale: 2 }),
  reportedUtilized: numeric("reported_utilized", { precision: 14, scale: 2 }),
  reportedAvailable: numeric("reported_available", { precision: 14, scale: 2 }),
  reportedUnbilled: numeric("reported_unbilled", { precision: 14, scale: 2 }),
  nextStatementDate: date("next_statement_date", { mode: "string" }),
  source: text("source").notNull(),
  verifiedByUser: boolean("verified_by_user").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.accountId], foreignColumns: [accounts.userId, accounts.id] }),
]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  secureStoragePath: text("secure_storage_path").notNull(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  parsedState: text("parsed_state").notNull().default("unparsed"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.fileHash),
]);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  source: text("source").notNull(),
  inputHash: text("input_hash").notNull(),
  fileName: text("file_name"),
  documentId: uuid("document_id"),
  state: text("state").notNull().default("review"),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.source, table.inputHash),
  foreignKey({ columns: [table.userId, table.documentId], foreignColumns: [documents.userId, documents.id] }),
]);

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending_review"),
  occurredOn: date("occurred_on", { mode: "string" }),
  description: text("description").notNull(),
  fromAccountId: uuid("from_account_id"),
  toAccountId: uuid("to_account_id"),
  category: text("category"),
  categoryId: uuid("category_id"),
  subcategory: text("subcategory"),
  merchant: text("merchant"),
  externalPayer: text("external_payer"),
  externalReference: text("external_reference"),
  sourceSystem: text("source_system"),
  sourceObjectId: text("source_object_id"),
  receiptDocumentId: uuid("receipt_document_id"),
  refundOfTransactionId: uuid("refund_of_transaction_id"),
  importBatchId: uuid("import_batch_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  platform: text("platform"),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.fromAccountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ columns: [table.userId, table.toAccountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ columns: [table.userId, table.categoryId], foreignColumns: [categories.userId, categories.id] }),
  foreignKey({ columns: [table.userId, table.receiptDocumentId], foreignColumns: [documents.userId, documents.id] }),
  foreignKey({ columns: [table.userId, table.refundOfTransactionId], foreignColumns: [table.userId, table.id] }),
  foreignKey({ columns: [table.userId, table.importBatchId], foreignColumns: [importBatches.userId, importBatches.id] }),
]);

export const bills = pgTable("bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  accountId: uuid("account_id").notNull(),
  statementAmount: numeric("statement_amount", { precision: 14, scale: 2 }).notNull(),
  statementDate: date("statement_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  minimumDue: numeric("minimum_due", { precision: 14, scale: 2 }),
  statementCredits: numeric("statement_credits", { precision: 14, scale: 2 }).notNull().default("0"),
  documentId: uuid("document_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.accountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ columns: [table.userId, table.documentId], foreignColumns: [documents.userId, documents.id] }),
]);

export const billPaymentAllocations = pgTable("bill_payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  billId: uuid("bill_id").notNull(),
  transactionId: uuid("transaction_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.billId, table.transactionId),
  foreignKey({ columns: [table.userId, table.billId], foreignColumns: [bills.userId, bills.id] }),
  foreignKey({ columns: [table.userId, table.transactionId], foreignColumns: [transactions.userId, transactions.id] }),
]);

export const fixedDeposits = pgTable("fixed_deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  institution: text("institution").notNull(),
  maskedSuffix: text("masked_suffix").notNull().default(""),
  principal: numeric("principal", { precision: 14, scale: 2 }).notNull(),
  openingDate: date("opening_date", { mode: "string" }).notNull(),
  maturityDate: date("maturity_date", { mode: "string" }).notNull(),
  maturityAmount: numeric("maturity_amount", { precision: 14, scale: 2 }),
  annualRate: numeric("annual_rate", { precision: 7, scale: 4 }),
  payoutMethod: text("payout_method").notNull().default("Unconfirmed"),
  maturityInstruction: text("maturity_instruction").notNull().default("unconfirmed"),
  pledged: boolean("pledged").notNull().default(false),
  backingAccountId: uuid("backing_account_id"),
  payoutAccountId: uuid("payout_account_id"),
  statedMaturityInterest: numeric("stated_maturity_interest", { precision: 14, scale: 2 }),
  reportedEncashmentValue: numeric("reported_encashment_value", { precision: 14, scale: 2 }),
  reportedAsOf: date("reported_as_of", { mode: "string" }),
  certificateDocumentId: uuid("certificate_document_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.backingAccountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ columns: [table.userId, table.payoutAccountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ columns: [table.userId, table.certificateDocumentId], foreignColumns: [documents.userId, documents.id] }),
]);

export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  lender: text("lender").notNull(),
  kind: text("kind").notNull().default("institutional"),
  contractualPrincipal: numeric("contractual_principal", { precision: 14, scale: 2 }),
  netDisbursed: numeric("net_disbursed", { precision: 14, scale: 2 }),
  reportedOutstanding: numeric("reported_outstanding", { precision: 14, scale: 2 }),
  reportedAsOf: date("reported_as_of", { mode: "string" }),
  annualRate: numeric("annual_rate", { precision: 7, scale: 4 }),
  scheduledTotal: numeric("scheduled_total", { precision: 14, scale: 2 }),
  repaymentAccountId: uuid("repayment_account_id"),
  disbursedOn: date("disbursed_on", { mode: "string" }),
  documentId: uuid("document_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.repaymentAccountId], foreignColumns: [accounts.userId, accounts.id] }),
  foreignKey({ columns: [table.userId, table.documentId], foreignColumns: [documents.userId, documents.id] }),
]);

export const emis = pgTable("emis", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  loanId: uuid("loan_id").notNull(),
  number: integer("number").notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  principalPortion: numeric("principal_portion", { precision: 14, scale: 2 }),
  interestPortion: numeric("interest_portion", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.loanId, table.number),
  foreignKey({ columns: [table.userId, table.loanId], foreignColumns: [loans.userId, loans.id] }),
]);

export const emiPaymentAllocations = pgTable("emi_payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  emiId: uuid("emi_id").notNull(),
  transactionId: uuid("transaction_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.emiId, table.transactionId),
  foreignKey({ columns: [table.userId, table.emiId], foreignColumns: [emis.userId, emis.id] }),
  foreignKey({ columns: [table.userId, table.transactionId], foreignColumns: [transactions.userId, transactions.id] }),
]);

export const personalLoans = pgTable("personal_loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  person: text("person").notNull(),
  direction: text("direction").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  occurredOn: date("occurred_on", { mode: "string" }),
  dueDate: date("due_date", { mode: "string" }),
  transactionId: uuid("transaction_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.transactionId], foreignColumns: [transactions.userId, transactions.id] }),
]);

export const personalLoanAllocations = pgTable("personal_loan_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  personalLoanId: uuid("personal_loan_id").notNull(),
  transactionId: uuid("transaction_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.personalLoanId, table.transactionId),
  foreignKey({ columns: [table.userId, table.personalLoanId], foreignColumns: [personalLoans.userId, personalLoans.id] }),
  foreignKey({ columns: [table.userId, table.transactionId], foreignColumns: [transactions.userId, transactions.id] }),
]);

export const expenseGroups = pgTable("expense_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  merchant: text("merchant").notNull().default(""),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }).notNull(),
  paidBy: text("paid_by").notNull(),
  transactionId: uuid("transaction_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.transactionId], foreignColumns: [transactions.userId, transactions.id] }),
]);

export const expenseShares = pgTable("expense_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  participant: text("participant").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.groupId, table.participant),
  foreignKey({ columns: [table.userId, table.groupId], foreignColumns: [expenseGroups.userId, expenseGroups.id] }),
]);

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  transactionId: uuid("transaction_id").notNull(),
  counterparty: text("counterparty").notNull(),
  direction: text("direction").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.groupId], foreignColumns: [expenseGroups.userId, expenseGroups.id] }),
  foreignKey({ columns: [table.userId, table.transactionId], foreignColumns: [transactions.userId, transactions.id] }),
]);

export const importCandidates = pgTable("import_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  importBatchId: uuid("import_batch_id").notNull(),
  parsedValues: jsonb("parsed_values").notNull(),
  matchedTransactionId: uuid("matched_transaction_id"),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  decision: text("decision").notNull().default("review"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.importBatchId], foreignColumns: [importBatches.userId, importBatches.id] }),
  foreignKey({ columns: [table.userId, table.matchedTransactionId], foreignColumns: [transactions.userId, transactions.id] }),
]);

export const sourceMappings = pgTable("source_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourceObjectId: text("source_object_id").notNull(),
  entityType: text("entity_type").notNull(),
  localRecordId: uuid("local_record_id").notNull(),
  importBatchId: uuid("import_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  unique().on(table.userId, table.sourceSystem, table.sourceObjectId),
  foreignKey({ columns: [table.userId, table.importBatchId], foreignColumns: [importBatches.userId, importBatches.id] }),
]);

export const reminders = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull(),
  billId: uuid("bill_id"),
  emiId: uuid("emi_id"),
  triggerAt: timestamp("trigger_at", { withTimezone: true, mode: "string" }).notNull(),
  channel: text("channel").notNull().default("in_app"),
  enabled: boolean("enabled").notNull().default(false),
  state: text("state").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
  foreignKey({ columns: [table.userId, table.billId], foreignColumns: [bills.userId, bills.id] }),
  foreignKey({ columns: [table.userId, table.emiId], foreignColumns: [emis.userId, emis.id] }),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  unique().on(table.userId, table.id),
]);
