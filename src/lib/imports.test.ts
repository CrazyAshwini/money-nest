import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "./types";
import { buildImportCommitPlan, exportTransactionsCsv, parseStatementCsv, statementFileError } from "./imports";

const accounts: Account[] = [
  { id: "bank-1", userId: "owner-1", name: "Demo Savings", institution: "Example Bank", kind: "bank", maskedSuffix: "1024", active: true },
  { id: "wallet-1", userId: "owner-1", name: "Demo Wallet", institution: "Example Wallet", kind: "wallet", maskedSuffix: "", active: true },
];
const header = "date,description,amount,type,account,reference,category";
const statement = `${header}\n2026-10-06,Local grocer,100.40,expense,Demo Savings,BANK-001,Groceries\n`;
function existing(overrides: Partial<Transaction> = {}): Transaction {
  return { id: "tx-1", userId: "owner-1", amount: "100.40", currency: "INR", kind: "expense", status: "posted", occurredOn: "2026-10-06", description: "Local grocer", fromAccountId: "bank-1", toAccountId: null, externalReference: "BANK-001", ...overrides };
}

describe("CSV review and import plans", () => {
  it("keeps seller and platform separate through export and reviewed reimport", async () => {
    const original = existing({ description: "Bikkgane Biryani lunch", platform: "Swiggy", merchant: "Bikkgane Biryani" });
    const csv = exportTransactionsCsv([original], accounts);
    const review = await parseStatementCsv(csv, accounts);
    const plan = buildImportCommitPlan(review, [], { approved: true });
    expect(plan.transactions[0]).toMatchObject({ description: "Bikkgane Biryani lunch", platform: "Swiggy", merchant: "Bikkgane Biryani", amount: "100.40" });
    const legacy = await parseStatementCsv(statement, accounts);
    expect(legacy.candidates[0].transaction).toMatchObject({ platform: null, merchant: null });
  });
  it("preserves escaped quotes, embedded commas, newlines, BOM, CRLF, and exact cents", async () => {
    const review = await parseStatementCsv(`\uFEFF${header}\r\n2026-10-06,"Grocer, ""Market""\r\ncheckout",00100.4,expense,Demo Savings,REF-1,Groceries\r\n`, accounts);
    expect(review.errors).toEqual([]);
    expect(review.candidates[0]).toMatchObject({ status: "new", selected: true, rowNumber: 2, transaction: { description: 'Grocer, "Market"\ncheckout', amount: "100.40" } });
    expect(review.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "06/10/2026", "", "2026-2-03"])("flags invalid/ambiguous date %s without inventing one", async (date) => {
    const review = await parseStatementCsv(`${header}\n${date},Grocer,100.40,expense,Demo Savings,,Groceries`, accounts);
    expect(review.candidates[0].status).toBe("needs_review");
    expect(review.candidates[0].selected).toBe(false);
    expect(review.candidates[0].transaction?.occurredOn).toBeNull();
    expect(buildImportCommitPlan(review, [], { approved: true }).transactions).toEqual([]);
  });

  it("accepts a real leap date", async () => {
    const review = await parseStatementCsv(`${header}\n2028-02-29,Grocer,100.40,expense,bank-1,,Groceries`, accounts);
    expect(review.candidates[0].status).toBe("new");
  });

  it.each(["0", "-10", "+10", "1e3", "1.234", "₹100", "1000000000000", "NaN"])("does not guess or round invalid amount %s", async (amount) => {
    const review = await parseStatementCsv(`${header}\n2026-10-06,Grocer,${amount},expense,Demo Savings,,Groceries`, accounts);
    expect(review.candidates[0].status).toBe("needs_review");
    expect(review.candidates[0].errors.some((error) => error.startsWith("Amount"))).toBe(true);
  });

  it("requires explicit approval and reimporting the same statement inserts zero rows", async () => {
    const review = await parseStatementCsv(statement, accounts);
    expect(buildImportCommitPlan(review, []).transactions).toEqual([]);
    const first = buildImportCommitPlan(review, [], { approved: true });
    expect(first.transactions).toHaveLength(1);
    expect(first.transactions[0].id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(first.transactions[0]).toMatchObject({ sourceSystem: "csv", sourceObjectId: `${review.inputHash}:2` });
    const second = await parseStatementCsv(statement, accounts, first.transactions);
    expect(second.candidates[0].status).toBe("existing_match");
    expect(buildImportCommitPlan(second, first.transactions, { approved: true }).transactions).toEqual([]);
    expect(buildImportCommitPlan(review, first.transactions, { approved: true }).transactions).toEqual([]);
  });

  it("matches reference within its account before suggesting a fingerprint duplicate", async () => {
    const review = await parseStatementCsv(statement, accounts, [existing()]);
    expect(review.candidates[0]).toMatchObject({ status: "existing_match", selected: false, matchedTransactionIds: ["tx-1"] });
    const wrongAccount = await parseStatementCsv(statement, accounts, [existing({ fromAccountId: "wallet-1" })]);
    expect(wrongAccount.candidates[0].status).toBe("new");
  });

  it("gives separate owners distinct globally unique row IDs for the same shared CSV", async () => {
    const firstAccounts = accounts.map((account) => ({ ...account, userId: "10000000-0000-4000-8000-000000000001" }));
    const secondAccounts = accounts.map((account) => ({ ...account, userId: "20000000-0000-4000-8000-000000000002" }));
    const first = buildImportCommitPlan(await parseStatementCsv(statement, firstAccounts), [], { approved: true });
    const second = buildImportCommitPlan(await parseStatementCsv(statement, secondAccounts), [], { approved: true });
    expect(first.transactions[0].id).not.toBe(second.transactions[0].id);
    expect(first.transactions[0].sourceObjectId).toBe(second.transactions[0].sourceObjectId);
  });

  it("flags reference collisions with changed amount instead of overwriting history", async () => {
    const review = await parseStatementCsv(statement, accounts, [existing({ amount: "200.00" })]);
    expect(review.candidates[0].status).toBe("needs_review");
    expect(review.candidates[0].errors[0]).toContain("different or ambiguous values");
    expect(buildImportCommitPlan(review, [existing()], { approved: true }).transactions).toEqual([]);
  });

  it("keeps equal purchases with distinct bank references separate", async () => {
    const review = await parseStatementCsv(`${header}\n2026-10-06,Local grocer,100.40,expense,Demo Savings,BANK-002,Groceries`, accounts, [existing()]);
    expect(review.candidates[0].status).toBe("new");
    expect(buildImportCommitPlan(review, [existing()], { approved: true }).transactions).toHaveLength(1);
  });

  it("requires explicit separate-purchase review for equal rows without references", async () => {
    const original = existing({ externalReference: null });
    const review = await parseStatementCsv(`${header}\n2026-10-06,  LOCAL   GROCER ,100.40,expense,Demo Savings,,Groceries`, accounts, [original]);
    expect(review.candidates[0].status).toBe("possible_duplicate");
    expect(buildImportCommitPlan(review, [original], { approved: true }).transactions).toEqual([]);
    const candidate = review.candidates[0];
    candidate.status = "new"; candidate.selected = true;
    expect(buildImportCommitPlan(review, [original], { approved: true }).transactions).toEqual([]);
    candidate.confirmedDistinct = true;
    const first = buildImportCommitPlan(review, [original], { approved: true });
    expect(first.transactions).toHaveLength(1);
    expect(buildImportCommitPlan(review, [original, ...first.transactions], { approved: true }).transactions).toEqual([]);
  });

  it("does not silently merge repeated equal rows in one file", async () => {
    const row = "2026-10-06,Local grocer,100.40,expense,Demo Savings,,Groceries";
    const review = await parseStatementCsv(`${header}\n${row}\n${row}`, accounts);
    expect(review.candidates.map((candidate) => candidate.status)).toEqual(["new", "possible_duplicate"]);
    expect(buildImportCommitPlan(review, [], { approved: true }).transactions).toHaveLength(1);
    Object.assign(review.candidates[1], { status: "new", selected: true, confirmedDistinct: true });
    expect(buildImportCommitPlan(review, [], { approved: true }).transactions).toHaveLength(2);
  });

  it("catches a duplicate added after the review was created", async () => {
    const review = await parseStatementCsv(statement, accounts);
    expect(review.candidates[0].status).toBe("new");
    const plan = buildImportCommitPlan(review, [existing()], { approved: true });
    expect(plan.transactions).toEqual([]);
    expect(plan.skipped[0].reason).toContain("already exists");
  });

  it("never makes an implicit transfer destination or guesses account identity", async () => {
    const review = await parseStatementCsv(`${header}\n2026-10-06,Wallet topup,31,transfer,Demo Savings,TOPUP-1,Other`, accounts);
    expect(review.candidates[0].status).toBe("needs_review");
    expect(review.candidates[0].errors).toContain("Transfers and bill payments require explicit from_account and to_account mappings. The other account will not be guessed.");
    const duplicateName = await parseStatementCsv(statement, [...accounts, { ...accounts[1], name: "Demo Savings" }]);
    expect(duplicateName.candidates[0].status).toBe("needs_review");
    const wrongOwner = await parseStatementCsv(statement, accounts, [], { userId: "someone-else" });
    expect(wrongOwner.candidates[0].status).toBe("needs_review");
  });

  it("maps explicit two-sided transfers and preserves them through export", async () => {
    const csv = `${header},from_account,to_account\n2026-10-06,Wallet topup,31,transfer,bank-1,TOPUP-1,Other,bank-1,wallet-1`;
    const review = await parseStatementCsv(csv, accounts);
    const plan = buildImportCommitPlan(review, [], { approved: true });
    expect(plan.transactions[0]).toMatchObject({ kind: "transfer", fromAccountId: "bank-1", toAccountId: "wallet-1", amount: "31.00" });
    const roundTrip = await parseStatementCsv(exportTransactionsCsv(plan.transactions, accounts), accounts, plan.transactions);
    expect(roundTrip.candidates[0].status).toBe("existing_match");
  });

  it("requires explicit direction for an adjustment and accepts an incoming correction", async () => {
    const csv = `${header},from_account,to_account\n2026-10-06,Opening correction,31,adjustment,bank-1,,Other,,bank-1`;
    const review = await parseStatementCsv(csv, accounts);
    const plan = buildImportCommitPlan(review, [], { approved: true });
    expect(plan.transactions[0]).toMatchObject({ kind: "adjustment", fromAccountId: null, toAccountId: "bank-1" });
  });

  it("revalidates mutable review drafts before creating the plan", async () => {
    const review = await parseStatementCsv(statement, accounts);
    review.candidates[0].transaction!.kind = "bill_payment";
    expect(buildImportCommitPlan(review, [], { approved: true }).transactions).toEqual([]);
  });

  it("rejects malformed structure and empty/duplicate headers", async () => {
    const duplicate = await parseStatementCsv(`${header},date\n2026-10-06,x,1,expense,bank-1,,,2026-10-06`, accounts);
    expect(duplicate.errors).toContain("CSV headers must be nonempty and unique.");
    const unclosed = await parseStatementCsv(`${header}\n2026-10-06,"Unclosed,100,expense,bank-1,,Other`, accounts);
    expect(unclosed.candidates[0].errors).toContain("Unclosed quoted field.");
    const extraColumns = await parseStatementCsv(`${header}\n2026-10-06,Grocer,1,000.00,expense,bank-1,,Other`, accounts);
    expect(extraColumns.candidates[0].status).toBe("needs_review");
    expect((await parseStatementCsv(header, accounts)).errors).toContain("The CSV contains headers but no transactions.");
  });

  it("rejects PDFs/images rather than claiming OCR or PDF parsing", async () => {
    expect(statementFileError("statement.PDF")).toContain("PDF and image parsing are not available");
    expect(statementFileError("statement.png")).toBeTruthy();
    expect(statementFileError("statement.CSV")).toBeNull();
    expect((await parseStatementCsv(statement, accounts, [], { fileName: "statement.pdf" })).candidates).toEqual([]);
  });

  it("exports spreadsheet formulas as literal text and escapes commas/quotes/newlines", () => {
    const csv = exportTransactionsCsv([existing({ description: '=HYPERLINK("bad", "click")\nnext', externalReference: " @SUM(1+1)", category: "\t+1+1" })], accounts);
    expect(csv).toContain('"\'=HYPERLINK(""bad"", ""click"")\nnext"');
    expect(csv).toContain('"\' @SUM(1+1)"');
    expect(csv).toContain('"\'\t+1+1"');
    expect(csv).toContain('"100.40"');
  });
});
