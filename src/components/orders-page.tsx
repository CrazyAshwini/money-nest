"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ReceiptText, RotateCcw } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Badge, Empty, Field, Section } from "./ui";
import { OrderScanner } from "./order-scanner";
import { RefundEditor } from "./refund-editor";
import {
  commerceSummary,
  emptyCommerce,
  findOrderMatches,
  isOrderPurchase,
  ORDER_STATUSES,
  orderModuleRoute,
  orderSummary,
  type CommerceCommand,
  type CommerceData,
  type CommerceOrder,
  type ReviewedOrderDraft,
  type RefundRequest,
} from "@/lib/commerce";
import type { OrderScanResult } from "@/lib/scan-orders";
import { CATEGORIES } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/finance";
import "./orders-page.css";

const newKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const label = (value: string) => value.replaceAll("_", " ");

function manualDraft(): ReviewedOrderDraft {
  return {
    candidateId: crypto.randomUUID(),
    sourceType: "manual",
    platform: null,
    merchant: null,
    description: "",
    orderReferenceHash: null,
    orderReferenceMasked: null,
    occurredOn: null,
    status: "completed",
    amount: null,
    amountRole: "amount_paid",
    currency: "INR",
    paymentStatus: "successful",
    financialEvent: "purchase",
    category: "Other",
    items: [],
    sourceImageIndices: [],
    confidence: "high",
    warnings: [],
    expectedRefundAmount: null,
    expectedRefundBy: null,
    sourceFingerprint: null,
    action: "pending",
    confirmed: false,
    fromAccountId: null,
    externalPayer: null,
    matchedTransactionId: null,
    confirmedDistinct: false,
  };
}

