"use client";

import { useRef, useState } from "react";
import {
  Check,
  Download,
  FileSpreadsheet,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { Badge, Section } from "./ui";
import {
  buildImportCommitPlan,
  IMPORT_REFERENCE_CONFLICT,
  MAX_IMPORT_BYTES,
  parseStatementCsv,
  refreshImportCandidateMatches,
  statementFileError,
  type ImportCandidate,
  type ImportReview,
} from "@/lib/imports";
import {
  markCommittedImportRows,
  reviewStatementWorkbook,
} from "@/lib/statement-review";
import type { StatementWorkbook } from "@/lib/statement-workbook";
import { CATEGORIES, type TransactionKind } from "@/lib/types";
import { formatMoney, sumMoney } from "@/lib/finance";

type StatementUpload = {
  fileName: string;
  csv?: string;
  workbook?: StatementWorkbook;
};
const directionError =
  "Choose the other account for this transfer or bill payment.";

export function ImportsPage() {
  const { data, userId, toast, commitImport } = useFinance();
  const [upload, setUpload] = useState<StatementUpload | null>(null);
  const [accountId, setAccountId] = useState("");
  const [review, setReview] = useState<ImportReview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const accounts = data.accounts.filter(
    (row) => row.userId === userId && row.active,
  );
  const bankAccounts = accounts.filter((row) => row.kind === "bank");
  const selected =
    review?.candidates.filter((row) => row.selected && row.status === "new") ??
    [];
  const selectedTotal = sumMoney(
    selected.map((row) => row.transaction?.amount ?? "0"),
  );

  async function createReview(source: StatementUpload, bankId: string) {
    if (source.workbook) {
      if (!bankId) return null;
      return reviewStatementWorkbook(
        source.workbook,
        bankId,
        data.accounts,
        data.transactions,
        { fileName: source.fileName, userId },
      );
    }
    return parseStatementCsv(
      source.csv ?? "",
      data.accounts,
      data.transactions,
      { fileName: source.fileName, userId },
    );
  }

  async function read(file?: File) {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setReview(null);
    setUpload(null);
    setResult(null);
    setApproved(false);
    try {
      const unsupported = statementFileError(file.name);
      if (unsupported) throw new Error(unsupported);
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Choose a statement smaller than 2 MB.");
      const source: StatementUpload = /\.xlsx$/i.test(file.name)
        ? {
            fileName: file.name,
            workbook: await (
              await import("@/lib/statement-workbook")
            ).readStatementWorkbook(file),
          }
        : { fileName: file.name, csv: await file.text() };
      setUpload(source);
      setReview(await createReview(source, accountId));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to read the statement.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function chooseAccount(nextId: string) {
    if (busyRef.current) return;
    setAccountId(nextId);
    setApproved(false);
    setResult(null);
    setReview(null);
    setError("");
    if (!upload) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setReview(await createReview(upload, nextId));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to review the statement.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function editRow(
    id: string,
    edit: (row: ImportCandidate) => ImportCandidate,
  ) {
    setApproved(false);
    setResult(null);
    setReview((current) =>
      current
        ? {
            ...current,
            candidates: current.candidates.map((row) =>
              row.id === id ? edit(row) : row,
            ),
          }
        : current,
    );
  }

  function classifyRow(
    row: ImportCandidate,
    kind: TransactionKind,
    otherAccountId = "",
  ): ImportCandidate {
    if (!row.transaction || !row.accountId) return row;
    const incoming = row.raw.type === "income" || row.raw.type === "refund";
    const paired = kind === "transfer" || kind === "bill_payment";
    const errors = row.errors.filter(
      (note) => note !== directionError && note !== IMPORT_REFERENCE_CONFLICT,
    );
    if (paired && !otherAccountId) errors.push(directionError);
    const next: ImportCandidate = {
      ...row,
      status: errors.length ? "needs_review" : "new",
      selected: !errors.length,
      errors,
      confirmedDistinct: false,
      transaction: {
        ...row.transaction,
        kind,
        fromAccountId: incoming
          ? paired
            ? otherAccountId || null
            : null
          : row.accountId,
        toAccountId: incoming
          ? row.accountId
          : paired
            ? otherAccountId || null
            : null,
      },
    };
    return refreshImportCandidateMatches(next, data.transactions);
  }

  async function commit() {
    if (!review || !approved || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const plan = buildImportCommitPlan(review, data.transactions, {
        approved: true,
      });
      if (plan.errors.length) throw new Error(plan.errors.join(" "));
      const count = plan.transactions.length
        ? await commitImport(plan.transactions, plan.inputHash, review.fileName)
        : 0;
      setResult(count);
      toast(`${count} reviewed transactions imported.`);
      setReview(
        markCommittedImportRows(review, [
          ...data.transactions,
          ...plan.transactions,
        ]),
      );
      if (plan.skipped.some((row) => row.reason !== "Not selected."))
        setError(
          "Some rows now match existing transactions or need review. They were skipped.",
        );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Import could not be saved. Your statement is still available for review.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      setApproved(false);
    }
  }

  return (
    <>
      <div className="import-stepper" aria-label="Statement import steps">
        <span className="current">
          <b>1</b>Upload
        </span>
        <i />
        <span className={review ? "current" : ""}>
          <b>2</b>Review
        </span>
        <i />
        <span className={result !== null ? "current" : ""}>
          <b>3</b>Import
        </span>
      </div>
      <Section
        title="Import a bank statement"
        subtitle="Excel or CSV · up to 2 MB and 1,000 transactions"
      >
        <div
          className="upload-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void read(event.dataTransfer.files[0]);
          }}
        >
          <span className="upload-symbol">
            <Upload size={28} />
          </span>
          <h3>
            {busy
              ? "Reading your statement…"
              : upload
                ? upload.fileName
                : "Drop your Excel or CSV statement here"}
          </h3>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Upload bank statement"
            disabled={busy}
            onChange={(event) => void read(event.target.files?.[0])}
          />
          <button
            className="button primary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <FileSpreadsheet size={16} />
            Choose statement
          </button>
          <a href="/sample-statement.csv" download className="text-link">
            <Download size={13} />
            Sample CSV
          </a>
        </div>
        {(!upload || upload.workbook) && (
          <div className="statement-account">
            <label htmlFor="statement-bank-account">Bank account</label>
            <select
              id="statement-bank-account"
              value={accountId}
              disabled={busy}
              onChange={(event) => void chooseAccount(event.target.value)}
            >
              <option value="">
                Select the account this statement belongs to
              </option>
              {bankAccounts.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.maskedSuffix ? ` · ${row.maskedSuffix}` : ""}
                </option>
              ))}
            </select>
            {bankAccounts.length === 0 ? (
              <p>Add an active bank account in Accounts first.</p>
            ) : upload?.workbook && !accountId ? (
              <p role="status">
                Choose a bank account to review the Excel transactions.
              </p>
            ) : null}
          </div>
        )}
        <div className="import-help">
          <ShieldCheck size={17} />
          <p>
            Read on your device. Review transactions before saving. Excel: Date,
            Details, Debit and Credit columns. CSV: use the sample format.
          </p>
        </div>
      </Section>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {result !== null && (
        <div role="status" className="info-banner green-text">
          <Check size={18} />
          {result} rows imported. Already imported rows are skipped when
          uploaded again.
        </div>
      )}
      {review && (
        <Section
          title="Review import candidates"
          subtitle={`${review.candidates.length} rows · ${review.candidates.filter((row) => row.status === "existing_match").length} existing matches`}
        >
          {review.statementSummary && (
            <div className="statement-summary">
              <span>
                {review.statementSummary.firstDate} to{" "}
                {review.statementSummary.lastDate}
              </span>
              {review.statementSummary.closingBalance !== undefined && (
                <span>
                  Statement closing balance:{" "}
                  <strong>
                    {formatMoney(review.statementSummary.closingBalance)}
                  </strong>
                </span>
              )}
              <small>
                Balances are shown for reference. This import adds transactions;
                reported account balances remain separate.
              </small>
            </div>
          )}
          {!!upload?.workbook && (
            <p className="statement-review-hint">
              Debits start as expenses and credits as income. Review transfers,
              refunds and card payments below.
            </p>
          )}
          {review.errors.length > 0 && (
            <p role="alert" className="error">
              {review.errors.join(" ")}
            </p>
          )}
          {review.candidates.length > 0 && (
            <>
              <div className="statement-selection">
                <label className="check-row">
                  <input
                    type="checkbox"
                    aria-label="Select all new rows"
                    checked={
                      review.candidates.some((row) => row.status === "new") &&
                      review.candidates
                        .filter((row) => row.status === "new")
                        .every((row) => row.selected)
                    }
                    disabled={busy}
                    onChange={(event) => {
                      setApproved(false);
                      const checked = event.target.checked;
                      setReview((current) =>
                        current
                          ? {
                              ...current,
                              candidates: current.candidates.map((row) =>
                                row.status === "new"
                                  ? { ...row, selected: checked }
                                  : row,
                              ),
                            }
                          : current,
                      );
                    }}
                  />
                  Select all new rows
                </label>
                <span>
                  {selected.length} selected · {formatMoney(selectedTotal)}
                </span>
              </div>
              <div className="statement-candidates">
                {review.candidates.map((row) => {
                  const transaction = row.transaction;
                  const canClassify = Boolean(
                    upload?.workbook &&
                    transaction &&
                    !["existing_match", "possible_duplicate"].includes(
                      row.status,
                    ) &&
                    row.errors.every(
                      (note) =>
                        note === directionError ||
                        note === IMPORT_REFERENCE_CONFLICT,
                    ),
                  );
                  const incoming =
                    row.raw.type === "income" || row.raw.type === "refund";
                  const paired =
                    transaction?.kind === "transfer" ||
                    transaction?.kind === "bill_payment";
                  return (
                    <article
                      className="statement-candidate"
                      key={row.id}
                      aria-label={`Statement row ${row.rowNumber}`}
                    >
                      <div className="statement-candidate-heading">
                        <input
                          aria-label={`Select import row ${row.rowNumber}`}
                          type="checkbox"
                          checked={row.selected}
                          disabled={busy || row.status !== "new"}
                          onChange={(event) =>
                            editRow(row.id, (current) => ({
                              ...current,
                              selected: event.target.checked,
                            }))
                          }
                        />
                        <div className="grow">
                          <strong>
                            {transaction?.description ||
                              row.raw.description ||
                              `Row ${row.rowNumber}`}
                          </strong>
                          <small>
                            {transaction?.occurredOn || "Date unclear"} ·{" "}
                            {accounts.find(
                              (account) => account.id === row.accountId,
                            )?.name ||
                              row.raw.account ||
                              "Unknown account"}
                          </small>
                        </div>
                        <strong className="statement-amount">
                          {transaction
                            ? formatMoney(transaction.amount)
                            : row.raw.amount}
                        </strong>
                      </div>
                      <div className="statement-row-status">
                        <Badge
                          tone={
                            row.status === "new"
                              ? "green"
                              : row.status === "existing_match"
                                ? "blue"
                                : "amber"
                          }
                        >
                          {row.status.replaceAll("_", " ")}
                        </Badge>
                        <span>
                          {transaction?.kind.replaceAll("_", " ")}
                          {transaction?.externalReference
                            ? ` · Ref: ${transaction.externalReference}`
                            : ""}
                        </span>
                      </div>
                      {canClassify && (
                        <div className="statement-row-fields">
                          <label>
                            Type
                            <select
                              aria-label={`Type for row ${row.rowNumber}`}
                              disabled={busy}
                              value={transaction?.kind}
                              onChange={(event) =>
                                editRow(row.id, (current) =>
                                  classifyRow(
                                    current,
                                    event.target.value as TransactionKind,
                                  ),
                                )
                              }
                            >
                              {incoming ? (
                                <>
                                  <option value="income">Income</option>
                                  <option value="refund">Refund</option>
                                </>
                              ) : (
                                <option value="expense">Expense</option>
                              )}
                              <option value="transfer">Transfer</option>
                              {!incoming && (
                                <option value="bill_payment">
                                  Card / bill payment
                                </option>
                              )}
                            </select>
                          </label>
                          {paired ? (
                            <label>
                              {incoming ? "From account" : "To account"}
                              <select
                                aria-label={`Other account for row ${row.rowNumber}`}
                                disabled={busy}
                                value={
                                  (incoming
                                    ? transaction?.fromAccountId
                                    : transaction?.toAccountId) ?? ""
                                }
                                onChange={(event) =>
                                  editRow(row.id, (current) =>
                                    classifyRow(
                                      current,
                                      current.transaction!.kind,
                                      event.target.value,
                                    ),
                                  )
                                }
                              >
                                <option value="">
                                  Choose the other account
                                </option>
                                {accounts
                                  .filter(
                                    (account) =>
                                      account.id !== row.accountId &&
                                      (transaction?.kind !== "bill_payment" ||
                                        account.kind === "credit_card" ||
                                        account.kind === "pay_later"),
                                  )
                                  .map((account) => (
                                    <option key={account.id} value={account.id}>
                                      {account.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          ) : (
                            <label>
                              Category
                              <select
                                aria-label={`Category for row ${row.rowNumber}`}
                                disabled={busy}
                                value={transaction?.category ?? "Other"}
                                onChange={(event) =>
                                  editRow(row.id, (current) => ({
                                    ...current,
                                    transaction: current.transaction
                                      ? {
                                          ...current.transaction,
                                          category: event.target.value,
                                        }
                                      : null,
                                  }))
                                }
                              >
                                {CATEGORIES.map((category) => (
                                  <option key={category} value={category}>
                                    {category}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                      {(row.errors.length > 0 || row.warnings.length > 0) && (
                        <p className="statement-row-note">
                          {[...row.errors, ...row.warnings].join(" ")}
                        </p>
                      )}
                      {row.status === "possible_duplicate" && (
                        <button
                          className="text-link"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            editRow(row.id, (current) => ({
                              ...current,
                              status: "new",
                              selected: true,
                              confirmedDistinct: true,
                            }))
                          }
                        >
                          Keep as separate purchase
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
              <div className="import-approval">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={approved}
                    disabled={busy || review.errors.length > 0}
                    onChange={(event) => setApproved(event.target.checked)}
                  />
                  I have reviewed the selected rows and approve these ledger
                  changes.
                </label>
                <button
                  className="button primary"
                  disabled={
                    !approved ||
                    busy ||
                    !selected.length ||
                    review.errors.length > 0
                  }
                  onClick={() => void commit()}
                >
                  <Check size={16} />
                  {busy
                    ? "Importing…"
                    : `Import ${selected.length} selected rows`}
                </button>
              </div>
            </>
          )}
        </Section>
      )}
      <Section title="Recent import activity">
        <div className="record-list">
          {data.auditEvents
            .filter((event) => event.entityType === "imports")
            .slice()
            .reverse()
            .map((event) => (
              <div className="record-row" key={event.id}>
                <FileSpreadsheet size={20} />
                <span className="grow">
                  <strong>{event.description}</strong>
                  <small>
                    {new Date(event.occurredAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </small>
                </span>
                <Badge tone="green">Committed</Badge>
              </div>
            ))}
          {!data.auditEvents.some(
            (event) => event.entityType === "imports",
          ) && (
            <div className="inline-empty">
              Your reviewed imports will appear here.
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
