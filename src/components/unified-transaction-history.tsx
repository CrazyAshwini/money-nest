"use client";

import { useMemo, type ReactNode, type MouseEvent } from "react";
import { ArrowLeftRight, Search } from "lucide-react";
import {
  formatDate,
  formatMoney,
  transactionDirection,
} from "@/lib/finance";
import { accountTransactionDirection } from "@/lib/account-presentation";
import type { Account, Transaction, TransactionKind } from "@/lib/types";
import { useFinance } from "./finance-provider";
import { TransactionIcon, transactionIconColor } from "./transaction-icon";
import "./unified-transaction-history.css";

export function isRecordedDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const kindLabels: Record<TransactionKind, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  bill_payment: "Repayment",
  refund: "Refund",
  adjustment: "Adjustment",
};

/**
 * Format date heading consistently (e.g. "18 October 2026").
 */
export function formatTransactionDateHeading(
  date: string | null | undefined,
): string {
  if (!date || date === "__unavailable__") return "Date unconfirmed";
  if (!isRecordedDate(date)) return "Date unavailable";
  return formatDate(date, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Format signed transaction amount with accounting precision and correct indicators (+, −, ↔).
 */
export function formatSignedTransactionAmount(
  transaction: Transaction,
  currentAccountId?: string,
): { sign: string; formatted: string; tone: "incoming" | "outgoing" | "between" } {
  const direction = currentAccountId
    ? accountTransactionDirection(transaction, currentAccountId)
    : transactionDirection(transaction);

  let sign = "";
  let tone: "incoming" | "outgoing" | "between" = "outgoing";

  if (direction === "incoming") {
    sign = "+";
    tone = "incoming";
  } else if (direction === "outgoing") {
    sign = "−";
    tone = "outgoing";
  } else if (direction === "between_accounts" || direction === "internal") {
    sign = "↔ ";
    tone = "between";
  }

  // Ensure clean unsigned string before formatting
  const cleanAmount = (transaction.amount || "0").replace(/^[−-]/, "");
  const formatted = `${sign}${formatMoney(cleanAmount)}`;

  return { sign, formatted, tone };
}

/**
 * Groups an array of transactions by their local calendar date.
 */
export function groupTransactionsByDate(
  transactions: Transaction[],
  sort: "newest" | "oldest" = "newest",
): { dateKey: string; dateLabel: string; transactions: Transaction[] }[] {
  const map = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const key = isRecordedDate(tx.occurredOn)
      ? tx.occurredOn!
      : tx.occurredOn
        ? "__unavailable__"
        : "__unconfirmed__";
    const list = map.get(key) || [];
    list.push(tx);
    map.set(key, list);
  }

  const entries = Array.from(map.entries());

  // Sort date groups: actual dates sorted by sort order, undated items at the end
  entries.sort(([a], [b]) => {
    const aIsDate = isRecordedDate(a);
    const bIsDate = isRecordedDate(b);

    if (aIsDate && bIsDate) {
      return sort === "oldest" ? a.localeCompare(b) : b.localeCompare(a);
    }
    if (aIsDate) return -1;
    if (bIsDate) return 1;
    return 0;
  });

  return entries.map(([dateKey, txList]) => ({
    dateKey,
    dateLabel: formatTransactionDateHeading(
      dateKey === "__unconfirmed__" || dateKey === "__unavailable__"
        ? null
        : dateKey,
    ),
    transactions: txList,
  }));
}

/**
 * Props for an individual unified TransactionRow.
 */
export interface TransactionRowProps {
  transaction: Transaction;
  accounts?: Map<string, Account> | Account[];
  currentAccountId?: string;
  onSelect?: (
    transaction: Transaction,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  interactive?: boolean;
  metaNote?: ReactNode;
  className?: string;
}

/**
 * Standardized transaction row component matching the reference design.
 */
export function TransactionRow({
  transaction,
  accounts: propAccounts,
  currentAccountId,
  onSelect,
  interactive = true,
  metaNote,
  className,
}: TransactionRowProps) {
  const finance = useFinance();

  // Resolve accounts map
  const accountsMap = useMemo(() => {
    if (propAccounts instanceof Map) return propAccounts;
    if (Array.isArray(propAccounts)) {
      return new Map(propAccounts.map((a) => [a.id, a]));
    }
    return new Map(finance.data.accounts.map((a) => [a.id, a]));
  }, [propAccounts, finance.data.accounts]);

  const merchantName =
    transaction.merchant || transaction.description || "Unspecified merchant";

  // Build secondary line: Category · Platform
  const categoryText =
    transaction.category || kindLabels[transaction.kind] || "Other";
  const secondaryLine = transaction.platform
    ? `${categoryText} · ${transaction.platform}`
    : categoryText;

  // Build tertiary line for transfers: Source Account → Destination Account
  const isTransfer =
    transaction.kind === "transfer" ||
    transaction.kind === "bill_payment" ||
    transactionDirection(transaction) === "between_accounts";

  let transferRoute: string | null = null;
  if (isTransfer) {
    const fromName = transaction.fromAccountId
      ? accountsMap.get(transaction.fromAccountId)?.name
      : null;
    const toName = transaction.toAccountId
      ? accountsMap.get(transaction.toAccountId)?.name
      : null;

    if (fromName && toName) {
      transferRoute = `${fromName} → ${toName}`;
    } else if (fromName || toName) {
      transferRoute = fromName || toName || null;
    } else if (
      transaction.externalPayer &&
      !/unconfirmed|unknown/i.test(transaction.externalPayer)
    ) {
      transferRoute = `Paid by ${transaction.externalPayer}`;
    }
  }

  // Format amount with directional sign and color tone
  const { formatted, tone } = formatSignedTransactionAmount(
    transaction,
    currentAccountId,
  );

  // Icon styling with soft category tint
  const iconColor = transactionIconColor(transaction);
  const iconBg = `${iconColor}1a`; // 10% opacity hex tint

  const rowClasses = [
    "uth-row",
    !interactive || !onSelect ? "is-static" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <div
        className="uth-icon-wrap"
        style={
          {
            "--uth-icon-color": iconColor,
            "--uth-icon-bg": iconBg,
          } as React.CSSProperties
        }
      >
        <TransactionIcon transaction={transaction} />
      </div>

      <div className="uth-content">
        <div className="uth-primary-line">
          <strong className="uth-merchant" title={merchantName}>
            {merchantName}
          </strong>
        </div>

        <div className="uth-secondary-line">
          <span className="uth-subtitle">{secondaryLine}</span>
        </div>

        {transferRoute && (
          <div className="uth-tertiary-line">
            <span className="uth-transfer-route">
              <ArrowLeftRight size={11} aria-hidden="true" />
              {transferRoute}
            </span>
          </div>
        )}

        {transaction.status === "pending_review" && (
          <div className="uth-badge is-pending">Needs review</div>
        )}

        {transaction.status === "voided" && (
          <div className="uth-badge is-voided">Voided</div>
        )}

        {metaNote && <div className="uth-meta-note">{metaNote}</div>}
      </div>

      <div className="uth-amount-wrap">
        <span
          className={`uth-amount ${
            tone === "incoming"
              ? "is-incoming"
              : tone === "between"
                ? "is-between"
                : ""
          }`}
        >
          {formatted}
        </span>
      </div>
    </>
  );

  if (interactive && onSelect) {
    return (
      <button
        type="button"
        data-transaction-id={transaction.id}
        className={rowClasses}
        onClick={(e) => onSelect(transaction, e)}
        aria-label={`View transaction: ${merchantName}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      data-transaction-id={transaction.id}
      className={rowClasses}
      role="listitem"
    >
      {content}
    </div>
  );
}

/**
 * A date group container: Heading + single white rounded card containing rows with dividers.
 */
export function TransactionDateGroup({
  dateLabel,
  transactions,
  accounts,
  currentAccountId,
  onSelectTransaction,
  renderRow,
}: {
  dateLabel: string;
  transactions: Transaction[];
  accounts?: Map<string, Account> | Account[];
  currentAccountId?: string;
  onSelectTransaction?: (
    transaction: Transaction,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  renderRow?: (transaction: Transaction) => ReactNode;
}) {
  if (!transactions.length) return null;

  return (
    <div className="uth-date-group">
      <h3 className="uth-date-heading">{dateLabel}</h3>
      <div className="uth-card" role="list">
        {transactions.map((tx, idx) => (
          <div key={tx.id} className="uth-row-container">
            {idx > 0 && <div className="uth-divider" />}
            {renderRow ? (
              renderRow(tx)
            ) : (
              <TransactionRow
                transaction={tx}
                accounts={accounts}
                currentAccountId={currentAccountId}
                onSelect={onSelectTransaction}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Standardized empty state for transaction lists.
 */
export function TransactionEmptyState({
  title = "No transactions found",
  description = "No transactions recorded for the selected period or filters.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="uth-empty" role="status">
      <Search size={28} className="uth-empty-icon" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div style={{ marginTop: "8px" }}>{action}</div>}
    </div>
  );
}

/**
 * Master unified TransactionHistory component.
 * Reused identically across Mobile, Desktop, Dashboard, Account details, and Analytics.
 */
export function TransactionHistory({
  transactions,
  accounts,
  currentAccountId,
  groupByDate = true,
  limit,
  sort = "newest",
  showHeader = false,
  headerTitle = "Transaction history",
  headerAction,
  onSelectTransaction,
  emptyState,
  renderRow,
  className,
}: {
  transactions: Transaction[];
  accounts?: Map<string, Account> | Account[];
  currentAccountId?: string;
  groupByDate?: boolean;
  limit?: number;
  sort?: "newest" | "oldest";
  showHeader?: boolean;
  headerTitle?: string;
  headerAction?: ReactNode;
  onSelectTransaction?: (
    transaction: Transaction,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  emptyState?: ReactNode;
  renderRow?: (transaction: Transaction) => ReactNode;
  className?: string;
}) {
  const displayed = useMemo(() => {
    if (limit && limit > 0) {
      return transactions.slice(0, limit);
    }
    return transactions;
  }, [transactions, limit]);

  const dateGroups = useMemo(() => {
    if (!groupByDate) return [];
    return groupTransactionsByDate(displayed, sort);
  }, [displayed, groupByDate, sort]);

  if (!displayed.length) {
    return (
      <div className={`uth-container ${className || ""}`}>
        {showHeader && (
          <div className="uth-header">
            <h2>{headerTitle}</h2>
            {headerAction && (
              <div className="uth-header-action">{headerAction}</div>
            )}
          </div>
        )}
        {emptyState || <TransactionEmptyState />}
      </div>
    );
  }

  return (
    <div className={`uth-container ${className || ""}`}>
      {showHeader && (
        <div className="uth-header">
          <h2>{headerTitle}</h2>
          {headerAction && (
            <div className="uth-header-action">{headerAction}</div>
          )}
        </div>
      )}

      {groupByDate ? (
        dateGroups.map((group) => (
          <TransactionDateGroup
            key={group.dateKey}
            dateLabel={group.dateLabel}
            transactions={group.transactions}
            accounts={accounts}
            currentAccountId={currentAccountId}
            onSelectTransaction={onSelectTransaction}
            renderRow={renderRow}
          />
        ))
      ) : (
        <div className="uth-card" role="list">
          {displayed.map((tx, idx) => (
            <div key={tx.id} className="uth-row-container">
              {idx > 0 && <div className="uth-divider" />}
              {renderRow ? (
                renderRow(tx)
              ) : (
                <TransactionRow
                  transaction={tx}
                  accounts={accounts}
                  currentAccountId={currentAccountId}
                  onSelect={onSelectTransaction}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Alias for convenience
export const TransactionList = TransactionHistory;
