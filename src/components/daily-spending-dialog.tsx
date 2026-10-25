"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import {
  analyticsTransactionsHref,
  type DailySpendingDetail,
  type SpendingMode,
} from "@/lib/analytics-presentation";
import {
  compareMoney,
  formatDate,
  formatMoney,
  subtractMoney,
} from "@/lib/finance";
import type { Transaction, WorkspaceData } from "@/lib/types";
import { TransactionRow } from "./unified-transaction-history";
import "./daily-spending-dialog.css";

export function DailySpendingDialog({
  detail,
  mode,
  data,
  trigger,
  onClose,
  onOpenTransaction,
}: {
  detail: DailySpendingDetail;
  mode: SpendingMode;
  data: WorkspaceData;
  trigger: HTMLElement | SVGSVGElement | null;
  onClose: () => void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const skipRestore = useRef(false);
  const refunds =
    mode === "net"
      ? detail.refundRows.filter(
          ({ transaction }) =>
            transaction.refundOfTransactionId &&
            data.transactions.some(
              (original) =>
                original.id === transaction.refundOfTransactionId &&
                original.userId === transaction.userId &&
                original.kind === "expense" &&
                original.status === "posted" &&
                original.occurredOn,
            ),
        )
      : [];
  const rows = [
    ...detail.expenses.map((transaction) => ({
      transaction,
      matched: null as string | null,
    })),
    ...refunds,
  ].sort((a, b) => a.transaction.id.localeCompare(b.transaction.id));
  const total = mode === "net" ? detail.net : detail.gross;
  const accounts = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  const date = formatDate(detail.date, { year: "numeric" });
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="daily-spending-overlay" />
        <Dialog.Content
          className="daily-spending-dialog"
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            title.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!skipRestore.current && trigger?.isConnected)
              trigger.focus({ preventScroll: true });
          }}
        >
          <div className="daily-spending-handle" aria-hidden="true" />
          <header className="daily-spending-heading">
            <div>
              <Dialog.Title ref={title} tabIndex={-1}>
                {date}
              </Dialog.Title>
              <Dialog.Description>
                Daily spending ·{" "}
                {mode === "net" ? "Net after refunds" : "Gross spending"}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="daily-spending-close"
              aria-label="Close daily spending"
            >
              <X size={19} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div className="daily-spending-body">
            <section
              className="daily-spending-overview"
              aria-label="Daily spending summary"
            >
              <span>{mode === "net" ? "Net spending" : "Total spending"}</span>
              <strong data-testid="daily-spending-total">
                {formatMoney(total)}
              </strong>
              <p>
                {detail.expenses.length} posted expense
                {detail.expenses.length === 1 ? "" : "s"}
              </p>
              <dl>
                <div>
                  <dt>Gross expenses</dt>
                  <dd>{formatMoney(detail.gross)}</dd>
                </div>
                <div>
                  <dt>
                    Matched refunds{mode === "gross" ? " · net mode" : ""}
                  </dt>
                  <dd>{formatMoney(detail.refunds)}</dd>
                </div>
              </dl>
            </section>
            {mode === "net" && compareMoney(detail.net, "0.00") < 0 && (
              <p className="daily-spending-note">
                Matched refunds exceed posted expenses attributed to this date,
                so net spending is negative. Refunds can relate to an earlier
                purchase.
              </p>
            )}
            <section
              className="daily-spending-records"
              aria-label="Daily transactions"
            >
              <h3>Transactions</h3>
              {rows.length === 0 ? (
                <p className="daily-spending-empty">
                  No posted{" "}
                  {mode === "net" ? "expenses or matched refunds" : "expenses"}{" "}
                  contribute to spending on this date.
                </p>
              ) : (
                <div className="uth-card" role="list">
                  {rows.map(({ transaction, matched }, idx) => {
                    const refund = transaction.kind === "refund";
                    const unapplied =
                      matched === null
                        ? "0.00"
                        : subtractMoney(transaction.amount, matched);

                    const metaNote =
                      refund && matched !== null ? (
                        <span className="daily-spending-refund-attribution">
                          {formatMoney(matched)} applied to this day’s net spending
                          {compareMoney(unapplied, "0.00") > 0
                            ? ` · ${formatMoney(unapplied)} not applied to this day’s net spending`
                            : ""}
                          {transaction.occurredOn !== detail.date
                            ? " · Recognized when the linked purchase became dated and posted"
                            : ""}
                        </span>
                      ) : undefined;

                    return (
                      <div key={transaction.id} className="uth-row-container">
                        {idx > 0 && <div className="uth-divider" />}
                        <TransactionRow
                          transaction={transaction}
                          accounts={accounts}
                          onSelect={() => {
                            skipRestore.current = true;
                            onClose();
                            requestAnimationFrame(() =>
                              onOpenTransaction(transaction),
                            );
                          }}
                          metaNote={metaNote}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <p className="daily-spending-ledger-note">
              Spending excludes pending, voided, transfers and repayments. View
              the complete date ledger for other saved activity.
            </p>
          </div>
          <footer className="daily-spending-footer">
            <Link
              href={analyticsTransactionsHref({ date: detail.date })}
              className="button primary"
              onClick={() => {
                skipRestore.current = true;
                onClose();
              }}
            >
              View all transactions{" "}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
