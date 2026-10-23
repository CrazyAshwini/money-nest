"use client";
import { useState } from "react";
import Decimal from "decimal.js";
import Link from "next/link";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Modal, Field } from "./ui";
import {
  ACCOUNT_KINDS,
  CATEGORIES,
  TRANSACTION_KINDS,
  type Account,
  type Transaction,
  type TransactionKind,
  type Bill,
  type FixedDeposit,
  type Loan,
  type ExpenseGroup,
  type Emi,
} from "@/lib/types";
import {
  accountBalance,
  formatDate,
  formatMoney,
  latestAccountBalanceSnapshot,
  isDebtAccount,
  localDateISO,
  validateBillAllocation,
  validateEmiAllocation,
} from "@/lib/finance";
import { accountUsage } from "@/lib/usage";
import { ReceiptScanner, type AppliedReceipt } from "./receipt-scanner";
import {
  getCategoryPlatformOptions,
  OTHER_PLATFORM,
} from "@/lib/category-platforms";
import { withSellerDescription } from "@/lib/seller-description";
import { balanceSnapshotIdForEdit } from "@/lib/transaction-balance-confirmation";
import { TransactionPicker } from "./transaction-picker";
import "./account-management.css";
import "./transaction-editor.css";

type TransactionValues = {
  description: string;
  amount: string;
  occurredOn: string;
  kind: string;
  category: string;
  platform: string;
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
  kind: TransactionKind = "expense",
): TransactionValues {
  const legacyPlatform =
    record?.platform === undefined &&
    record?.merchant &&
    CATEGORIES.some((category) =>
      getCategoryPlatformOptions(category).some(
        (platform) =>
          platform !== OTHER_PLATFORM && platform === record.merchant,
      ),
    )
      ? record.merchant
      : "";
  return {
    description:
      record?.sourceSystem === "receipt_ai" && !legacyPlatform
        ? withSellerDescription(record.description, record.merchant)
        : record?.description || "",
    amount: record?.amount || "",
    occurredOn: record ? record.occurredOn || "" : today,
    kind: record?.kind || kind,
    category: record?.category || "Other",
    platform: record?.platform ?? legacyPlatform,
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
      record?.kind === "expense"
        ? record.notes || ""
        : record?.notes?.replace(/^Confirmed external lender: .*?\.\s*/, "") ||
          "",
  };
}

