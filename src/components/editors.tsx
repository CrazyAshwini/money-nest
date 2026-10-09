"use client";
import { useState } from "react";
import Decimal from "decimal.js";
import { useFinance } from "./finance-provider";
import { Modal, Field } from "./ui";
import {
  ACCOUNT_KINDS,
  CATEGORIES,
  TRANSACTION_KINDS,
  type Account,
  type Transaction,
  type Bill,
  type FixedDeposit,
  type Loan,
  type ExpenseGroup,
  type Emi,
} from "@/lib/types";
import { validateBillAllocation, validateEmiAllocation } from "@/lib/finance";
import { ReceiptScanner, type AppliedReceipt } from "./receipt-scanner";

type TransactionValues = {
  description: string;
  amount: string;
  occurredOn: string;
  kind: string;
  category: string;
  merchant: string;
  fromAccountId: string;
  toAccountId: string;
  externalPayer: string;
  externalReference: string;
  status: string;
  refundOfTransactionId: string;
  externalLender: string;
  externalRepayment: boolean;
  notes: string;
};

function transactionValues(
  record: Transaction | undefined,
  today: string,
  externalLender: string,
): TransactionValues {
  return {
    description: record?.description || "",
    amount: record?.amount || "",
    occurredOn: record ? record.occurredOn || "" : today,
    kind: record?.kind || "expense",
    category: record?.category || "Other",
    merchant: record?.merchant || "",
    fromAccountId: record?.fromAccountId || "",
    toAccountId: record?.toAccountId || "",
    externalPayer: record?.externalPayer || "",
    externalReference: record?.externalReference || "",
    status: record?.status || "posted",
    refundOfTransactionId: record?.refundOfTransactionId || "",
    externalLender,
    externalRepayment: Boolean(externalLender),
    notes:
      record?.notes?.replace(/^Confirmed external lender: .*?\.\s*/, "") || "",
  };
}

export type EditorState =
  | { type: "account"; record?: Account }
  | { type: "transaction"; record?: Transaction }
  | { type: "bill"; record?: Bill }
  | { type: "fd"; record?: FixedDeposit }
  | { type: "loan"; record?: Loan }
  | { type: "group"; record?: ExpenseGroup }
  | { type: "allocation"; bill?: Bill; emi?: Emi }
  | { type: "snapshot"; record: Account }
  | { type: "emi"; loan: Loan };
