import { describe, expect, it } from "vitest";
import { buildImportCommitPlan } from "./imports";
import {
  markCommittedImportRows,
  reviewStatementWorkbook,
} from "./statement-review";
import type { StatementCell, StatementWorkbook } from "./statement-workbook";
import type { Account, Transaction } from "./types";

const owner = "89016082-8f37-49d0-a190-ac5f16f63fe3";
const bankId = "234a0788-4960-4139-891e-59c9c2cfaee0";
const otherBankId = "14d30222-1748-47b8-a2c8-9249ccb613c8";
const cardId = "a9f7a30e-80a1-4c77-920e-048ae78e21bd";
const bank: Account = {
  id: bankId,
  userId: owner,
  name: "Synthetic statement bank",
  institution: "Synthetic institution",
  kind: "bank",
  maskedSuffix: "1234",
  active: true,
};
const accounts: Account[] = [
  bank,
  { ...bank, id: otherBankId, name: "Synthetic other bank" },
  { ...bank, id: cardId, kind: "credit_card", name: "Synthetic credit card" },
];
const header = ["Date", "Details", "Reference", "Debit", "Credit", "Balance"];
const options = { fileName: "fictional-statement.xlsx", userId: owner };
const workbook = (rows: StatementCell[][]): StatementWorkbook => ({
  sheets: [{ name: "Fictional statement", rows: [header, ...rows] }],
});
const debitRow: StatementCell[] = [
  "11/10/2026",
  "Synthetic purchase",
  "SYNTHETIC-DEBIT",
  "20.40",
  null,
  "979.60",
];
const creditRow: StatementCell[] = [
  "12/10/2026",
  "Synthetic credit",
  "SYNTHETIC-CREDIT",
  null,
  "30.60",
  "1010.20",
];

