"use client";

import {
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
} from "lucide-react";
import Link from "next/link";
import {
  accountHistoryHref,
  accountTransactionDirection,
  getRecentAccountTransactions,
  maskedAccountSuffix,
} from "@/lib/account-presentation";
import { formatDate, formatMoney } from "@/lib/finance";
import type { TransactionKind, WorkspaceData } from "@/lib/types";
import "./financial-card-carousel.css";

const kindLabels: Record<TransactionKind, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  bill_payment: "Repayment",
  refund: "Refund",
  adjustment: "Adjustment",
};

export function RecentAccountTransactions({
  data,
  accountId,
  limit = 4,
  asOf,
  onNavigate,
}: {
  data: WorkspaceData;
  accountId: string;
  limit?: 3 | 4 | 5;
  asOf?: string;
  onNavigate?: () => void;
}) {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account) return null;
  const transactions = getRecentAccountTransactions(data, accountId, limit, asOf);
  return (
    <section
      className="recent-account-transactions"
      data-account-id={accountId}
      aria-label={`${account.name} recent transactions`}
    >
      <div className="recent-account-heading">
        <div>
          <h3>Recent transactions</h3>
          <p>
            {account.name} · {maskedAccountSuffix(account.maskedSuffix)}
          </p>
        </div>
        <Link href={accountHistoryHref(accountId)} onClick={onNavigate}>
          View all <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {transactions.length ? (
        <ul>
          {transactions.map((transaction) => {
            const direction = accountTransactionDirection(
              transaction,
              accountId,
            );
            const Icon =
              direction === "outgoing"
                ? ArrowUpRight
                : direction === "incoming"
                  ? ArrowDownLeft
                  : ArrowLeftRight;
            return (
              <li
                key={transaction.id}
                data-transaction-id={transaction.id}
                data-status={transaction.status}
              >
                <span
                  className="recent-account-direction"
                  data-direction={direction}
                >
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div className="recent-account-description">
                  <strong>
                    {transaction.merchant ||
                      transaction.description ||
                      "Description not available"}
                  </strong>
                  <span>
                    {transaction.occurredOn
                      ? formatDate(transaction.occurredOn)
                      : "Date unconfirmed"}{" "}
                    · {kindLabels[transaction.kind]}
                  </span>
                  {transaction.status !== "posted" && (
                    <small>
                      {transaction.status === "pending_review"
                        ? "Pending review · not posted"
                        : "Voided · not posted"}
                    </small>
                  )}
                </div>
                <b className="recent-account-amount" data-direction={direction}>
                  <span className="financial-carousel-announcement">
                    {direction === "incoming"
                      ? "Incoming"
                      : direction === "outgoing"
                        ? "Outgoing"
                        : "Internal"}{" "}
                    amount{" "}
                  </span>
                  {direction === "outgoing"
                    ? "−"
                    : direction === "incoming"
                      ? "+"
                      : ""}
                  {formatMoney(transaction.amount)}
                </b>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="recent-account-empty">
          No transactions recorded for this account yet.
        </p>
      )}
    </section>
  );
}
