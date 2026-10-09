import type { Account, Transaction, TransactionKind } from "./types";
import { TRANSACTION_KINDS } from "./types";

export type ImportCandidateStatus = "new" | "existing_match" | "possible_duplicate" | "needs_review";

export interface ImportCandidate {
  id: string;
  rowNumber: number;
  sourceObjectId: string;
  raw: Record<string, string>;
  transaction: Omit<Transaction, "id"> | null;
  accountId: string | null;
  status: ImportCandidateStatus;
  selected: boolean;
  errors: string[];
  warnings: string[];
  matchedTransactionIds: string[];
  /** Explicitly keep an equal purchase after a human reviews the suggested match. */
  confirmedDistinct?: boolean;
}

export interface ImportReview {
  inputHash: string;
  fileName: string;
  candidates: ImportCandidate[];
  errors: string[];
}

export interface ImportCommitPlan {
  inputHash: string;
  transactions: Transaction[];
  skipped: { candidateId: string; reason: string }[];
  errors: string[];
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1_000;

/** Filename validation also lets the upload UI reject PDF/image files before reading them. */
export function statementFileError(fileName: string): string | null {
  return /\.csv$/i.test(fileName)
    ? null
    : "Only CSV statements are supported in this version. PDF and image parsing are not available; export a CSV from your bank or use the sample template.";
}

interface CsvRow { values: string[]; line: number; errors: string[] }

/** RFC 4180 quoting, escaped quotes, CRLF, UTF-8 BOM, and quoted line breaks. */
function readCsv(input: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let values: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;
  let errors: string[] = [];
  const source = input.replace(/^\uFEFF/, "");
  const finishField = () => { values.push(field); field = ""; closedQuote = false; };
  const finishRow = () => {
    finishField();
    if (values.some((value) => value.trim() !== "") || errors.length) rows.push({ values, line: rowLine, errors });
    values = []; errors = [];
  };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else if (character === "\r" || character === "\n") {
        field += "\n";
        if (character === "\r" && source[index + 1] === "\n") index++;
        line++;
      } else field += character;
    } else if (character === ",") finishField();
    else if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r" && source[index + 1] === "\n") index++;
      line++; rowLine = line;
    } else if (character === '"' && !field && !closedQuote) quoted = true;
    else if (character === '"') { errors.push("Unexpected quote in an unquoted field."); field += character; }
    else if (closedQuote) {
      if (!/\s/.test(character)) errors.push("Unexpected text after a closing quote.");
    } else field += character;
  }
  if (quoted) errors.push("Unclosed quoted field.");
  if (field || values.length || errors.length || closedQuote) finishRow();
  return rows;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** No Number conversion, rounding, signs, grouping separators, or scientific notation. */
function positiveAmount(value: string): string | null {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [integer, decimals = ""] = value.split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const fraction = decimals.padEnd(2, "0");
  if (/^0+$/.test(whole + fraction)) return null;
  return `${whole}.${fraction}`;
}

function resolveAccount(value: string, accounts: Account[]): { account: Account | null; error?: string } {
  if (!value) return { account: null };
  const exact = accounts.find((account) => account.id === value);
  const matches = exact ? [exact] : accounts.filter((account) => normalized(account.name) === normalized(value));
  if (matches.length !== 1) return { account: null, error: matches.length ? `Account “${value}” matches more than one account; use its ID.` : `Account “${value}” was not found.` };
  if (!matches[0].active) return { account: null, error: `Account “${value}” is inactive.` };
  return { account: matches[0] };
}

type TransactionDraft = Omit<Transaction, "id">;
function primaryAccount(transaction: TransactionDraft): string | null {
  return transaction.kind === "income" || transaction.kind === "refund"
    ? transaction.toAccountId
    : transaction.fromAccountId ?? transaction.toAccountId;
}

function sameShape(left: TransactionDraft, right: TransactionDraft): boolean {
  return left.userId === right.userId && left.kind === right.kind && left.occurredOn === right.occurredOn &&
    positiveAmount(left.amount) === positiveAmount(right.amount) && normalized(left.description) === normalized(right.description) &&
    left.fromAccountId === right.fromAccountId && left.toAccountId === right.toAccountId;
}

