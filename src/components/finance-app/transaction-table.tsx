"use client";

import { ArrowUpRight, MoreHorizontal } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Badge, Empty } from "../ui";
import {
  formatMoney,
  formatDate,
  transactionDirection,
  transactionNotionUrl,
} from "@/lib/finance";
import { TransactionIcon, transactionIconColor } from "../transaction-icon";
import { type Transaction } from "@/lib/types";
import { kindLabel } from "./helpers";

export function TransactionTable({
  transactions,
  onEdit,
}: {
  transactions: Transaction[];
  onEdit?: (t: Transaction) => void;
}) {
  const { data, mode, transactionSourceIds = {} } = useFinance();
  const accountsById = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  return transactions.length ? (
    <div className="table-wrap fintech-ledger">
      <table className="transaction-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Category</th>
            <th>Account</th>
            <th>Date</th>
            <th className="align-right">Amount</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const from = t.fromAccountId
              ? accountsById.get(t.fromAccountId)
              : undefined;
            const to = t.toAccountId
              ? accountsById.get(t.toAccountId)
              : undefined;
            const direction = transactionDirection(t);
            const incoming = direction === "incoming";
            const paired = direction === "between_accounts";
            const sourceIds = transactionSourceIds[t.id] ?? [];
            const notionUrls =
              mode === "demo"
                ? []
                : [
                    ...new Set(
                      [
                        transactionNotionUrl(t),
                        ...sourceIds.map((sourceObjectId) =>
                          transactionNotionUrl({
                            ...t,
                            sourceSystem: "notion",
                            sourceObjectId,
                          }),
                        ),
                      ].filter((url): url is string => Boolean(url)),
                    ),
                  ];
            const externalPayer =
              t.externalPayer && !/unconfirmed|unknown/i.test(t.externalPayer)
                ? t.externalPayer
                : null;
            return (
              <tr key={t.id}>
                <td>
                  <div className="transaction-description">
                    <span
                      className="txn-icon category-icon"
                      style={
                        {
                          "--category-color": transactionIconColor(t),
                        } as React.CSSProperties
                      }
                    >
                      <TransactionIcon transaction={t} />
                    </span>
                    <span>
                      <button className="row-link" onClick={() => onEdit?.(t)}>
                        {t.description}
                      </button>
                      <small>
                        {externalPayer
                          ? `Paid by ${externalPayer}`
                          : kindLabel(t.kind)}
                        {t.status === "pending_review" ? " · Needs review" : ""}
                      </small>
                      {notionUrls.length > 0 && (
                        <details>
                          <summary className="text-link">
                            Source details
                          </summary>
                          <small>
                            {notionUrls.map((notionUrl, index) => (
                              <a
                                key={notionUrl}
                                href={notionUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {index > 0 ? " · " : ""}View original Notion
                                record{" "}
                                <ArrowUpRight size={12} aria-hidden="true" />
                              </a>
                            ))}
                            {t.externalReference && (
                              <> · Reference: {t.externalReference}</>
                            )}
                          </small>
                        </details>
                      )}
                    </span>
                  </div>
                </td>
                <td>
                  <span className="category-pill">
                    {t.category || "Uncategorized"}
                  </span>
                </td>
                <td>
                  {paired
                    ? `${from?.name || "Unknown account"} → ${to?.name || "Unknown account"}`
                    : from?.name ||
                      to?.name ||
                      (externalPayer
                        ? `Paid by ${externalPayer}`
                        : "Payment account unknown")}
                </td>
                <td>
                  {t.occurredOn ? (
                    formatDate(t.occurredOn)
                  ) : (
                    <Badge tone="amber">Date needed</Badge>
                  )}
                </td>
                <td
                  className={`amount align-right ${incoming ? "green-text" : ""}`}
                >
                  {incoming
                    ? "+"
                    : direction === "outgoing"
                      ? "−"
                      : paired
                        ? "↔ "
                        : ""}
                  {formatMoney(t.amount)}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${t.description}`}
                    onClick={() => onEdit?.(t)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No transactions here yet"
      description="Try another filter or add a transaction."
    />
  );
}
