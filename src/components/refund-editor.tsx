"use client";

import { useState, type FormEvent } from "react";
import Decimal from "decimal.js";
import { useFinance } from "./finance-provider";
import { Field, Modal } from "./ui";
import { formatMoney } from "@/lib/finance";
import type {
  CommerceCommand,
  CommerceData,
  CommerceOrder,
  RefundDraft,
  RefundRequest,
} from "@/lib/commerce";

export function RefundEditor({
  commerce,
  order,
  refund,
  verify = false,
  onSave,
  saveError,
  onClose,
}: {
  commerce: CommerceData;
  order?: CommerceOrder;
  refund?: RefundRequest;
  verify?: boolean;
  onSave: (command: CommerceCommand) => Promise<boolean>;
  saveError?: string;
  onClose: () => void;
}) {
  const { data, userId } = useFinance();
  const originalForOrder = order?.payments.find((payment) =>
    data.transactions.some(
      (transaction) =>
        transaction.id === payment.transactionId &&
        transaction.kind === "expense" &&
        transaction.status === "posted",
    ),
  );
  const [draft, setDraft] = useState<RefundDraft>(() => ({
    id: refund?.id ?? crypto.randomUUID(),
    orderId: refund?.orderId ?? order?.id ?? null,
    originalTransactionId:
      refund?.originalTransactionId ?? originalForOrder?.transactionId ?? null,
    description:
      refund?.description ??
      `Refund${order?.description ? ` · ${order.description}` : ""}`,
    expectedAmount: refund?.expectedAmount ?? order?.expectedRefundAmount ?? "",
    expectedBy: refund?.expectedBy ?? order?.expectedRefundBy ?? null,
    cancelledOn: refund?.cancelledOn ?? null,
    destinationAccountId: refund?.destinationAccountId ?? null,
    route: refund?.route ?? "unknown",
    status:
      refund &&
      ["store_credit", "rejected", "user_reported_received"].includes(
        refund.status,
      )
        ? (refund.status as RefundDraft["status"])
        : "expected",
    itemTitle: refund?.itemTitle ?? null,
    notes: refund?.notes ?? null,
  }));
  const [method, setMethod] = useState("match");
  const [transactionId, setTransactionId] = useState("");
  const received = (refund?.creditMatches ?? []).reduce(
    (sum, credit) => sum.plus(credit.amount),
    new Decimal(0),
  );
  const [amount, setAmount] = useState(
    refund
      ? Decimal.max(
          0,
          new Decimal(refund.expectedAmount).minus(received),
        ).toFixed(2)
      : "",
  );
  const [receivedOn, setReceivedOn] = useState("");
  const [accountId, setAccountId] = useState(
    refund?.destinationAccountId ?? "",
  );
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const anchored = Boolean(refund?.creditMatches.length);
  const accounts = data.accounts.filter(
    (account) => account.userId === userId && account.active,
  );
  const selectedOrder = commerce.orders.find(
    (entry) => entry.id === draft.orderId,
  );
  const purchases = data.transactions.filter(
    (transaction) =>
      transaction.userId === userId &&
      transaction.kind === "expense" &&
      transaction.status === "posted" &&
      (!selectedOrder ||
        selectedOrder.payments.some(
          (payment) => payment.transactionId === transaction.id,
        )),
  );
  const credits = data.transactions.filter(
    (transaction) =>
      transaction.userId === userId &&
      transaction.status === "posted" &&
      transaction.toAccountId &&
      !transaction.fromAccountId &&
      ["income", "refund", "adjustment"].includes(transaction.kind),
  );
  const patch = (updates: Partial<RefundDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
    setChecked(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !checked) return;
    setBusy(true);
    setError("");
    try {
      const command: CommerceCommand =
        verify && refund
          ? method === "match"
            ? {
                action: "verify_refund",
                refundId: refund.id,
                amount,
                transactionId,
              }
            : {
                action: "verify_refund",
                refundId: refund.id,
                amount,
                receivedOn,
                destinationAccountId: accountId,
                bankHistoryConfirmed: true,
              }
          : { action: "save_refund", refund: draft };
      if (await onSave(command)) onClose();
      else
        setError(
          "Check the error on the Orders page and correct the refund details.",
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        verify
          ? "Confirm refund credit"
          : refund
            ? "Review refund"
            : "Track cancellation or refund"
      }
      description={
        verify
          ? "Match a real incoming credit or record one you checked in bank history."
          : "Expected refunds stay pending until their credit is confirmed."
      }
      onClose={onClose}
      className="transaction-modal commerce-modal"
      overlayClassName="transaction-modal-overlay"
    >
      <form onSubmit={(event) => void submit(event)}>
        {verify && refund ? (
          <>
            <p className="commerce-note">
              {refund.description} · Expected{" "}
              {formatMoney(refund.expectedAmount)} · Received{" "}
              {formatMoney(received.toFixed(2))}
            </p>
            {!refund.originalTransactionId && (
              <p className="commerce-warning" role="alert">
                Review this refund and choose its original posted purchase
                before confirming a credit.
              </p>
            )}
            <div className="form-grid">
              <Field label="Verify using">
                <select
                  aria-label="Verify using"
                  value={method}
                  onChange={(event) => {
                    setMethod(event.target.value);
                    setChecked(false);
                  }}
                >
                  <option value="match">Existing ledger credit</option>
                  <option value="manual">Credit checked in bank history</option>
                </select>
              </Field>
              {method === "match" ? (
                <Field label="Incoming credit">
                  <select
                    aria-label="Incoming credit"
                    required
                    value={transactionId}
                    onChange={(event) => {
                      setTransactionId(event.target.value);
                      const transaction = credits.find(
                        (credit) => credit.id === event.target.value,
                      );
                      if (transaction) setAmount(transaction.amount);
                      setChecked(false);
                    }}
                  >
                    <option value="">Choose a posted credit</option>
                    {credits.map((credit) => (
                      <option key={credit.id} value={credit.id}>
                        {credit.description} · {formatMoney(credit.amount)} ·{" "}
                        {credit.occurredOn}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <>
                  <Field label="Received in">
                    <select
                      aria-label="Received in"
                      required
                      value={accountId}
                      onChange={(event) => {
                        setAccountId(event.target.value);
                        setChecked(false);
                      }}
                    >
                      <option value="">Select your account</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Credit date">
                    <input
                      required
                      type="date"
                      value={receivedOn}
                      onChange={(event) => {
                        setReceivedOn(event.target.value);
                        setChecked(false);
                      }}
                    />
                  </Field>
                </>
              )}
              <Field label="Received amount · ₹">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setChecked(false);
                  }}
                />
              </Field>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
              />{" "}
              I checked this credit in my bank or payment provider history.
            </label>
          </>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Original order">
                <select
                  aria-label="Original order"
                  value={draft.orderId ?? ""}
                  disabled={anchored}
                  onChange={(event) => {
                    const selected = commerce.orders.find(
                      (entry) => entry.id === event.target.value,
                    );
                    const payment = selected?.payments.find((link) =>
                      data.transactions.some(
                        (transaction) =>
                          transaction.id === link.transactionId &&
                          transaction.status === "posted" &&
                          transaction.kind === "expense",
                      ),
                    );
                    patch({
                      orderId: event.target.value || null,
                      originalTransactionId: payment?.transactionId ?? null,
                    });
                  }}
                >
                  <option value="">No order / choose later</option>
                  {commerce.orders.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.description || entry.merchant || "Order"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Original purchase">
                <select
                  aria-label="Original purchase"
                  value={draft.originalTransactionId ?? ""}
                  disabled={anchored}
                  onChange={(event) =>
                    patch({ originalTransactionId: event.target.value || null })
                  }
                >
                  <option value="">Unknown / choose later</option>
                  {purchases.map((transaction) => (
                    <option key={transaction.id} value={transaction.id}>
                      {transaction.description} ·{" "}
                      {formatMoney(transaction.amount)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description">
                <input
                  required
                  maxLength={200}
                  value={draft.description}
                  onChange={(event) =>
                    patch({ description: event.target.value })
                  }
                />
              </Field>
              <Field label="Expected refund · ₹">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={draft.expectedAmount}
                  onChange={(event) =>
                    patch({ expectedAmount: event.target.value })
                  }
                />
              </Field>
              <Field label="Refund method">
                <select
                  aria-label="Refund method"
                  value={draft.route}
                  disabled={anchored}
                  onChange={(event) =>
                    patch({
                      route: event.target.value as RefundDraft["route"],
                      ...(event.target.value === "store_credit"
                        ? {
                            destinationAccountId: null,
                            status: "store_credit" as const,
                          }
                        : { status: "expected" as const }),
                    })
                  }
                >
                  <option value="unknown">Unknown / choose later</option>
                  <option value="bank">Bank / UPI</option>
                  <option value="card">Card reversal</option>
                  <option value="wallet">Wallet</option>
                  <option value="store_credit">Store credit</option>
                </select>
              </Field>
              {draft.route !== "store_credit" && (
                <Field label="Refund destination">
                  <select
                    aria-label="Refund destination"
                    value={draft.destinationAccountId ?? ""}
                    disabled={anchored}
                    onChange={(event) =>
                      patch({
                        destinationAccountId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Unknown / choose later</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <details className="commerce-details">
              <summary>Refund details</summary>
              <div className="form-grid">
                <Field label="Expected by">
                  <input
                    type="date"
                    value={draft.expectedBy ?? ""}
                    onChange={(event) =>
                      patch({ expectedBy: event.target.value || null })
                    }
                  />
                </Field>
                <Field label="Cancelled / returned on">
                  <input
                    type="date"
                    value={draft.cancelledOn ?? ""}
                    onChange={(event) =>
                      patch({ cancelledOn: event.target.value || null })
                    }
                  />
                </Field>
                <Field label="Affected item">
                  <input
                    list="refund-order-items"
                    maxLength={160}
                    value={draft.itemTitle ?? ""}
                    onChange={(event) =>
                      patch({ itemTitle: event.target.value || null })
                    }
                  />
                  <datalist id="refund-order-items">
                    {selectedOrder?.items.map((item, index) => (
                      <option key={index} value={item.title} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Request status">
                  <select
                    aria-label="Request status"
                    value={draft.status}
                    disabled={anchored || draft.route === "store_credit"}
                    onChange={(event) =>
                      patch({
                        status: event.target.value as RefundDraft["status"],
                      })
                    }
                  >
                    <option value="expected">Expected / awaiting credit</option>
                    <option value="user_reported_received">
                      Reported received · unverified
                    </option>
                    <option value="store_credit">Store credit</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </Field>
                <Field label="Notes">
                  <textarea
                    maxLength={1000}
                    rows={2}
                    value={draft.notes ?? ""}
                    onChange={(event) =>
                      patch({ notes: event.target.value || null })
                    }
                  />
                </Field>
              </div>
            </details>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
              />{" "}
              I reviewed this refund request. This saves a pending record, not a
              bank credit.
            </label>
          </>
        )}
        {(saveError || error) && (
          <p className="error" role="alert">
            {saveError || error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              busy || !checked || (verify && !refund?.originalTransactionId)
            }
          >
            {busy
              ? "Saving…"
              : verify
                ? "Confirm credit"
                : "Save refund request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