export function OrdersPage() {
  const { mode, data, userId, refresh, toast } = useFinance();
  const [commerce, setCommerce] = useState<CommerceData>(emptyCommerce);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<ReviewedOrderDraft[]>([]);
  const [batchKey, setBatchKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [search, setSearch] = useState("");
  const [refundEditor, setRefundEditor] = useState<{
    order?: CommerceOrder;
    refund?: RefundRequest;
    verify?: boolean;
  } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (mode !== "private") return;
      try {
        const response = await fetch("/api/orders", {
          cache: "no-store",
          signal,
        });
        const body = await response.json();
        if (signal?.aborted) return;
        if (!response.ok)
          throw new Error(body.error || "Orders could not be loaded.");
        setCommerce(body.commerce);
        setError("");
      } catch (failure) {
        if (signal?.aborted) return;
        setError(
          failure instanceof Error
            ? failure.message
            : "Orders could not be loaded.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [mode],
  );

  useEffect(() => {
    const request = new AbortController();
    // Synchronize the external authenticated store when the profile becomes ready.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(request.signal);
    return () => request.abort();
  }, [load]);

  async function run(command: CommerceCommand) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Changes could not be saved.");
      setCommerce(body.commerce);
      await refresh();
      toast(
        body.result?.duplicate
          ? "Already saved. No duplicate payment added."
          : command.action === "save_refund"
            ? "Refund request saved."
            : command.action === "verify_refund"
              ? "Refund credit confirmed."
              : "Reviewed orders saved.",
      );
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Changes could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function extracted(result: OrderScanResult) {
    const next: ReviewedOrderDraft[] = result.extraction.orders.map(
      (order) => ({
        ...order,
        sourceFingerprint: result.fingerprint,
        action:
          !isOrderPurchase(order) ||
          order.status === "cancelled" ||
          order.paymentStatus === "failed"
            ? "history"
            : "pending",
        confirmed: false,
        fromAccountId: null,
        externalPayer: null,
        matchedTransactionId: null,
        confirmedDistinct: false,
      }),
    );
    // Keep edits when the same scan is reviewed again. New screenshots append drafts.
    setDrafts((current) => {
      const merged = [...current];
      for (const draft of next) {
        if (
          !merged.some(
            (existing) =>
              existing.candidateId === draft.candidateId &&
              existing.sourceFingerprint === draft.sourceFingerprint,
          )
        )
          merged.push(draft);
      }
      return merged;
    });
    setBatchKey(newKey());
    setConfirmed(false);
  }

  function editOrder(order: CommerceOrder) {
    setDrafts((current) =>
      current.some((draft) => draft.existingOrderId === order.id)
        ? current
        : [
            ...current,
            {
              ...order,
              existingOrderId: order.id,
              action:
                order.reviewStatus === "pending"
                  ? "pending"
                  : order.payments.length
                    ? "link"
                    : "history",
              confirmed: false,
              fromAccountId:
                data.transactions.find(
                  (transaction) =>
                    transaction.id === order.payments[0]?.transactionId,
                )?.fromAccountId ?? null,
              externalPayer: null,
              matchedTransactionId:
                order.reviewStatus === "pending"
                  ? null
                  : (order.payments[0]?.transactionId ?? null),
              confirmedDistinct: false,
            },
          ],
    );
    setBatchKey(newKey());
    setConfirmed(false);
  }

  function patch(index: number, updates: Partial<ReviewedOrderDraft>) {
    setDrafts((current) =>
      current.map((draft, position) =>
        position === index ? { ...draft, ...updates } : draft,
      ),
    );
    // Changed content is a new operation; an unchanged network retry keeps its key.
    setBatchKey(newKey());
    setConfirmed(false);
  }

  async function commit() {
    if (!confirmed || !drafts.length) return;
    if (
      await run({
        action: "commit_orders",
        idempotencyKey: batchKey,
        orders: drafts.map((draft) => ({ ...draft, confirmed: true })),
      })
    ) {
      setDrafts([]);
      setConfirmed(false);
      setBatchKey("");
    }
  }

  if (mode !== "private")
    return (
      <Empty
        title="Use your private profile"
        description="Order imports and refund tracking are available in the private profile on this computer."
      />
    );
  const summary = commerceSummary(commerce, data);
  const accounts = data.accounts.filter(
    (account) => account.userId === userId && account.active,
  );
  const orders = commerce.orders.filter((order) =>
    `${order.platform ?? ""} ${order.merchant ?? ""} ${order.description ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <div className="commerce-page">
      <div className="commerce-actions">
        <OrderScanner onExtract={extracted} />
        <button
          className="button"
          onClick={() => {
            setDrafts((current) => [...current, manualDraft()]);
            setBatchKey(newKey());
            setConfirmed(false);
          }}
        >
          <Plus size={16} /> Add order
        </button>
        <button className="button" onClick={() => setRefundEditor({})}>
          Track refund
        </button>
        <button
          className="button"
          onClick={() => void load()}
          aria-label="Refresh orders"
        >
          <RotateCcw size={16} />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="commerce-totals">
        <div>
          <span>Paid purchases</span>
          <strong>{formatMoney(summary.gross)}</strong>
        </div>
        <div>
          <span>Confirmed refunds</span>
          <strong>{formatMoney(summary.confirmedRefunds)}</strong>
        </div>
        <div>
          <span>Net confirmed</span>
          <strong>{formatMoney(summary.net)}</strong>
        </div>
        <div>
          <span>Refunds pending</span>
          <strong>{formatMoney(summary.pendingRefunds)}</strong>
        </div>
      </div>
      {!!drafts.length && (
        <Section
          title={`Review ${drafts.length} order${drafts.length === 1 ? "" : "s"}`}
          subtitle="Choose how each order belongs in your ledger. Unknown details can stay pending."
        >
          <div className="commerce-drafts">
            {drafts.map((draft, index) => {
              const matches = findOrderMatches(
                draft,
                data.transactions,
                userId,
              );
              const moduleRoute = orderModuleRoute(draft.sourceType);
              const mayPost =
                isOrderPurchase(draft) &&
                draft.status !== "cancelled" &&
                draft.paymentStatus !== "failed";
              return (
                <article
                  className="commerce-draft"
                  key={`${draft.sourceFingerprint}:${draft.candidateId}`}
                  aria-label={`Order draft ${index + 1}`}
                >
                  <div className="commerce-card-heading">
                    <strong>
                      {draft.merchant || draft.platform || `Order ${index + 1}`}
                    </strong>
                    <Badge>{label(draft.status)}</Badge>
                    <button
                      className="text-link"
                      onClick={() => {
                        setDrafts((current) =>
                          current.filter((_, position) => position !== index),
                        );
                        setBatchKey(newKey());
                        setConfirmed(false);
                      }}
                    >
                      Remove draft
                    </button>
                  </div>
                  {moduleRoute && (
                    <p className="commerce-note">
                      This is a {label(draft.sourceType)}.{" "}
                      <Link href={moduleRoute}>Open its finance page</Link>.
                    </p>
                  )}
                  <div className="form-grid">
                    <Field label="Description">
                      <input
                        value={draft.description ?? ""}
                        maxLength={200}
                        onChange={(event) =>
                          patch(index, { description: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Save as">
                      <select
                        aria-label="Save as"
                        value={draft.action}
                        onChange={(event) =>
                          patch(index, {
                            action: event.target
                              .value as ReviewedOrderDraft["action"],
                          })
                        }
                      >
                        <option value="history">History only</option>
                        {mayPost && (
                          <>
                            <option value="pending">Pending draft</option>
                            <option value="create">New paid expense</option>
                          </>
                        )}
                        {isOrderPurchase(draft) && (
                          <option value="link">Link existing payment</option>
                        )}
                      </select>
                    </Field>
                    <Field label="Amount · ₹">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.amount ?? ""}
                        onChange={(event) =>
                          patch(index, { amount: event.target.value || null })
                        }
                      />
                    </Field>
                    <Field label="Purchase date">
                      <input
                        type="date"
                        value={draft.occurredOn ?? ""}
                        onChange={(event) =>
                          patch(index, {
                            occurredOn: event.target.value || null,
                          })
                        }
                      />
                    </Field>
                    {draft.action === "link" ? (
                      <Field label="Existing payment">
                        <select
                          aria-label="Existing payment"
                          value={draft.matchedTransactionId ?? ""}
                          onChange={(event) =>
                            patch(index, {
                              matchedTransactionId: event.target.value || null,
                            })
                          }
                        >
                          <option value="">Choose a posted purchase</option>
                          {data.transactions
                            .filter(
                              (transaction) =>
                                transaction.userId === userId &&
                                transaction.kind === "expense" &&
                                transaction.status === "posted",
                            )
                            .map((transaction) => (
                              <option
                                key={transaction.id}
                                value={transaction.id}
                              >
                                {transaction.description} ·{" "}
                                {formatMoney(transaction.amount)} ·{" "}
                                {transaction.occurredOn}
                              </option>
                            ))}
                        </select>
                      </Field>
                    ) : (
                      draft.action !== "history" && (
                        <Field label="Paid from">
                          <select
                            aria-label="Paid from"
                            value={
                              draft.externalPayer != null
                                ? "external"
                                : (draft.fromAccountId ?? "")
                            }
                            onChange={(event) =>
                              patch(index, {
                                fromAccountId:
                                  event.target.value === "external"
                                    ? null
                                    : event.target.value || null,
                                externalPayer:
                                  event.target.value === "external" ? "" : null,
                              })
                            }
                          >
                            <option value="">Unknown / choose later</option>
                            {accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                                {account.maskedSuffix
                                  ? ` ••${account.maskedSuffix}`
                                  : ""}
                              </option>
                            ))}
                            <option value="external">
                              Paid by someone else
                            </option>
                          </select>
                        </Field>
                      )
                    )}
                    <Field label="Category">
                      <select
                        aria-label="Category"
                        value={draft.category ?? "Other"}
                        onChange={(event) =>
                          patch(index, {
                            category: event.target
                              .value as ReviewedOrderDraft["category"],
                          })
                        }
                      >
                        {CATEGORIES.map((category) => (
                          <option key={category}>{category}</option>
                        ))}
                      </select>
                    </Field>
                    {draft.externalPayer != null && (
                      <Field label="External payer">
                        <input
                          value={draft.externalPayer}
                          maxLength={120}
                          onChange={(event) =>
                            patch(index, { externalPayer: event.target.value })
                          }
                        />
                      </Field>
                    )}
                  </div>
                  {!!matches.length && (
                    <div className="commerce-warning" role="status">
                      Similar payments exist:{" "}
                      {matches
                        .map(
                          (match) =>
                            `${match.description} (${formatMoney(match.amount)})`,
                        )
                        .join(", ")}
                      . Link an existing payment to keep one expense.
                    </div>
                  )}
                  {draft.action === "create" && (
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={
                          draft.paymentStatus === "successful" &&
                          draft.amountRole === "amount_paid"
                        }
                        onChange={(event) =>
                          patch(index, {
                            paymentStatus: event.target.checked
                              ? "successful"
                              : "unknown",
                            amountRole: event.target.checked
                              ? "amount_paid"
                              : "unknown",
                          })
                        }
                      />{" "}
                      I confirmed the amount actually paid and that payment
                      completed.
                    </label>
                  )}
                  <details className="commerce-details">
                    <summary>Order details</summary>
                    <div className="form-grid">
                      <Field label="Platform / source">
                        <input
                          value={draft.platform ?? ""}
                          maxLength={100}
                          onChange={(event) =>
                            patch(index, {
                              platform: event.target.value || null,
                            })
                          }
                        />
                      </Field>
                      <Field label="Merchant">
                        <input
                          value={draft.merchant ?? ""}
                          maxLength={120}
                          onChange={(event) =>
                            patch(index, {
                              merchant: event.target.value || null,
                            })
                          }
                        />
                      </Field>
                      <Field label="Update existing order">
                        <select
                          aria-label="Update existing order"
                          value={draft.existingOrderId ?? ""}
                          onChange={(event) =>
                            patch(index, {
                              existingOrderId: event.target.value || null,
                            })
                          }
                        >
                          <option value="">
                            New order / review separately
                          </option>
                          {commerce.orders.map((order) => (
                            <option key={order.id} value={order.id}>
                              {order.description || order.merchant || "Order"} ·{" "}
                              {order.occurredOn || "Date unknown"}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Order status">
                        <select
                          aria-label="Order status"
                          value={draft.status}
                          onChange={(event) =>
                            patch(index, {
                              status: event.target
                                .value as ReviewedOrderDraft["status"],
                              ...(event.target.value === "cancelled"
                                ? { action: "history" as const }
                                : {}),
                            })
                          }
                        >
                          {ORDER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {label(status)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Currency">
                        <input
                          value={draft.currency ?? ""}
                          maxLength={3}
                          placeholder="Unknown"
                          onChange={(event) =>
                            patch(index, {
                              currency:
                                event.target.value.toUpperCase() || null,
                            })
                          }
                        />
                      </Field>
                      <Field label="Expected refund · ₹">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={draft.expectedRefundAmount ?? ""}
                          onChange={(event) =>
                            patch(index, {
                              expectedRefundAmount: event.target.value || null,
                            })
                          }
                        />
                      </Field>
                      <Field label="Expected refund by">
                        <input
                          type="date"
                          value={draft.expectedRefundBy ?? ""}
                          onChange={(event) =>
                            patch(index, {
                              expectedRefundBy: event.target.value || null,
                            })
                          }
                        />
                      </Field>
                    </div>
                    {draft.items.map((item, itemIndex) => (
                      <div className="commerce-item" key={itemIndex}>
                        <span>
                          {item.title}{" "}
                          {item.amount ? `· ${formatMoney(item.amount)}` : ""}
                        </span>
                        <select
                          aria-label={`Item ${itemIndex + 1} status`}
                          value={item.status}
                          onChange={(event) =>
                            patch(index, {
                              items: draft.items.map((entry, position) =>
                                position === itemIndex
                                  ? {
                                      ...entry,
                                      status: event.target
                                        .value as typeof item.status,
                                    }
                                  : entry,
                              ),
                            })
                          }
                        >
                          {ORDER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {label(status)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    {draft.sourceImageIndices.length > 0 && (
                      <p className="commerce-note">
                        Evidence: photo
                        {draft.sourceImageIndices.length === 1 ? "" : "s"}{" "}
                        {draft.sourceImageIndices
                          .map((position) => position + 1)
                          .join(", ")}{" "}
                        · {draft.confidence} confidence
                      </p>
                    )}
                    {draft.orderReferenceMasked && (
                      <p className="commerce-note">
                        Order reference {draft.orderReferenceMasked}
                      </p>
                    )}
                    {!!matches.length && draft.action === "create" && (
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={draft.confirmedDistinct}
                          onChange={(event) =>
                            patch(index, {
                              confirmedDistinct: event.target.checked,
                            })
                          }
                        />{" "}
                        This is a separate purchase from the suggested matches.
                      </label>
                    )}
                  </details>
                  {!!draft.warnings.length && (
                    <p className="commerce-note">{draft.warnings.join(" ")}</p>
                  )}
                </article>
              );
            })}
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            I reviewed these orders, payment accounts and possible duplicates.
          </label>
          <div className="commerce-actions">
            <button
              className="button primary"
              disabled={busy || !confirmed}
              onClick={() => void commit()}
            >
              {busy ? "Saving…" : "Save reviewed orders"}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setDrafts([]);
                setConfirmed(false);
              }}
            >
              Discard drafts
            </button>
          </div>
        </Section>
      )}
      <Section
        title={`Order history · ${commerce.orders.length}`}
        action={
          <input
            className="commerce-search"
            aria-label="Search orders"
            placeholder="Search orders"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        }
      >
        {loading ? (
          <p className="commerce-note">Loading orders…</p>
        ) : !orders.length ? (
          <Empty
            title="Your orders, in one place"
            description="Scan an order history or add an order. Review it before creating any expense."
          />
        ) : (
          <div className="commerce-orders">
            {orders.map((order) => (
              <article className="commerce-order" key={order.id}>
                <div className="commerce-card-heading">
                  <ReceiptText size={18} />
                  <div>
                    <strong>
                      {order.description ||
                        order.merchant ||
                        order.platform ||
                        "Order"}
                    </strong>
                    <p>
                      {order.platform || order.merchant || "Manual"} ·{" "}
                      {order.occurredOn
                        ? formatDate(order.occurredOn)
                        : "Date unknown"}
                    </p>
                  </div>
                  <Badge
                    tone={
                      order.reviewStatus === "pending" ? "warning" : "neutral"
                    }
                  >
                    {label(order.status)}
                  </Badge>
                </div>
                <div className="commerce-order-values">
                  <strong>
                    {order.amount != null
                      ? formatMoney(order.amount)
                      : "Amount unknown"}
                  </strong>
                  <span>
                    {order.reviewStatus === "pending"
                      ? "Needs review · pending payment"
                      : order.payments.length
                        ? "Payment linked"
                        : order.reviewStatus === "history"
                          ? "History only"
                          : "Needs review"}
                  </span>
                  <button
                    className="text-link"
                    onClick={() => editOrder(order)}
                  >
                    Review order
                  </button>
                  {(isOrderPurchase(order) || order.payments.length > 0) && (
                    <button
                      className="text-link"
                      onClick={() => setRefundEditor({ order })}
                    >
                      Track refund
                    </button>
                  )}
                </div>
                {order.displayedAmount != null &&
                  order.displayedAmount !== order.amount && (
                    <p className="commerce-note">
                      Screenshot amount {formatMoney(order.displayedAmount)} ·
                      Actual payment shown above
                    </p>
                  )}
                {commerce.refunds.some(
                  (refund) => refund.orderId === order.id,
                ) && (
                  <p className="commerce-note">
                    Confirmed refund{" "}
                    {formatMoney(
                      orderSummary(order, commerce).confirmedRefunds,
                    )}{" "}
                    · Net {formatMoney(orderSummary(order, commerce).net)}
                  </p>
                )}
                {!!order.items.length && (
                  <details className="commerce-details">
                    <summary>
                      {order.items.length} item
                      {order.items.length === 1 ? "" : "s"}
                    </summary>
                    {order.items.map((item, index) => (
                      <p key={index}>
                        {item.title} · {label(item.status)}
                        {item.amount ? ` · ${formatMoney(item.amount)}` : ""}
                      </p>
                    ))}
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>
      <Section
        title={`Refunds · ${commerce.refunds.length}`}
        subtitle="Pending requests stay separate from confirmed incoming credits."
        action={<OrderScanner intent="refunds" onExtract={extracted} />}
      >
        {!commerce.refunds.length ? (
          <Empty
            title="Track a return or cancellation"
            description="Add a refund request or scan its screenshot. Confirm the credit after it reaches your account."
          />
        ) : (
          <div className="commerce-orders">
            {commerce.refunds.map((refund) => {
              const received = commerceSummary(
                { orders: [], operations: [], refunds: [refund] },
                data,
              ).confirmedRefunds;
              const canConfirm = ![
                "store_credit",
                "rejected",
                "confirmed",
              ].includes(refund.status);
              return (
                <article className="commerce-refund" key={refund.id}>
                  <div className="commerce-card-heading">
                    <RotateCcw size={18} />
                    <div>
                      <strong>{refund.description}</strong>
                      <p>
                        {label(refund.route)}
                        {refund.itemTitle ? ` · ${refund.itemTitle}` : ""}
                        {refund.expectedBy
                          ? ` · Expected ${formatDate(refund.expectedBy)}`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      tone={
                        refund.status === "confirmed" ? "positive" : "warning"
                      }
                    >
                      {label(refund.status)}
                    </Badge>
                  </div>
                  <div className="commerce-order-values">
                    <strong>{formatMoney(refund.expectedAmount)}</strong>
                    <span>Expected · Received {formatMoney(received)}</span>
                    <button
                      className="text-link"
                      onClick={() => setRefundEditor({ refund })}
                    >
                      Review refund
                    </button>
                    {canConfirm && (
                      <button
                        className="button primary"
                        onClick={() =>
                          setRefundEditor({ refund, verify: true })
                        }
                      >
                        Confirm credit
                      </button>
                    )}
                  </div>
                  {!refund.originalTransactionId && canConfirm && (
                    <p className="commerce-note">
                      Choose the original purchase in Review refund before
                      confirming a credit.
                    </p>
                  )}
                  {refund.notes && (
                    <p className="commerce-note">{refund.notes}</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Section>
      {refundEditor && (
        <RefundEditor
          commerce={commerce}
          {...refundEditor}
          onSave={run}
          saveError={error}
          onClose={() => setRefundEditor(null)}
        />
      )}
    </div>
  );
}
