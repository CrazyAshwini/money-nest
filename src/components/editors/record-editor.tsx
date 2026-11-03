"use client";
import { useState } from "react";
import Decimal from "decimal.js";
import { useFinance } from "../finance-provider";
import { Modal } from "../ui";
import {
  type Account,
  type Transaction,
  type FixedDeposit,
  type Loan,
} from "@/lib/types";
import {
  accountBalance,
  formatMoney,
  isDebtAccount,
  validateBillAllocation,
  validateEmiAllocation,
} from "@/lib/finance";
import { accountUsage } from "@/lib/usage";
import { ReceiptScanner } from "../receipt-scanner";
import { balanceSnapshotIdForEdit } from "@/lib/transaction-balance-confirmation";
import type { SaveExpectation } from "@/lib/workspace-version";
import type { EditorState } from "./types";
import { amount, human } from "./values";
import { useTransactionEditorState } from "./use-transaction-editor-state";
import { TransactionFields } from "./transaction-fields";
import { AccountFields } from "./account-fields";
import { BillFields } from "./bill-fields";
import { FixedDepositFields } from "./fixed-deposit-fields";
import { LoanFields } from "./loan-fields";
import { AllocationFields } from "./allocation-fields";
import { SnapshotFields } from "./snapshot-fields";
import { EmiFields } from "./emi-fields";
import { GroupFields } from "./group-fields";
import "../account-management.css";
import "../transaction-editor.css";
export function RecordEditor({
  editor,
  onClose,
  returnFocusTo,
}: {
  editor: EditorState;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const { data, userId, today, save, deleteRecord, toast } = useFinance();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newRecordId] = useState(() => crypto.randomUUID());
  const record = "record" in editor ? editor.record : undefined;
  // Capture the version alongside the form's initial values. A background
  // refresh must not upgrade an old draft to the latest record's write token.
  const [saveExpectation] = useState<SaveExpectation | undefined>(() =>
    record && editor.type !== "snapshot"
      ? { expectedUpdatedAt: record.updatedAt ?? null }
      : undefined,
  );
  const names = {
    account: "account",
    transaction: "transaction",
    bill: "statement",
    fd: "fixed deposit",
    loan: "loan",
    group: "shared expense",
    allocation: "payment allocation",
    snapshot: "reported snapshot",
    emi: "installment",
  };
  const base = {
    id: editor.type === "snapshot" ? newRecordId : record?.id || newRecordId,
    userId,
  };
  const transactionEditor = useTransactionEditorState({
    editor,
    data,
    today,
    setError,
  });
  const {
    transaction,
    receipt,
    receiptQueue,
    receiptIndex,
    setReceiptIndex,
    receiptReviewed,
    setReceiptReviewed,
    receiptPaymentConfirmed,
    setReceiptPaymentConfirmed,
    pendingConfirmed,
    balanceChoices,
    sameDayBalances,
    applyReceiptFields,
    applyReceipt,
    applyReceiptBatch,
  } = transactionEditor;
  const text = (f: FormData, key: string) => String(f.get(key) || "").trim();
  const options = data.accounts
    .filter((a) => a.active)
    .map((a) => (
      <option key={a.id} value={a.id}>
        {a.name}
      </option>
    ));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    const f = new FormData(event.currentTarget);
    let successMessage = `${names[editor.type][0].toUpperCase() + names[editor.type].slice(1)} saved.`;
    try {
      if (editor.type === "account") {
        const suffix = text(f, "maskedSuffix");
        if (!/^\d{0,4}$/.test(suffix))
          throw new Error("Enter only the last four digits.");
        await save(
          "accounts",
          {
            ...editor.record,
            ...base,
            name: text(f, "name"),
            institution: text(f, "institution"),
            kind: text(f, "kind") as Account["kind"],
            maskedSuffix: suffix,
            openingBalance: amount(f.get("openingBalance"), true),
            openingBalanceDate: text(f, "openingBalanceDate") || null,
            creditLimit: amount(f.get("creditLimit"), true),
            active: f.get("active") === "on",
            notes: text(f, "notes"),
            accent: editor.record?.accent || "#a3b7ef",
          },
          saveExpectation,
        );
      } else if (editor.type === "transaction") {
        if (receipt && !receiptReviewed)
          throw new Error(
            "Review the extracted details and confirm before saving.",
          );
        const kind = transaction.kind as Transaction["kind"];
        const from = transaction.fromAccountId || null;
        const to = transaction.toAccountId || null;
        const externalPayer = transaction.externalPayer.trim() || null;
        const date = transaction.occurredOn || null;
        if (!from && !to && !externalPayer)
          throw new Error("Choose an account or name the external payer.");
        if (from && from === to)
          throw new Error("Source and destination must be different accounts.");
        if (kind === "expense" && !from && !externalPayer)
          throw new Error("Expenses need a source account or external payer.");
        if ((kind === "income" || kind === "refund") && !to)
          throw new Error("Choose the account that received the money.");
        const value = amount(transaction.amount)!;
        if (new Decimal(value).lte(0))
          throw new Error("Transaction amount must be greater than zero.");
        const externalRepayment = transaction.externalRepayment;
        const lender = transaction.externalLender.trim();
        if (
          externalRepayment &&
          (!from ||
            to ||
            !["bill_payment", "transfer"].includes(kind) ||
            !lender)
        )
          throw new Error(
            "For an external loan repayment, choose its bank source, leave the destination external, and name the lender.",
          );
        const prev = editor.record;
        const canConfirmPending = prev?.status === "pending_review";
        const notes =
          kind === "expense"
            ? transaction.notes === (prev?.notes || "")
              ? prev?.notes || null
              : transaction.notes.trim() || null
            : externalRepayment
              ? `Confirmed external lender: ${lender}. ${transaction.notes.trim()}`.trim()
              : transaction.notes.trim() || null;
        const status: Transaction["status"] =
          prev?.status === "voided"
            ? "voided"
            : !date ||
                (receipt?.requiresPendingReview &&
                  !(receipt.canConfirmPayment && receiptPaymentConfirmed)) ||
                ((kind === "transfer" || kind === "bill_payment") &&
                  (!from || (!to && !externalRepayment)))
              ? "pending_review"
              : receipt
                ? "posted"
                : canConfirmPending && pendingConfirmed
                  ? "posted"
                  : (transaction.status as Transaction["status"]);
        if (
          status === "posted" &&
          sameDayBalances.some(({ choice }) => !choice)
        )
          throw new Error(
            "Choose whether the reported account balance already includes this payment.",
          );
        const snapshotIdForSide = (side: "from" | "to") => {
          const balance = sameDayBalances.find((item) => item.side === side);
          const explicitChoice = balance && balanceChoices[balance.key];
          return balanceSnapshotIdForEdit(
            data,
            prev,
            { userId, fromAccountId: from, toAccountId: to, occurredOn: date },
            side,
            balance &&
              (explicitChoice === "included" || explicitChoice === "excluded")
              ? {
                  snapshotId: balance.snapshot.id,
                  included: explicitChoice === "included",
                }
              : undefined,
          );
        };
        const savedTransaction: Transaction = {
          ...prev,
          ...base,
          id: receiptQueue[receiptIndex]?.id ?? base.id,
          amount: value,
          currency: "INR",
          kind,
          status,
          occurredOn: date,
          description: transaction.description.trim(),
          merchant: transaction.merchant.trim() || null,
          platform: transaction.platform.trim() || null,
          fromAccountId: from,
          toAccountId: to,
          category: transaction.category || "Other",
          externalPayer,
          externalReference: transaction.externalReference || null,
          refundOfTransactionId: transaction.refundOfTransactionId || null,
          notes,
          sourceSystem: receipt ? "receipt_ai" : prev?.sourceSystem || "manual",
          sourceObjectId: receipt?.fingerprint || prev?.sourceObjectId || null,
          fromBalanceSnapshotId: snapshotIdForSide("from"),
          toBalanceSnapshotId: snapshotIdForSide("to"),
        };
        await save("transactions", savedTransaction, saveExpectation);
        if (status === "pending_review") {
          successMessage =
            "Saved as Needs review. This transaction is excluded from account balances.";
        } else if (status === "posted") {
          const updated = {
            ...data,
            transactions: [
              ...data.transactions.filter(
                (item) => item.id !== savedTransaction.id,
              ),
              savedTransaction,
            ],
          };
          const balances = data.accounts.filter(
            (account) => account.id === from || account.id === to,
          );
          successMessage =
            "Transaction saved." +
            balances
              .map((account) => {
                if (isDebtAccount(account)) {
                  const usage = accountUsage(updated, account.id, today);
                  return ` ${account.name}: ${usage.used == null ? "usage unknown" : `${formatMoney(usage.used)} used`}${usage.available == null ? "" : `, ${formatMoney(usage.available)} available`}.`;
                }
                const balance = accountBalance(
                  updated,
                  account.id,
                  today,
                ).current;
                return balance == null
                  ? ""
                  : ` ${account.name}: ${formatMoney(balance)}.`;
              })
              .join("");
        }
      } else if (editor.type === "bill") {
        await save(
          "bills",
          {
            ...editor.record,
            ...base,
            accountId: text(f, "accountId"),
            statementAmount: amount(f.get("statementAmount"))!,
            statementDate: text(f, "statementDate"),
            dueDate: text(f, "dueDate") || null,
            periodStart: text(f, "periodStart"),
            periodEnd: text(f, "periodEnd"),
            minimumDue: amount(f.get("minimumDue"), true),
            statementCredits: amount(f.get("statementCredits"), true) || "0.00",
          },
          saveExpectation,
        );
      } else if (editor.type === "fd") {
        await save(
          "fixedDeposits",
          {
            ...editor.record,
            ...base,
            name: text(f, "name"),
            institution: text(f, "institution"),
            maskedSuffix: text(f, "maskedSuffix"),
            principal: amount(f.get("principal"))!,
            openingDate: text(f, "openingDate") || null,
            maturityDate: text(f, "maturityDate") || null,
            maturityAmount: amount(f.get("maturityAmount"), true),
            annualRate: text(f, "annualRate") || null,
            payoutMethod: editor.record?.payoutMethod || "Unconfirmed",
            maturityInstruction: text(
              f,
              "maturityInstruction",
            ) as FixedDeposit["maturityInstruction"],
            pledged:
              text(f, "backingAccountId") === "__unknown__"
                ? null
                : !!text(f, "backingAccountId"),
            backingAccountId:
              text(f, "backingAccountId") === "__unknown__"
                ? null
                : text(f, "backingAccountId") || null,
            payoutAccountId: text(f, "payoutAccountId") || null,
          },
          saveExpectation,
        );
      } else if (editor.type === "loan") {
        await save(
          "loans",
          {
            ...editor.record,
            ...base,
            name: text(f, "name"),
            lender: text(f, "lender"),
            kind: text(f, "kind") as Loan["kind"],
            contractualPrincipal: amount(f.get("contractualPrincipal"), true),
            netDisbursed: amount(f.get("netDisbursed"), true),
            reportedOutstanding: amount(f.get("reportedOutstanding"), true),
            reportedAsOf: text(f, "reportedAsOf") || null,
            annualRate: text(f, "annualRate") || null,
            repaymentAccountId: text(f, "repaymentAccountId") || null,
            disbursedOn: text(f, "disbursedOn") || null,
          },
          saveExpectation,
        );
      } else if (editor.type === "allocation") {
        const transactionId = text(f, "transactionId");
        const value = amount(f.get("amount"))!;
        if (editor.bill) {
          const result = validateBillAllocation(
            data,
            editor.bill.id,
            transactionId,
            value,
          );
          if (!result.valid)
            throw new Error(result.error || "Invalid allocation");
          await save("allocations", {
            ...base,
            billId: editor.bill.id,
            transactionId,
            amount: value,
            verified: f.get("verified") === "on",
          });
        } else if (editor.emi) {
          const result = validateEmiAllocation(
            data,
            editor.emi.id,
            transactionId,
            value,
          );
          if (!result.valid)
            throw new Error(result.error || "Invalid allocation");
          await save("emiAllocations", {
            ...base,
            emiId: editor.emi.id,
            transactionId,
            amount: value,
          });
        }
      } else if (editor.type === "snapshot") {
        const asOf = new Date(`${text(f, "asOf")}:00+05:30`).toISOString();
        await save("snapshots", {
          ...base,
          accountId: editor.record.id,
          asOf,
          reportedBalance: amount(f.get("reportedBalance"), true),
          reportedOutstanding: amount(f.get("reportedOutstanding"), true),
          reportedUtilized: amount(f.get("reportedUtilized"), true),
          reportedAvailable: amount(f.get("reportedAvailable"), true),
          nextStatementDate: text(f, "nextStatementDate") || null,
          source: "user_report",
          verifiedByUser: false,
        });
      } else if (editor.type === "emi") {
        await save("emis", {
          ...base,
          loanId: editor.loan.id,
          number: Number(text(f, "number")),
          dueDate: text(f, "dueDate"),
          amount: amount(f.get("amount"))!,
          principalPortion: null,
          interestPortion: null,
        });
      } else if (editor.type === "group") {
        const linked = data.transactions.find(
          (t) => t.id === text(f, "transactionId"),
        );
        if (!linked || linked.kind !== "expense" || linked.status !== "posted")
          throw new Error(
            "Link an existing posted expense to avoid duplicating spending.",
          );
        const group = {
          ...base,
          title: text(f, "title"),
          occurredOn: linked.occurredOn!,
          merchant: linked.merchant || linked.description,
          totalCost: linked.amount,
          paidBy: linked.fromAccountId
            ? "You"
            : linked.externalPayer || "Unconfirmed",
          transactionId: linked.id,
        };
        await save("groups", group, saveExpectation);
      }
      if (
        editor.type === "transaction" &&
        receiptQueue.length > 1 &&
        receiptIndex < receiptQueue.length - 1
      ) {
        const nextIndex = receiptIndex + 1;
        setReceiptIndex(nextIndex);
        applyReceiptFields(receiptQueue[nextIndex].receipt);
        toast(
          `Transaction ${nextIndex} of ${receiptQueue.length} saved. Review the next transaction.`,
        );
        return;
      }
      toast(successMessage);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Please check the details.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function handleDeleteTransaction() {
    if (editor.type !== "transaction" || !editor.record?.id || !saveExpectation)
      return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteRecord("transactions", editor.record.id, saveExpectation);
      toast("Transaction deleted", "success");
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to delete transaction.",
      );
      setBusy(false);
      setConfirmDelete(false);
    }
  }
  const transactionTitle = `${editor.type === "transaction" && editor.record ? "Edit" : "Add"} ${human(transaction.kind)}`;
  return (
    <Modal
      title={
        editor.type === "transaction"
          ? transactionTitle
          : `${record && editor.type !== "snapshot" ? "Edit" : "Add"} ${names[editor.type]}`
      }
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      busy={busy}
      headerActions={
        editor.type === "transaction" &&
        !editor.record &&
        !receiptQueue.length ? (
          <ReceiptScanner
            compact
            disabled={busy}
            onApply={applyReceipt}
            onApplyBatch={applyReceiptBatch}
          />
        ) : undefined
      }
      className={
        editor.type === "transaction" ? "transaction-modal" : undefined
      }
      overlayClassName={
        editor.type === "transaction" ? "transaction-modal-overlay" : undefined
      }
      description={
        editor.type === "allocation"
          ? "Apply an existing ledger payment. This does not record another expense."
          : editor.type === "transaction"
            ? editor.record
              ? "Review the transaction details."
              : "Fill in the details or scan a receipt to auto-populate."
            : undefined
      }
    >
      <form onSubmit={submit} className="editor-form">
        {receiptQueue.length > 1 && (
          <div className="receipt-save-review" role="status">
            <strong>
              Transaction {receiptIndex + 1} of {receiptQueue.length}
            </strong>
            <p>
              Review and save each transaction separately. {receiptIndex} saved;{" "}
              {receiptQueue.length - receiptIndex} still to review.
            </p>
          </div>
        )}
        <div className="form-grid">
          {editor.type === "account" && (
            <AccountFields editor={editor} onClose={onClose} />
          )}
          {editor.type === "transaction" && (
            <TransactionFields
              editor={editor}
              data={data}
              userId={userId}
              today={today}
              busy={busy}
              controller={transactionEditor}
            />
          )}
          {editor.type === "bill" && (
            <BillFields editor={editor} data={data} today={today} />
          )}
          {editor.type === "fd" && (
            <FixedDepositFields editor={editor} data={data} options={options} />
          )}
          {editor.type === "loan" && (
            <LoanFields editor={editor} options={options} />
          )}
          {editor.type === "allocation" && (
            <AllocationFields editor={editor} data={data} />
          )}
          {editor.type === "snapshot" && <SnapshotFields today={today} />}
          {editor.type === "emi" && <EmiFields editor={editor} data={data} />}
          {editor.type === "group" && <GroupFields data={data} />}
        </div>
        {receipt && (
          <div className="receipt-save-review">
            <p>
              Receipt details applied. Check the amount, date, category,
              platform and account before saving.
            </p>
            {receipt.paymentStatus &&
              ["pending", "failed"].includes(receipt.paymentStatus) && (
                <p className="receipt-warning">
                  The screenshot shows a {receipt.paymentStatus} payment.
                  Confirm completion only after checking with your bank or
                  provider.
                </p>
              )}
            {receipt.requiresPendingReview &&
              !(receipt.canConfirmPayment && receiptPaymentConfirmed) && (
                <p className="receipt-warning">
                  The payment is unconfirmed or unclear. This transaction will
                  stay in Needs review.
                </p>
              )}
            {receipt.canConfirmPayment && (
              <label className="receipt-review-check">
                <input
                  type="checkbox"
                  checked={receiptPaymentConfirmed}
                  onChange={(event) => {
                    setReceiptPaymentConfirmed(event.target.checked);
                    setReceiptReviewed(false);
                  }}
                />
                <span>I confirmed that this payment was completed.</span>
              </label>
            )}
            <label className="receipt-review-check">
              <input
                type="checkbox"
                checked={receiptReviewed}
                onChange={(event) => setReceiptReviewed(event.target.checked)}
              />
              <span>
                I checked the extracted details, selected the correct account,
                and reviewed possible duplicates.
              </span>
            </label>
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          {editor.type === "transaction" && editor.record?.id && (
            <button
              type="button"
              className={`button ${confirmDelete ? "danger" : ""}`}
              onClick={handleDeleteTransaction}
              disabled={busy}
              style={{ marginRight: "auto" }}
            >
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          )}
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || Boolean(receipt && !receiptReviewed)}
          >
            {busy
              ? "Saving…"
              : receiptQueue.length > 1 &&
                  receiptIndex < receiptQueue.length - 1
                ? "Save and next"
                : "Save " +
                  (editor.type === "transaction"
                    ? human(transaction.kind)
                    : names[editor.type])}
          </button>
        </div>
      </form>
    </Modal>
  );
}