function distinctReferences(left: TransactionDraft, right: TransactionDraft): boolean {
  return Boolean(left.externalReference && right.externalReference && left.externalReference.trim() !== right.externalReference.trim());
}

function exactReference(left: TransactionDraft, right: TransactionDraft): boolean {
  return left.userId === right.userId && Boolean(left.externalReference?.trim()) &&
    left.externalReference?.trim() === right.externalReference?.trim() && primaryAccount(left) === primaryAccount(right);
}

function classify(transaction: TransactionDraft, current: Transaction[]): Pick<ImportCandidate, "status" | "matchedTransactionIds" | "warnings" | "errors"> {
  const owned = current.filter((existing) => existing.userId === transaction.userId);
  const sourceMatches = owned.filter((existing) => existing.sourceSystem === "csv" && existing.sourceObjectId === transaction.sourceObjectId);
  if (sourceMatches.length) {
    return { status: "existing_match", matchedTransactionIds: sourceMatches.map((match) => match.id), warnings: ["This file row has already been imported."], errors: [] };
  }
  const referenceMatches = owned.filter((existing) => exactReference(transaction, existing));
  if (referenceMatches.length) {
    const compatible = referenceMatches.length === 1 && sameShape(transaction, referenceMatches[0]);
    return {
      status: compatible ? "existing_match" : "needs_review",
      matchedTransactionIds: referenceMatches.map((match) => match.id),
      warnings: compatible ? ["This account and bank reference already exist."] : [],
      errors: compatible ? [] : ["This account and reference already exist with different or ambiguous values. Review the original entry; nothing will be overwritten."],
    };
  }
  const possible = owned.filter((existing) => existing.status !== "voided" && sameShape(transaction, existing) && !distinctReferences(transaction, existing));
  return possible.length
    ? { status: "possible_duplicate", matchedTransactionIds: possible.map((match) => match.id), warnings: ["An equal date, amount, description, and account were found. Review whether these are separate purchases; they will not be merged automatically."], errors: [] }
    : { status: "new", matchedTransactionIds: [], warnings: [], errors: [] };
}