export type EditorState =
  | { type: "account"; record?: Account }
  | { type: "transaction"; record?: Transaction; kind?: TransactionKind }
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
      editor.type === "transaction" ? editor.kind : undefined,
    ),
  );
  const [receipt, setReceipt] = useState<AppliedReceipt | null>(null);
  const [receiptQueue, setReceiptQueue] = useState<
    Array<{ receipt: AppliedReceipt; id: string }>
  >([]);
  const [receiptIndex, setReceiptIndex] = useState(0);
  const [otherPlatform, setOtherPlatform] = useState(
    editor.type === "transaction" && editor.record?.platform === OTHER_PLATFORM,
  );
  const [receiptReviewed, setReceiptReviewed] = useState(false);
  const [receiptPaymentConfirmed, setReceiptPaymentConfirmed] = useState(false);
  const [pendingConfirmed, setPendingConfirmed] = useState(false);
  const [externalPayerChosen, setExternalPayerChosen] = useState(
    Boolean(
      editor.type === "transaction" &&
      editor.record?.externalPayer &&
      !editor.record.fromAccountId,
    ),
  );
  const [balanceChoices, setBalanceChoices] = useState<Record<string, string>>(
    {},
  );
  const sameDayBalances = (["from", "to"] as const).flatMap((side) => {
    const accountId = transaction[`${side}AccountId`];
    const snapshot = latestAccountBalanceSnapshot(data, accountId, today);
    const account = data.accounts.find((item) => item.id === accountId);
    if (
      !snapshot ||
      !account ||
      localDateISO(snapshot.asOf) !== transaction.occurredOn
    )
      return [];
    const key = `${side}:${accountId}:${snapshot.id}:${transaction.occurredOn}`;
    const previous = editor.type === "transaction" ? editor.record : undefined;
    const previousMatches =
      previous?.[`${side}AccountId`] === accountId &&
      previous.occurredOn === transaction.occurredOn;
    const choice =
      balanceChoices[key] ??
      (previousMatches && previous?.[`${side}BalanceSnapshotId`] === snapshot.id
        ? "excluded"
        : previousMatches && previous?.status === "posted"
          ? "included"
          : "");
    return [{ side, account, snapshot, key, choice }];
  });
  function updateTransaction<K extends keyof TransactionValues>(
    key: K,
    value: TransactionValues[K],
  ) {
    setTransaction((current) => ({ ...current, [key]: value }));
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
    if (
      key === "fromAccountId" ||
      key === "toAccountId" ||
      key === "occurredOn"
    )
      setBalanceChoices({});
  }
  function applyReceiptFields(applied: AppliedReceipt) {
    const draft = applied.draft;
    setTransaction({
      ...transactionValues(undefined, "", ""),
      description: draft.description || "",
      amount: draft.amount || "",
      occurredOn: draft.occurredOn || "",
      merchant: draft.merchant || "",
      platform: draft.platform || "",
      externalReference: draft.externalReference || "",
      kind: draft.kind || transaction.kind,
      category: draft.category || "Other",
      status: "pending_review",
    });
    setReceipt(applied);
    setOtherPlatform(false);
    setExternalPayerChosen(false);
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
    setBalanceChoices({});
    setError("");
  }
  function applyReceipt(applied: AppliedReceipt) {
    setReceiptQueue([]);
    setReceiptIndex(0);
    applyReceiptFields(applied);
  }
  function applyReceiptBatch(receipts: AppliedReceipt[]) {
    if (!receipts.length) return;
    setReceiptQueue(
      receipts.map((receipt) => ({ receipt, id: crypto.randomUUID() })),
    );
    setReceiptIndex(0);
    applyReceiptFields(receipts[0]);
  }
  function changeCategory(category: string) {
    setTransaction((current) => {
      const previousPresets = getCategoryPlatformOptions(current.category);
      const nextPresets = getCategoryPlatformOptions(category);
      const incompatiblePreset =
        !otherPlatform &&
        current.platform !== OTHER_PLATFORM &&
        previousPresets.includes(current.platform) &&
        !nextPresets.includes(current.platform);
      return {
        ...current,
        category,
        platform: incompatiblePreset ? "" : current.platform,
      };
    });
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
  }
  function changePlatform(platform: string) {
    setOtherPlatform(platform === OTHER_PLATFORM);
    setTransaction((current) => ({
      ...current,
      platform:
        platform === OTHER_PLATFORM
          ? getCategoryPlatformOptions(current.category).includes(
              current.platform,
            ) &&
            current.platform !== OTHER_PLATFORM &&
            !otherPlatform
            ? ""
            : current.platform
          : platform,
    }));
    setReceiptReviewed(false);
    setReceiptPaymentConfirmed(false);
    setPendingConfirmed(false);
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
        await save("transactions", savedTransaction);
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
    if (editor.type !== "transaction" || !editor.record?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteRecord("transactions", editor.record.id);
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
      aria-label={name === "amount" ? "Amount · ₹" : undefined}
      onChange={(event) => updateTransaction(name, event.target.value)}
      required={required}
      step={type === "number" ? "0.01" : undefined}
      min={type === "number" ? "0" : undefined}
    />
  );
  const incomingTransaction = ["income", "refund"].includes(transaction.kind);
  const twoAccountTransaction = [
    "transfer",
    "bill_payment",
    "adjustment",
  ].includes(transaction.kind);
  const accountGroups = {
    bank: "Bank accounts",
    credit_card: "Credit cards",
    pay_later: "Pay Later",
    wallet: "Wallets",
  };
  const transactionAccount = (
    name: "fromAccountId" | "toAccountId",
    label: string,
    full = false,
  ) => (
    <Field label={label} className={full ? "full" : undefined}>
      <TransactionPicker
        label={label}
        value={
          name === "fromAccountId" &&
          transaction.kind === "expense" &&
          externalPayerChosen
            ? "__external_payer__"
            : transaction[name]
        }
        placeholder="Choose account"
        disabled={busy}
        onChange={(value) => {
          if (name === "fromAccountId" && transaction.kind === "expense") {
            setExternalPayerChosen(value === "__external_payer__");
            updateTransaction(
              name,
              value === "__external_payer__" ? "" : value,
            );
            if (value !== "__external_payer__")
              updateTransaction("externalPayer", "");
          } else updateTransaction(name, value);
        }}
        options={[
          { value: "", label: "Choose account" },
          ...(["bank", "credit_card", "pay_later", "wallet"] as const).flatMap(
            (kind) =>
              data.accounts
                .filter(
                  (account) =>
                    account.userId === userId &&
                    account.kind === kind &&
                    (account.active || account.id === transaction[name]),
                )
                .map((account) => {
                  const suffix = account.maskedSuffix?.trim().slice(-4);
                  return {
                    value: account.id,
                    label:
                      suffix && !account.name.includes(suffix)
                        ? `${account.name} · ••${suffix}`
                        : account.name,
                    group: accountGroups[kind],
                    description: account.active
                      ? account.institution
                      : "Archived account",
                  };
                }),
          ),
          ...(name === "fromAccountId" && transaction.kind === "expense"
            ? [
                {
                  value: "__external_payer__",
                  label: "Someone else paid",
                  group: "Other payment",
                },
              ]
            : []),
        ]}
      />
    </Field>
  );
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
              {editor.record && (
                <Link
                  href={`/accounts/${encodeURIComponent(editor.record.id)}?manage=reports`}
                  onClick={onClose}
                  className="account-management-editor-link full"
                >
                  Statements and reports
                </Link>
              )}
            </>
          )}
          {editor.type === "transaction" && (
            <>
              <div className="transaction-quick-controls full">
                <TransactionPicker
                  label="Transaction type"
                  value={transaction.kind}
                  searchable={false}
                  disabled={busy}
                  options={TRANSACTION_KINDS.map((kind) => ({
                    value: kind,
                    label: human(kind).replace(/^./, (letter) =>
                      letter.toUpperCase(),
                    ),
                  }))}
                  onChange={(kind) => {
                    if (kind === transaction.kind) return;
                    updateTransaction("kind", kind);
                    setTransaction((current) => ({
                      ...current,
                      kind,
                      fromAccountId: "",
                      toAccountId: "",
                      externalPayer: "",
                      externalRepayment: false,
                      refundOfTransactionId: "",
                    }));
                    setExternalPayerChosen(false);
                    setBalanceChoices({});
                  }}
                />
                <label className="transaction-date-control">
                  <CalendarDays size={16} aria-hidden="true" />
                  <span aria-hidden="true">
                    {transaction.occurredOn === today
                      ? "Today"
                      : transaction.occurredOn
                        ? formatDate(transaction.occurredOn)
                        : "Choose date"}
                  </span>
                  <ChevronDown size={14} aria-hidden="true" />
                  <input
                    type="date"
                    name="occurredOn"
                    aria-label="Date"
                    value={transaction.occurredOn}
                    disabled={busy}
                    onChange={(event) =>
                      updateTransaction("occurredOn", event.target.value)
                    }
                    onClick={(event) => {
                      try {
                        event.currentTarget.showPicker?.();
                      } catch {
                        /* The native date input remains available on older browsers. */
                      }
                    }}
                  />
                </label>
              </div>
              <Field label="Amount · ₹" className="transaction-amount full">
                <span className="transaction-amount-control">
                  <span aria-hidden="true">₹</span>
                  {transactionInput("amount", "number", true)}
                </span>
              </Field>
              <Field label="Description" className="full">
                <textarea
                  name="description"
                  value={transaction.description}
                  onChange={(event) =>
                    updateTransaction("description", event.target.value)
                  }
                  placeholder={
                    transaction.kind === "expense"
                      ? "Seller name and what you bought"
                      : `What was this ${human(transaction.kind)} for?`
                  }
                  rows={1}
                  maxLength={200}
                  required
                />
              </Field>
              <div className="transaction-category-row full">
                <Field label="Category">
                  <TransactionPicker
                    label="Category"
                    value={transaction.category}
                    onChange={changeCategory}
                    disabled={busy}
                    options={[
                      ...new Set([
                        ...CATEGORIES,
                        transaction.category,
                        ...data.transactions
                          .filter((item) => item.userId === userId)
                          .map((item) => item.category)
                          .filter((category): category is string =>
                            Boolean(category),
                          ),
                      ]),
                    ]
                      .filter(Boolean)
                      .map((category) => ({
                        value: category,
                        label: category,
                      }))}
                  />
                </Field>
                <Field label="Platform">
                  <TransactionPicker
                    label="Platform"
                    value={
                      otherPlatform ? OTHER_PLATFORM : transaction.platform
                    }
                    onChange={changePlatform}
                    disabled={busy}
                    placeholder="Choose platform"
                    options={[
                      { value: "", label: "No platform" },
                      ...getCategoryPlatformOptions(
                        transaction.category,
                        transaction.platform,
                      ).map((platform) => ({
                        value: platform,
                        label: platform,
                      })),
                    ]}
                  />
                </Field>
              </div>
              {otherPlatform && (
                <Field label="Other platform / source" className="full">
                  {transactionInput("platform")}
                </Field>
              )}
              {!incomingTransaction &&
                transactionAccount(
                  "fromAccountId",
                  transaction.kind === "expense" ? "Paid from" : "From account",
                  !twoAccountTransaction,
                )}
              {(incomingTransaction || twoAccountTransaction) &&
                transactionAccount(
                  "toAccountId",
                  "To account",
                  !twoAccountTransaction,
                )}
              {receipt?.accountHint && (
                <p className="form-note full">
                  Payment method shown: {receipt.accountHint}. Select the
                  matching account above.
                </p>
              )}
              {transaction.kind === "expense" &&
                externalPayerChosen &&
                !transaction.fromAccountId && (
                  <Field label="External payer" className="full">
                    {transactionInput("externalPayer")}
                  </Field>
                )}
              {sameDayBalances.map(({ account, snapshot, key, choice }) => (
                <Field
                  key={key}
                  label={`Does the ${account.name} balance already include this payment?`}
                  className="full"
                >
                  <select
                    aria-label={`Does the ${account.name} balance already include this payment?`}
                    value={choice}
                    onChange={(event) =>
                      setBalanceChoices((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose balance treatment</option>
                    <option value="included">Yes — already included</option>
                    <option value="excluded">No — update balance</option>
                  </select>
                  <span className="form-note">
                    {isDebtAccount(account)
                      ? "Credit report"
                      : `Reported ${formatMoney(snapshot.reportedBalance!)}`}{" "}
                    on {formatDate(snapshot.asOf)}. Choose “No” only if this
                    payment is missing from that amount.
                  </span>
                </Field>
              ))}
              {transaction.kind !== "expense" && (
                <>
                  {(transaction.kind === "refund" ||
                    transaction.refundOfTransactionId) && (
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
                                (t.id ===
                                  editor.record?.refundOfTransactionId &&
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
                  )}
                  {(["bill_payment", "transfer"].includes(transaction.kind) ||
                    transaction.externalLender ||
                    transaction.externalRepayment) && (
                    <>
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
                      <p className="form-note full">
                        For an external loan repayment, select the bank source,
                        leave the destination external and confirm the lender.
                      </p>
                    </>
                  )}
                </>
              )}
              <details className="transaction-extra full">
                <summary>
                  More details <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="transaction-extra-fields">
                  <Field label="Bank reference">
                    {transactionInput("externalReference")}
                  </Field>
                  <Field label="Merchant (optional)">
                    {transactionInput("merchant")}
                  </Field>
                  {transaction.kind !== "expense" && (
                    <Field label="External payer (if applicable)">
                      {transactionInput("externalPayer")}
                    </Field>
                  )}
                  <Field label="Notes" className="full">
                    {transactionInput("notes")}
                  </Field>
                </div>
              </details>
              {(!transaction.occurredOn ||
                (["transfer", "bill_payment"].includes(transaction.kind) &&
                  (!transaction.fromAccountId ||
                    (!transaction.toAccountId &&
                      !transaction.externalRepayment)))) && (
                <p className="transaction-hint full">
                  Missing dates or incomplete transfers stay in Needs review.
                </p>
              )}
              {editor.record?.status === "pending_review" && (
                <label className="check-row full">
                  <input
                    type="checkbox"
                    checked={pendingConfirmed}
                    onChange={(event) =>
                      setPendingConfirmed(event.target.checked)
                    }
                  />
                  I confirmed this payment and account
                </label>
              )}
              {editor.record?.status === "pending_review" &&
                !pendingConfirmed && (
                  <p className="transaction-hint full">
                    Needs review payments do not change balances. Confirm the
                    payment after checking it with your bank.
                  </p>
                )}
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
                {input("openingDate", editor.record?.openingDate, "date")}
              </Field>
              <Field label="Maturity date">
                {input("maturityDate", editor.record?.maturityDate, "date")}
              </Field>
              <p className="form-note full">
                Leave contract dates blank until confirmed by the deposit
                advice. A funding payment does not confirm the opening date.
              </p>
              <Field label="Annual rate · %">
                {input("annualRate", editor.record?.annualRate, "number")}
              </Field>
              <Field label="Last four digits">
                {input("maskedSuffix", editor.record?.maskedSuffix)}
              </Field>
              <Field label="Pledged credit card">
                <select
                  name="backingAccountId"
                  defaultValue={
                    editor.record?.pledged == null
                      ? "__unknown__"
                      : editor.record?.backingAccountId || ""
                  }
                >
                  <option value="__unknown__">Pledge unconfirmed</option>
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