describe("bank statement review boundary", () => {
  it("requires an explicitly selected active bank belonging to the current owner", async () => {
    for (const unavailable of [
      { ...bank, active: false },
      { ...bank, userId: "35ec0848-c49d-467b-9fd4-95b6a56cde69" },
      { ...bank, kind: "wallet" as const },
      { ...bank, kind: "credit_card" as const },
    ]) {
      const review = await reviewStatementWorkbook(
        workbook([debitRow]),
        bankId,
        [unavailable],
        [],
        options,
      );
      expect(review.candidates).toEqual([]);
      expect(review.errors).toContain(
        "Choose an active bank account for this statement.",
      );
      expect(
        buildImportCommitPlan(review, [], { approved: true }).transactions,
      ).toEqual([]);
    }
    const noSelection = await reviewStatementWorkbook(
      workbook([debitRow]),
      "",
      accounts,
      [],
      options,
    );
    expect(noSelection.candidates).toEqual([]);
    const valid = await reviewStatementWorkbook(
      workbook([debitRow]),
      bankId,
      accounts,
      [],
      options,
    );
    expect(valid.fileName).toBe(options.fileName);
    expect(valid.candidates[0]).toMatchObject({
      selected: true,
      accountId: bankId,
      transaction: {
        userId: owner,
        fromAccountId: bankId,
        sourceSystem: "csv",
      },
    });
  });

  it("preserves parser errors so classification or selection cannot make an ambiguous row importable", async () => {
    const ambiguous = [
      "12/10/2026",
      "Synthetic ambiguous movement",
      "SYNTHETIC-AMBIGUOUS",
      "10.00",
      "20.00",
      "990.00",
    ];
    const review = await reviewStatementWorkbook(
      workbook([debitRow, ambiguous]),
      bankId,
      accounts,
      [],
      options,
    );
    const invalid = review.candidates[1];
    expect(invalid).toMatchObject({ status: "needs_review", selected: false });
    expect(
      invalid.errors.some((message) =>
        message.includes("Exactly one of Debit or Credit"),
      ),
    ).toBe(true);
    // A type/selection edit retains the original validation errors.
    invalid.status = "new";
    invalid.selected = true;
    invalid.transaction = {
      ...review.candidates[0].transaction!,
      sourceObjectId: invalid.sourceObjectId,
      kind: "transfer",
      fromAccountId: bankId,
      toAccountId: otherBankId,
    };
    const plan = buildImportCommitPlan(review, [], { approved: true });
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0].description).toBe("Synthetic purchase");
    expect(plan.skipped).toContainEqual({
      candidateId: invalid.id,
      reason:
        "Only valid New rows can be imported; resolve this row in review.",
    });
  });

  it("accepts a reviewed incoming transfer with an explicit source while retaining the statement bank as destination", async () => {
    const review = await reviewStatementWorkbook(
      workbook([creditRow]),
      bankId,
      accounts,
      [],
      options,
    );
    const candidate = review.candidates[0];
    candidate.transaction = {
      ...candidate.transaction!,
      kind: "transfer",
      fromAccountId: otherBankId,
      toAccountId: bankId,
    };
    const plan = buildImportCommitPlan(review, [], { approved: true });
    expect(plan.errors).toEqual([]);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]).toMatchObject({
      kind: "transfer",
      fromAccountId: otherBankId,
      toAccountId: bankId,
      amount: "30.60",
      sourceSystem: "csv",
      sourceObjectId: candidate.sourceObjectId,
    });
    candidate.transaction.fromAccountId = null;
    expect(
      buildImportCommitPlan(review, [], { approved: true }).transactions,
    ).toEqual([]);
  });

  it("deduplicates overlapping references and blocks a conflicting value without overwriting the original", async () => {
    const original: Transaction = {
      id: "9b3d9b99-23c3-49c1-9f97-bab402eddfca",
      userId: owner,
      amount: "30.60",
      currency: "INR",
      kind: "income",
      status: "posted",
      occurredOn: "2026-10-12",
      description: "Synthetic credit",
      fromAccountId: null,
      toAccountId: bankId,
      externalReference: "SYNTHETIC-CREDIT",
    };
    const review = await reviewStatementWorkbook(
      workbook([creditRow]),
      bankId,
      accounts,
      [original],
      options,
    );
    expect(review.candidates[0]).toMatchObject({
      status: "existing_match",
      selected: false,
      matchedTransactionIds: [original.id],
    });
    expect(
      buildImportCommitPlan(review, [original], { approved: true })
        .transactions,
    ).toEqual([]);
    const changed = await reviewStatementWorkbook(
      workbook([[...creditRow.slice(0, 4), "31.60", "1011.20"]]),
      bankId,
      accounts,
      [original],
      options,
    );
    expect(changed.candidates[0]).toMatchObject({
      status: "needs_review",
      selected: false,
    });
    expect(
      buildImportCommitPlan(changed, [original], { approved: true })
        .transactions,
    ).toEqual([]);
    expect(original.amount).toBe("30.60");
  });

  it("marks only saved source rows and keeps an unselected classified payment available for a later approval", async () => {
    const laterRow: StatementCell[] = [
      "12/10/2026",
      "Synthetic card repayment",
      "SYNTHETIC-CARD-PAYMENT",
      "40.00",
      null,
      "939.60",
    ];
    const review = await reviewStatementWorkbook(
      workbook([debitRow, laterRow]),
      bankId,
      accounts,
      [],
      options,
    );
    const later = review.candidates[1];
    later.transaction = {
      ...later.transaction!,
      kind: "bill_payment",
      fromAccountId: bankId,
      toAccountId: cardId,
    };
    later.selected = false;
    const first = buildImportCommitPlan(review, [], { approved: true });
    expect(first.transactions).toHaveLength(1);
    const remaining = markCommittedImportRows(review, first.transactions);
    expect(remaining.candidates[0]).toMatchObject({
      status: "existing_match",
      selected: false,
    });
    expect(remaining.candidates[1]).toBe(later);
    expect(remaining.candidates[1]).toMatchObject({
      status: "new",
      selected: false,
      transaction: { kind: "bill_payment", toAccountId: cardId },
    });
    remaining.candidates[1] = { ...remaining.candidates[1], selected: true };
    expect(
      buildImportCommitPlan(remaining, first.transactions).transactions,
    ).toEqual([]);
    const approvedLater = buildImportCommitPlan(remaining, first.transactions, {
      approved: true,
    });
    expect(approvedLater.transactions).toHaveLength(1);
    expect(approvedLater.transactions[0]).toMatchObject({
      kind: "bill_payment",
      toAccountId: cardId,
      amount: "40.00",
    });
  });
});