export async function parseStatementCsv(
  csv: string,
  accounts: Account[],
  currentTransactions: Transaction[] = [],
  options: { fileName?: string; userId?: string } = {},
): Promise<ImportReview> {
  const fileName = options.fileName ?? "statement.csv";
  const bytes = new TextEncoder().encode(csv);
  const review: ImportReview = { inputHash: "", fileName, candidates: [], errors: [] };
  const fileError = statementFileError(fileName);
  if (fileError) review.errors.push(fileError);
  if (bytes.length > MAX_IMPORT_BYTES) review.errors.push("CSV exceeds the 2 MB upload limit.");
  if (csv.includes("\0")) review.errors.push("The file contains binary content. Upload a UTF-8 CSV file.");
  if (review.errors.length) return review;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  review.inputHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const rows = readCsv(csv);
  if (!rows.length) { review.errors.push("The CSV is empty."); return review; }
  if (rows.length > MAX_IMPORT_ROWS + 1) { review.errors.push("CSV exceeds the 1,000-row import limit."); return review; }
  const header = rows[0];
  const columns = header.values.map((value) => normalized(value).replace(/\s+/g, "_"));
  if (header.errors.length) review.errors.push(...header.errors.map((error) => `Header: ${error}`));
  if (new Set(columns).size !== columns.length || columns.some((column) => !column)) review.errors.push("CSV headers must be nonempty and unique.");
  for (const required of ["date", "description", "amount", "type", "account"]) {
    if (!columns.includes(required)) review.errors.push(`Missing required CSV column: ${required}.`);
  }
  if (review.errors.length) return review;
  if (rows.length === 1) { review.errors.push("The CSV contains headers but no transactions."); return review; }
  const scopedAccounts = options.userId ? accounts.filter((account) => account.userId === options.userId) : accounts;
  const earlier: Transaction[] = [];
  for (const row of rows.slice(1)) {
    const errors = [...row.errors];
    if (row.values.length !== columns.length) errors.push(`Expected ${columns.length} columns; found ${row.values.length}. Quote values containing commas.`);
    const raw = Object.fromEntries(columns.map((column, index) => [column, (row.values[index] ?? "").trim()]));
    const amount = positiveAmount(raw.amount);
    if (!amount) errors.push("Amount must be positive, with at most 12 integer digits and two decimal places; omit currency symbols and commas.");
    if (!validIsoDate(raw.date)) errors.push("Date must be a real calendar date in YYYY-MM-DD format. Missing or ambiguous dates stay in review.");
    if (!raw.description) errors.push("Description is required.");
    const kind = raw.type.toLowerCase() as TransactionKind;
    if (!TRANSACTION_KINDS.includes(kind)) errors.push("Type must be expense, income, refund, transfer, bill_payment, or adjustment.");
    if (raw.currency && raw.currency.toUpperCase() !== "INR") errors.push("Only INR is supported; currency conversion is not inferred.");
    if (raw.status && raw.status !== "posted") errors.push("Only posted transactions can be committed. Review pending or voided entries separately.");
    const account = resolveAccount(raw.account, scopedAccounts);
    const from = resolveAccount(raw.from_account ?? "", scopedAccounts);
    const to = resolveAccount(raw.to_account ?? "", scopedAccounts);
    for (const mapped of [account, from, to]) if (mapped.error) errors.push(mapped.error);
    if (!account.account) errors.push("An unambiguous account is required.");
    const incoming = kind === "income" || kind === "refund";
    const fromAccount = from.account ?? (incoming || kind === "adjustment" ? null : account.account);
    const toAccount = to.account ?? (incoming ? account.account : null);
    if (account.account && (incoming ? toAccount?.id !== account.account.id : (fromAccount ?? toAccount)?.id !== account.account.id)) errors.push("The account column must match the transaction's primary account.");
    if ((kind === "transfer" || kind === "bill_payment") && (!raw.from_account || !raw.to_account || !fromAccount || !toAccount)) errors.push("Transfers and bill payments require explicit from_account and to_account mappings. The other account will not be guessed.");
    if (fromAccount && toAccount && fromAccount.id === toAccount.id) errors.push("Source and destination must be different accounts.");
    if (fromAccount && toAccount && fromAccount.userId !== toAccount.userId) errors.push("Source and destination must belong to the same owner.");
    if (kind === "adjustment" && !raw.from_account && !raw.to_account) errors.push("An adjustment requires an explicit from_account or to_account to confirm its direction.");
    if (kind === "adjustment" && fromAccount && toAccount) errors.push("An adjustment must have exactly one account direction.");
    if (incoming && fromAccount) errors.push("Income and refunds use to_account only; review the transaction type for an internal transfer.");
    if (kind === "expense" && toAccount) errors.push("Expenses use from_account only; review the transaction type for an internal transfer.");
    const sourceObjectId = `${review.inputHash}:${row.line}`;
    const transaction: TransactionDraft | null = account.account && amount && TRANSACTION_KINDS.includes(kind) ? {
      userId: account.account.userId,
      amount, currency: "INR", kind, status: "posted", occurredOn: validIsoDate(raw.date) ? raw.date : null,
      description: raw.description, fromAccountId: fromAccount?.id ?? null, toAccountId: toAccount?.id ?? null,
      category: raw.category || null, externalReference: raw.reference || null,
      sourceSystem: "csv", sourceObjectId,
    } : null;
    const match = errors.length || !transaction ? { status: "needs_review" as const, matchedTransactionIds: [], warnings: [], errors: [] } : classify(transaction, [...currentTransactions, ...earlier]);
    const candidate: ImportCandidate = {
      id: `csv-row-${row.line}`, rowNumber: row.line, sourceObjectId, raw, transaction,
      accountId: account.account?.id ?? null, ...match, errors: [...errors, ...match.errors], selected: match.status === "new",
    };
    review.candidates.push(candidate);
    if (transaction && candidate.status === "new") earlier.push({ id: candidate.id, ...transaction });
  }
  return review;
}

