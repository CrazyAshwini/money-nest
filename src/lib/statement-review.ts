import {
  normalizeStatementWorkbook,
  type StatementWorkbook,
} from "./statement-workbook";
import {
  parseStatementCsv,
  type ImportReview,
  type ImportCandidate,
} from "./imports";
import type { Account, Transaction } from "./types";

/** Workbook metadata stays in memory; only reviewed transaction fields enter the ledger. */
export async function reviewStatementWorkbook(
  workbook: StatementWorkbook,
  accountId: string,
  accounts: Account[],
  transactions: Transaction[],
  options: { fileName: string; userId: string },
): Promise<ImportReview> {
  const account = accounts.find(
    (row) =>
      row.id === accountId &&
      row.userId === options.userId &&
      row.active &&
      row.kind === "bank",
  );
  if (!account)
    return {
      inputHash: "",
      fileName: options.fileName,
      candidates: [],
      errors: ["Choose an active bank account for this statement."],
    };
  const normalized = normalizeStatementWorkbook(workbook, accountId);
  if (normalized.errors.length)
    return {
      inputHash: "",
      fileName: options.fileName,
      candidates: [],
      errors: normalized.errors,
    };
  // The existing atomic import contract uses CSV lineage for normalized statement rows.
  const review = await parseStatementCsv(
    normalized.csv,
    accounts,
    transactions,
    { fileName: "normalized-statement.csv", userId: options.userId },
  );
  review.fileName = options.fileName;
  review.statementSummary = normalized.summary;
  review.candidates = review.candidates.map((row) => {
    const errors = normalized.rowErrors[row.rowNumber] ?? [];
    return errors.length
      ? {
          ...row,
          status: "needs_review",
          selected: false,
          errors: [...row.errors, ...errors],
        }
      : row;
  });
  return review;
}

/** Recheck the same reviewed rows after saving without discarding human classifications. */
export function markCommittedImportRows(
  review: ImportReview,
  committed: Transaction[],
): ImportReview {
  const sources = new Set(
    committed.map((row) => `${row.sourceSystem}:${row.sourceObjectId}`),
  );
  return {
    ...review,
    candidates: review.candidates.map((row): ImportCandidate =>
      row.transaction &&
      sources.has(`${row.transaction.sourceSystem}:${row.sourceObjectId}`)
        ? {
            ...row,
            status: "existing_match",
            selected: false,
            warnings: ["This file row has already been imported."],
          }
        : row,
    ),
  };
}