function amount(value: FormDataEntryValue | null, optional = false) {
  const text = String(value || "").trim();
  if (optional && !text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text) || new Decimal(text).lt(0))
    throw new Error("Enter a valid amount with at most two decimal places.");
  return new Decimal(text).toFixed(2);
}
const human = (s: string) => s.replaceAll("_", " ");
export function RecordEditor({
  editor,
  onClose,
}: {
  editor: EditorState;
  onClose: () => void;
}) {
  const { data, userId, today, save, toast } = useFinance();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const record = "record" in editor ? editor.record : undefined;
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
  const base = { id: record?.id || crypto.randomUUID(), userId };
  const allocatedLoan =
    editor.type === "transaction"
      ? data.loans.find((loan) =>
          data.emis.some(
            (emi) =>
              emi.loanId === loan.id &&
              data.emiAllocations.some(
                (allocation) =>
                  allocation.emiId === emi.id &&
                  allocation.transactionId === editor.record?.id,
              ),
          ),
        )
      : undefined;
  const externalLender =
    editor.type === "transaction"
      ? editor.record?.notes?.match(
          /^Confirmed external lender: (.*?)\./,
        )?.[1] ||
        allocatedLoan?.lender ||
        ""
      : "";
  const [transaction, setTransaction] = useState(() =>
    transactionValues(
      editor.type === "transaction" ? editor.record : undefined,
      today,
      externalLender,
    ),
  );
  const [receipt, setReceipt] = useState<AppliedReceipt | null>(null);
  const [receiptReviewed, setReceiptReviewed] = useState(false);
  function updateTransaction<K extends keyof TransactionValues>(
    key: K,
    value: TransactionValues[K],
  ) {
    setTransaction((current) => ({ ...current, [key]: value }));
    setReceiptReviewed(false);
  }
  function applyReceipt(applied: AppliedReceipt) {
    const draft = applied.draft;
    setTransaction({
      ...transactionValues(undefined, "", ""),
      description: draft.description || "",
      amount: draft.amount || "",
      occurredOn: draft.occurredOn || "",
      merchant: draft.merchant || "",
      externalReference: draft.externalReference || "",
      kind: draft.kind || "expense",
      category: draft.category || "Other",
      status: "pending_review",
    });
    setReceipt(applied);
    setReceiptReviewed(false);
    setError("");
  }
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
    setError("");
    setBusy(true);
    const f = new FormData(event.currentTarget);
    try {
      if (editor.type === "account") {
        const suffix = text(f, "maskedSuffix");
        if (!/^\d{0,4}$/.test(suffix))
          throw new Error("Enter only the last four digits.");
        await save("accounts", {
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
        });
      } else if (editor.type === "transaction") {
        if (receipt && !receiptReviewed)
          throw new Error(
            "Review the extracted details and confirm before saving.",
          );
        const kind = text(f, "kind") as Transaction["kind"];
        const from = text(f, "fromAccountId") || null;
        const to = text(f, "toAccountId") || null;
        const externalPayer = text(f, "externalPayer") || null;
        const date = text(f, "occurredOn") || null;
        if (!from && !to && !externalPayer)
          throw new Error("Choose an account or name the external payer.");
        if (from && from === to)
          throw new Error("Source and destination must be different accounts.");
        if (kind === "expense" && !from && !externalPayer)
          throw new Error("Expenses need a source account or external payer.");
        if ((kind === "income" || kind === "refund") && !to)
          throw new Error("Choose the account that received the money.");
        const value = amount(f.get("amount"))!;
        if (new Decimal(value).lte(0))
          throw new Error("Transaction amount must be greater than zero.");
        const externalRepayment = f.get("externalRepayment") === "on";
        const lender = text(f, "externalLender");
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
        const notes = externalRepayment
          ? `Confirmed external lender: ${lender}. ${text(f, "notes")}`.trim()
          : text(f, "notes") || null;
        const prev = editor.record;
        await save("transactions", {
          ...prev,
          ...base,
          amount: value,
          currency: "INR",
          kind,
          status:
            !date ||
            receipt?.requiresPendingReview ||
            ((kind === "transfer" || kind === "bill_payment") &&
              (!from || (!to && !externalRepayment)))
              ? "pending_review"
              : (text(f, "status") as Transaction["status"]),
          occurredOn: date,
          description: text(f, "description"),
          merchant: text(f, "merchant") || null,
          fromAccountId: from,
          toAccountId: to,
          category: text(f, "category") || "Other",
          externalPayer,
          externalReference: text(f, "externalReference") || null,
          refundOfTransactionId: text(f, "refundOfTransactionId") || null,
          notes,
          sourceSystem: receipt ? "receipt_ai" : prev?.sourceSystem || "manual",
          sourceObjectId: receipt?.fingerprint || prev?.sourceObjectId || null,
        });
      } else if (editor.type === "bill") {
        await save("bills", {
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
        });
      } else if (editor.type === "fd") {
        await save("fixedDeposits", {
          ...editor.record,
          ...base,
          name: text(f, "name"),
          institution: text(f, "institution"),
          maskedSuffix: text(f, "maskedSuffix"),
          principal: amount(f.get("principal"))!,
          openingDate: text(f, "openingDate"),
          maturityDate: text(f, "maturityDate"),
          maturityAmount: amount(f.get("maturityAmount"), true),
          annualRate: text(f, "annualRate") || null,
          payoutMethod: "At maturity",
          maturityInstruction: text(
            f,
            "maturityInstruction",
          ) as FixedDeposit["maturityInstruction"],
          pledged: !!text(f, "backingAccountId"),
          backingAccountId: text(f, "backingAccountId") || null,
          payoutAccountId: text(f, "payoutAccountId") || null,
        });
      } else if (editor.type === "loan") {
        await save("loans", {
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
        });
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
          id: crypto.randomUUID(),
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
        await save("groups", group);
      }
      toast(
        `${names[editor.type][0].toUpperCase() + names[editor.type].slice(1)} saved.`,
      );
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
  const input = (
    name: string,
    value: string | number | null | undefined,
    type = "text",
    required = false,
  ) => (
    <input
      name={name}
      type={type}
      defaultValue={value ?? ""}
      required={required}
      step={type === "number" ? "0.01" : undefined}
      min={type === "number" ? "0" : undefined}
    />
  );
  const transactionInput = (
    name: Exclude<keyof TransactionValues, "externalRepayment">,
    type = "text",
    required = false,
  ) => (
    <input
      name={name}
      type={type}
      value={transaction[name]}
      onChange={(event) => updateTransaction(name, event.target.value)}
      required={required}
      step={type === "number" ? "0.01" : undefined}
      min={type === "number" ? "0" : undefined}
    />
  );
  return (
    <Modal
      title={`${record && editor.type !== "snapshot" ? "Edit" : "Add"} ${names[editor.type]}`}
      onClose={onClose}
      description={
        editor.type === "allocation"
          ? "Apply an existing ledger payment. This does not record another expense."
          : undefined
      }
    >
      <form onSubmit={submit} className="editor-form">
        {editor.type === "transaction" && !editor.record && (
          <ReceiptScanner onApply={applyReceipt} />
        )}
        <div className="form-grid">
          {editor.type === "account" && (
            <>
              <Field label="Account name">
                {input("name", editor.record?.name, "text", true)}
              </Field>
              <Field label="Institution">
                {input("institution", editor.record?.institution, "text", true)}
              </Field>
              <Field label="Account type">
                <select
                  name="kind"
                  defaultValue={editor.record?.kind || "bank"}
                >
                  {ACCOUNT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {human(k)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Last four digits only">
                {input("maskedSuffix", editor.record?.maskedSuffix)}
              </Field>
              <Field label="Opening balance · ₹ (optional)">
                {input(
                  "openingBalance",
                  editor.record?.openingBalance,
                  "number",
                )}
              </Field>
              <Field label="Opening balance date">
                {input(
                  "openingBalanceDate",
                  editor.record?.openingBalanceDate,
                  "date",
                )}
              </Field>
              <Field label="Credit limit · ₹ (optional)">
                {input("creditLimit", editor.record?.creditLimit, "number")}
              </Field>
              <Field label="Status">
                <span className="check-row">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editor.record?.active ?? true}
                  />{" "}
                  Active account
                </span>
              </Field>
              <Field label="Notes" className="full">
                {input("notes", editor.record?.notes)}
              </Field>
            </>
          )}
          {editor.type === "transaction" && (
            <>
              <Field label="Description" className="full">
                {transactionInput("description", "text", true)}
              </Field>
              <Field label="Amount · ₹">
                {transactionInput("amount", "number", true)}
              </Field>
              <Field label="Purchase / movement date">
                {transactionInput("occurredOn", "date")}
              </Field>
              <Field label="Transaction type">
                <select
                  name="kind"
                  value={transaction.kind}
                  onChange={(event) =>
                    updateTransaction("kind", event.target.value)
                  }
                >
                  {TRANSACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {human(k)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select
                  name="category"
                  value={transaction.category}
                  onChange={(event) =>
                    updateTransaction("category", event.target.value)
                  }
                >
                  {CATEGORIES.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              <Field label="From account">
                <select
                  name="fromAccountId"
                  value={transaction.fromAccountId}
                  onChange={(event) =>
                    updateTransaction("fromAccountId", event.target.value)
                  }
                >
                  <option value="">Unknown / external</option>
                  {options}
                </select>
              </Field>
              <Field label="To account">
                <select
                  name="toAccountId"
                  value={transaction.toAccountId}
                  onChange={(event) =>
                    updateTransaction("toAccountId", event.target.value)
                  }
                >
                  <option value="">Merchant / unknown</option>
                  {options}
                </select>
              </Field>
              <Field label="External payer (if applicable)">
                {transactionInput("externalPayer")}
              </Field>
              <Field label="Bank reference">
                {transactionInput("externalReference")}
              </Field>
              <Field label="Merchant (optional)">
                {transactionInput("merchant")}
              </Field>
              <Field label="Status">
                <select
                  name="status"
                  value={transaction.status}
                  onChange={(event) =>
                    updateTransaction("status", event.target.value)
                  }
                >
                  <option value="posted">Posted</option>
                  <option value="pending_review">Needs review</option>
                  <option value="voided">Voided</option>
                </select>
              </Field>
              <Field label="Refund of (optional)">
                <select
                  name="refundOfTransactionId"
                  value={transaction.refundOfTransactionId}
                  onChange={(event) =>
                    updateTransaction(
                      "refundOfTransactionId",
                      event.target.value,
                    )
                  }
                >
                  <option value="">Unmatched</option>
                  {data.transactions
                    .filter(
                      (t) =>
                        t.userId === userId &&
                        (t.kind === "expense" ||
                          (t.id === editor.record?.refundOfTransactionId &&
                            t.kind === "transfer")) &&
                        t.status === "posted" &&
                        t.occurredOn &&
                        t.id !== editor.record?.id,
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.description} · ₹{t.amount}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="External lender (for EMI repayment)">
                {transactionInput("externalLender")}
              </Field>
              <Field label="External repayment confirmation">
                <span className="check-row">
                  <input
                    type="checkbox"
                    name="externalRepayment"
                    checked={transaction.externalRepayment}
                    onChange={(event) =>
                      updateTransaction(
                        "externalRepayment",
                        event.target.checked,
                      )
                    }
                  />
                  Confirmed payment to an external lender
                </span>
              </Field>
              <Field label="Notes" className="full">
                {transactionInput("notes")}
              </Field>
              <p className="form-note full">
                An unknown date or incomplete transfer stays in Needs review. A
                confirmed external loan repayment needs a named lender and bank
                source; leave its destination external. Bill repayments and
                transfers are excluded from spending.
              </p>
            </>
          )}
          {editor.type === "bill" && (
            <>
              <Field label="Credit / Pay Later account" className="full">
                <select
                  name="accountId"
                  defaultValue={editor.record?.accountId}
                  required
                >
                  {data.accounts
                    .filter(
                      (a) => a.kind === "credit_card" || a.kind === "pay_later",
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Statement amount · ₹">
                {input(
                  "statementAmount",
                  editor.record?.statementAmount,
                  "number",
                  true,
                )}
              </Field>
              <Field label="Statement date">
                {input(
                  "statementDate",
                  editor.record?.statementDate || today,
                  "date",
                  true,
                )}
              </Field>
              <Field label="Period begins">
                {input(
                  "periodStart",
                  editor.record?.periodStart || `${today.slice(0, 7)}-01`,
                  "date",
                  true,
                )}
              </Field>
              <Field label="Period ends">
                {input(
                  "periodEnd",
                  editor.record?.periodEnd || today,
                  "date",
                  true,
                )}
              </Field>
              <Field label="Confirmed payment due date">
                {input("dueDate", editor.record?.dueDate, "date")}
              </Field>
              <Field label="Minimum due · ₹">
                {input("minimumDue", editor.record?.minimumDue, "number")}
              </Field>
              <Field label="Statement credits · ₹">
                {input(
                  "statementCredits",
                  editor.record?.statementCredits,
                  "number",
                )}
              </Field>
              <p className="form-note full">
                Leave the due date blank until confirmed by the issuer.
                Statement date and payment due date are different.
              </p>
            </>
          )}
          {editor.type === "fd" && (
            <>
              <Field label="Deposit label">
                {input("name", editor.record?.name, "text", true)}
              </Field>
              <Field label="Institution">
                {input("institution", editor.record?.institution, "text", true)}
              </Field>
              <Field label="Principal · ₹">
                {input("principal", editor.record?.principal, "number", true)}
              </Field>
              <Field label="Stated maturity value · ₹">
                {input(
                  "maturityAmount",
                  editor.record?.maturityAmount,
                  "number",
                )}
              </Field>
              <Field label="Opening date">
                {input(
                  "openingDate",
                  editor.record?.openingDate || today,
                  "date",
                  true,
                )}
              </Field>
              <Field label="Maturity date">
                {input(
                  "maturityDate",
                  editor.record?.maturityDate,
                  "date",
                  true,
                )}
              </Field>
              <Field label="Annual rate · %">
                {input("annualRate", editor.record?.annualRate, "number")}
              </Field>
              <Field label="Last four digits">
                {input("maskedSuffix", editor.record?.maskedSuffix)}
              </Field>
              <Field label="Pledged credit card">
                <select
                  name="backingAccountId"
                  defaultValue={editor.record?.backingAccountId || ""}
                >
                  <option value="">Not pledged</option>
                  {data.accounts
                    .filter((a) => a.kind === "credit_card")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Payout account">
                <select
                  name="payoutAccountId"
                  defaultValue={editor.record?.payoutAccountId || ""}
                >
                  <option value="">Unconfirmed</option>
                  {options}
                </select>
              </Field>
              <Field label="Maturity instruction">
                <select
                  name="maturityInstruction"
                  defaultValue={
                    editor.record?.maturityInstruction || "unconfirmed"
                  }
                >
                  <option value="unconfirmed">Unconfirmed</option>
                  <option value="withdraw">Withdraw</option>
                  <option value="reinvest">Reinvest</option>
                </select>
              </Field>
            </>
          )}
          {editor.type === "loan" && (
            <>
              <Field label="Loan name">
                {input("name", editor.record?.name, "text", true)}
              </Field>
              <Field label="Lender / person">
                {input("lender", editor.record?.lender, "text", true)}
              </Field>
              <Field label="Loan type">
                <select
                  name="kind"
                  defaultValue={editor.record?.kind || "institutional"}
                >
                  <option value="institutional">Institutional</option>
                  <option value="lent">Money lent</option>
                  <option value="borrowed">Money borrowed</option>
                </select>
              </Field>
              <Field label="Original contractual principal · ₹">
                {input(
                  "contractualPrincipal",
                  editor.record?.contractualPrincipal,
                  "number",
                )}
              </Field>
              <Field label="Net disbursed · ₹">
                {input("netDisbursed", editor.record?.netDisbursed, "number")}
              </Field>
              <Field label="Reported outstanding · ₹">
                {input(
                  "reportedOutstanding",
                  editor.record?.reportedOutstanding,
                  "number",
                )}
              </Field>
              <Field label="Reported as of">
                {input("reportedAsOf", editor.record?.reportedAsOf, "date")}
              </Field>
              <Field label="Annual rate · %">
                {input("annualRate", editor.record?.annualRate, "number")}
              </Field>
              <Field label="Disbursed on">
                {input("disbursedOn", editor.record?.disbursedOn, "date")}
              </Field>
              <Field label="Repayment account">
                <select
                  name="repaymentAccountId"
                  defaultValue={editor.record?.repaymentAccountId || ""}
                >
                  <option value="">Unconfirmed</option>
                  {options}
                </select>
              </Field>
              <p className="form-note full">
                Unknown values can stay blank. A disbursement is a liability;
                scheduled repayments do not establish an interest breakdown.
              </p>
            </>
          )}
          {editor.type === "allocation" && (
            <>
              <Field label="Existing posted payment" className="full">
                <select name="transactionId" required>
                  <option value="">Choose a ledger transaction</option>
                  {data.transactions
                    .filter(
                      (t) =>
                        t.status === "posted" &&
                        (t.kind === "bill_payment" || t.kind === "transfer"),
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.description} · ₹{t.amount} · {t.occurredOn}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Amount to apply · ₹">
                {input("amount", "", "number", true)}
              </Field>
              {editor.bill && (
                <Field label="Verification">
                  <span className="check-row">
                    <input name="verified" type="checkbox" defaultChecked />{" "}
                    Receiving statement confirms payment
                  </span>
                </Field>
              )}
              <p className="form-note full">
                Allocations cannot exceed the payment or the remaining bill.
                Unverified card allocations remain provisional.
              </p>
            </>
          )}
          {editor.type === "snapshot" && (
            <>
              <Field label="Reported as of · India time">
                {input("asOf", `${today}T12:00`, "datetime-local", true)}
              </Field>
              <Field label="Reported cash balance · ₹">
                {input("reportedBalance", "", "number")}
              </Field>
              <Field label="Reported outstanding · ₹">
                {input("reportedOutstanding", "", "number")}
              </Field>
              <Field label="Reported utilized · ₹">
                {input("reportedUtilized", "", "number")}
              </Field>
              <Field label="Reported available credit · ₹">
                {input("reportedAvailable", "", "number")}
              </Field>
              <Field label="Next statement date (not due date)">
                {input("nextStatementDate", "", "date")}
              </Field>
              <p className="form-note full">
                Saved as user reported. Enter at least one reported amount. This
                snapshot does not change ledger history.
              </p>
            </>
          )}
          {editor.type === "emi" && (
            <>
              <Field label="Installment number">
                {input(
                  "number",
                  data.emis.filter((e) => e.loanId === editor.loan.id).length +
                    1,
                  "number",
                  true,
                )}
              </Field>
              <Field label="Scheduled amount · ₹">
                {input("amount", "", "number", true)}
              </Field>
              <Field label="Exact due date">
                {input("dueDate", "", "date", true)}
              </Field>
              <p className="form-note full">
                An installment becomes paid only when an existing payment is
                allocated.
              </p>
            </>
          )}
          {editor.type === "group" && (
            <>
              <Field label="Event name" className="full">
                {input("title", "", "text", true)}
              </Field>
              <Field label="Existing purchase" className="full">
                <select name="transactionId" required>
                  <option value="">Choose a posted expense</option>
                  {data.transactions
                    .filter(
                      (t) =>
                        t.kind === "expense" &&
                        t.status === "posted" &&
                        t.occurredOn,
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.description} · ₹{t.amount}
                      </option>
                    ))}
                </select>
              </Field>
              <p className="form-note full">
                Add people and their shares from the group detail page.
                Contributions are matched to existing ledger transfers.
              </p>
            </>
          )}
        </div>
        {receipt && (
          <div className="receipt-save-review">
            <p>
              Receipt details applied. Confirm the amount, date, transaction
              type, and account below.
            </p>
            {receipt.requiresPendingReview && (
              <p className="receipt-warning">
                The payment is unconfirmed or unclear. This transaction will
                stay in Needs review.
              </p>
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
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || Boolean(receipt && !receiptReviewed)}
          >
            {busy ? "Saving…" : "Save " + names[editor.type]}
          </button>
        </div>
      </form>
    </Modal>
  );
}