/** Pure plan: the caller persists all rows and their audit event atomically after approval. */
export function buildImportCommitPlan(
  review: ImportReview,
  currentTransactions: Transaction[],
  options: { approved?: boolean } = {},
): ImportCommitPlan {
  const plan: ImportCommitPlan = { inputHash: review.inputHash, transactions: [], skipped: [], errors: [...review.errors] };
  if (!options.approved) plan.errors.push("Review and explicitly confirm this import before committing any transactions.");
  if (!/^[a-f0-9]{64}$/.test(review.inputHash)) plan.errors.push("Invalid import fingerprint; upload and review the CSV again.");
  if (plan.errors.length) return plan;
  for (const candidate of review.candidates) {
    const transaction = candidate.transaction;
    let reason = "";
    if (!candidate.selected) reason = "Not selected.";
    else if (candidate.status !== "new" || candidate.errors.length || !transaction) reason = "Only valid New rows can be imported; resolve this row in review.";
    else if (!validCommitTransaction(transaction) || primaryAccount(transaction) !== candidate.accountId) reason = "Invalid transaction values.";
    else if (transaction.sourceSystem !== "csv" || transaction.sourceObjectId !== candidate.sourceObjectId || candidate.sourceObjectId !== `${review.inputHash}:${candidate.rowNumber}`) reason = "Import lineage changed; upload and review the file again.";
    else {
      const match = classify(transaction, [...currentTransactions, ...plan.transactions]);
      if (match.status === "existing_match" || match.status === "needs_review") reason = "This row or bank reference already exists; skipped after checking the current ledger.";
      else if (match.status === "possible_duplicate" && !candidate.confirmedDistinct) reason = "A possible duplicate appeared in the current ledger; review again before importing.";
    }
    if (reason || !transaction) plan.skipped.push({ candidateId: candidate.id, reason: reason || "Invalid row." });
    else plan.transactions.push({ ...transaction, id: importRowUuid(review.inputHash, candidate.rowNumber, transaction.userId) });
  }
  return plan;
}

function validCommitTransaction(transaction: TransactionDraft): boolean {
  if (!transaction.userId || !transaction.occurredOn || !validIsoDate(transaction.occurredOn) ||
    !positiveAmount(transaction.amount) || !transaction.description.trim() || transaction.status !== "posted" ||
    transaction.currency !== "INR" || !TRANSACTION_KINDS.includes(transaction.kind)) return false;
  const from = transaction.fromAccountId;
  const to = transaction.toAccountId;
  if (!from && !to || from && from === to) return false;
  if (transaction.kind === "expense") return Boolean(from && !to);
  if (transaction.kind === "income" || transaction.kind === "refund") return Boolean(to && !from);
  if (transaction.kind === "transfer" || transaction.kind === "bill_payment") return Boolean(from && to);
  return Boolean(from) !== Boolean(to);
}

/** UUIDv8 scoped to the owner, file digest, and row; source uniqueness remains authoritative. */
function importRowUuid(hash: string, rowNumber: number, userId: string): string {
  const compactOwner = userId.replaceAll("-", "").toLowerCase();
  // Production owners are UUIDs; the fallback supports non-UUID pure-test fixtures.
  const owner = /^[a-f0-9]{32}$/.test(compactOwner)
    ? compactOwner
    : Array.from(new TextEncoder().encode(userId), (byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(32, "0").slice(0, 32);
  const scoped = Array.from({ length: 32 }, (_, index) => (Number.parseInt(hash[index], 16) ^ Number.parseInt(owner[index], 16)).toString(16)).join("");
  const suffix = ((Number.parseInt(scoped.slice(24, 32), 16) ^ rowNumber) >>> 0).toString(16).padStart(8, "0");
  const variant = ((Number.parseInt(scoped[16], 16) & 3) | 8).toString(16);
  return `${scoped.slice(0, 8)}-${scoped.slice(8, 12)}-8${scoped.slice(13, 16)}-${variant}${scoped.slice(17, 20)}-${scoped.slice(20, 24)}${suffix}`;
}

/** Prefix potentially active spreadsheet cells before RFC 4180 escaping. */
function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportTransactionsCsv(transactions: Transaction[], accounts: Account[]): string {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  const columns = ["date", "description", "amount", "type", "account", "reference", "category", "from_account", "to_account", "currency", "status"];
  const rows = transactions.map((transaction) => [
    transaction.occurredOn, transaction.description, transaction.amount, transaction.kind,
    names.get(primaryAccount(transaction) ?? "") ?? primaryAccount(transaction), transaction.externalReference,
    transaction.category, names.get(transaction.fromAccountId ?? "") ?? transaction.fromAccountId,
    names.get(transaction.toAccountId ?? "") ?? transaction.toAccountId, transaction.currency, transaction.status,
  ]);
  return "\uFEFF" + [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
