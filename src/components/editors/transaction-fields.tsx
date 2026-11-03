"use client";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Field } from "../ui";
import { CATEGORIES, TRANSACTION_KINDS } from "@/lib/types";
import { formatDate, formatMoney, isDebtAccount } from "@/lib/finance";
import {
  getCategoryPlatformOptions,
  OTHER_PLATFORM,
} from "@/lib/category-platforms";
import { TransactionPicker } from "../transaction-picker";
import type { WorkspaceData } from "@/lib/types";
import type { EditorState, TransactionValues } from "./types";
import type { TransactionEditorController } from "./use-transaction-editor-state";
import { human } from "./values";
export function TransactionFields({
  editor,
  data,
  userId,
  today,
  busy,
  controller,
}: {
  editor: Extract<EditorState, { type: "transaction" }>;
  data: WorkspaceData;
  userId: string;
  today: string;
  busy: boolean;
  controller: TransactionEditorController;
}) {
  const {
    transaction,
    setTransaction,
    receipt,
    otherPlatform,
    pendingConfirmed,
    setPendingConfirmed,
    externalPayerChosen,
    setExternalPayerChosen,
    setBalanceChoices,
    sameDayBalances,
    updateTransaction,
    changeCategory,
    changePlatform,
  } = controller;
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
  return (
    <>
      <div className="transaction-quick-controls full">
        <TransactionPicker
          label="Transaction type"
          value={transaction.kind}
          searchable={false}
          disabled={busy}
          options={TRANSACTION_KINDS.map((kind) => ({
            value: kind,
            label: human(kind).replace(/^./, (letter) => letter.toUpperCase()),
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
                  .filter((category): category is string => Boolean(category)),
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
            value={otherPlatform ? OTHER_PLATFORM : transaction.platform}
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
        transactionAccount("toAccountId", "To account", !twoAccountTransaction)}
      {receipt?.accountHint && (
        <p className="form-note full">
          Payment method shown: {receipt.accountHint}. Select the matching
          account above.
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
            on {formatDate(snapshot.asOf)}. Choose “No” only if this payment is
            missing from that amount.
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
                  updateTransaction("refundOfTransactionId", event.target.value)
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
                For an external loan repayment, select the bank source, leave
                the destination external and confirm the lender.
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
            (!transaction.toAccountId && !transaction.externalRepayment)))) && (
        <p className="transaction-hint full">
          Missing dates or incomplete transfers stay in Needs review.
        </p>
      )}
      {editor.record?.status === "pending_review" && (
        <label className="check-row full">
          <input
            type="checkbox"
            checked={pendingConfirmed}
            onChange={(event) => setPendingConfirmed(event.target.checked)}
          />
          I confirmed this payment and account
        </label>
      )}
      {editor.record?.status === "pending_review" && !pendingConfirmed && (
        <p className="transaction-hint full">
          Needs review payments do not change balances. Confirm the payment
          after checking it with your bank.
        </p>
      )}
    </>
  );
}
