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
import type { Transaction, TransactionKind, WorkspaceData } from "@/lib/types";
import { TransactionIcon } from "./transaction-icon";
import "./financial-card-carousel.css";
import "./recent-account-transactions.css";

const kindLabels: Record<TransactionKind, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  bill_payment: "Repayment",
  refund: "Refund",
  adjustment: "Adjustment",
};

function recordedDateKey(date: string | null): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : "__unavailable__";
}

function GroupedAccountHistory({
  data,
  ownerId,
  accountId,
  transactions,
  onOpenTransaction,
}: {
  data: WorkspaceData;
  ownerId: string;
  accountId: string;
  transactions: readonly Transaction[];
  onOpenTransaction?: (transaction: Transaction) => void;
}) {
  const accounts = new Map(
    data.accounts
      .filter((account) => account.userId === ownerId)
      .map((account) => [account.id, account]),
  );
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const key = recordedDateKey(transaction.occurredOn);
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }

  return (
    <div className="recent-account-date-groups">
      {[...groups].map(([date, group]) => (
        <div className="recent-account-date-group" key={date}>
          <h4>
            {date === "__unavailable__"
              ? "Date unavailable"
              : date
                ? formatDate(date, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "Date unconfirmed"}
          </h4>
          <ul>
            {group.map((transaction) => {
              const direction = accountTransactionDirection(
                transaction,
                accountId,
              );
              const from = transaction.fromAccountId
                ? accounts.get(transaction.fromAccountId)
                : undefined;
              const to = transaction.toAccountId
                ? accounts.get(transaction.toAccountId)
                : undefined;
              const flow = from && to ? `${from.name} → ${to.name}` : "";
              const description =
                transaction.merchant ||
                transaction.description ||
                "Description not available";
              const category =
                transaction.category || kindLabels[transaction.kind];
              const metadata = transaction.platform
                ? `${category} · ${transaction.platform}`
                : category;
              const content = (
                <>
                  <span
                    className="recent-account-row-icon"
                    data-direction={direction}
                  >
                    <TransactionIcon transaction={transaction} />
                  </span>
                  <span className="recent-account-row-description">
                    <strong title={description}>{description}</strong>
                    <span title={metadata}>{metadata}</span>
                    {flow && <span title={flow}>{flow}</span>}
                    {transaction.status !== "posted" && (
                      <small data-status={transaction.status}>
                        {transaction.status === "pending_review"
                          ? "Needs review · not posted"
                          : "Voided · not posted"}
                      </small>
                    )}
                  </span>
                  <b
                    className="recent-account-row-amount"
                    data-direction={direction}
                  >
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
                        : "↔ "}
                    {formatMoney(transaction.amount)}
                  </b>
                </>
              );
              return (
                <li
                  key={transaction.id}
                  data-transaction-id={transaction.id}
                  data-status={transaction.status}
                >
                  {onOpenTransaction ? (
                    <button
                      type="button"
                      className="recent-account-row"
                      aria-label={`View transaction: ${transaction.description || description}`}
                      onClick={() => onOpenTransaction(transaction)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="recent-account-row">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function RecentAccountTransactions({
  data,
  accountId,
  limit = 4,
  asOf,
  onNavigate,
  variant = "legacy",
  title = "Recent transactions",
  onOpenTransaction,
}: {
  data: WorkspaceData;
  accountId: string;
  limit?: 3 | 4 | 5;
  asOf?: string;
  onNavigate?: () => void;
  variant?: "legacy" | "grouped";
  title?: string;
  onOpenTransaction?: (transaction: Transaction) => void;
}) {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account) return null;
  const transactions = getRecentAccountTransactions(
    data,
    accountId,
    limit,
    asOf,
  );
  if (variant === "grouped")
    return (
      <section
        className="recent-account-transactions recent-account-grouped"
        data-account-id={accountId}
        data-variant="grouped"
        aria-label={`${account.name} ${title.toLowerCase()}`}
      >
        <div className="recent-account-heading">
          <h3>{title}</h3>
          <Link href={accountHistoryHref(accountId)} onClick={onNavigate}>
            View all <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {transactions.length ? (
          <GroupedAccountHistory
            data={data}
            ownerId={account.userId}
            accountId={accountId}
            transactions={transactions}
            onOpenTransaction={onOpenTransaction}
          />
        ) : (
          <p className="recent-account-empty">
            No transactions recorded for this account yet.
          </p>
        )}
      </section>
    );
  return (
    <section
      className="recent-account-transactions"
      data-account-id={accountId}
      aria-label={`${account.name} recent transactions`}
    >
      <div className="recent-account-heading">
        <div>
          <h3>{title}</h3>
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
