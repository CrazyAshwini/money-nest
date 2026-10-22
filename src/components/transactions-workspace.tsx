"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Download, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  formatDate,
  formatMoney,
  transactionDirection,
  transactionNotionUrl,
} from "@/lib/finance";
import { exportTransactionsCsv } from "@/lib/imports";
import {
  getTransactionView,
  parseTransactionFilters,
  serializeTransactionFilters,
  type TransactionViewFilters,
} from "@/lib/transactions-view";
import type { Account, Transaction } from "@/lib/types";
import { useFinance } from "./finance-provider";
import { TransactionIcon } from "./transaction-icon";
import { downloadFile } from "./ui";
import "./transactions-workspace.css";

const tabs = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "transfer", label: "Transfer" },
  { value: "income", label: "Income" },
] as const;

const TRANSACTION_URL_CHANGE = "moneynest:transactions-url-change";

function subscribeToTransactionUrl(notify: () => void) {
  // Native traversal is authoritative, including entries restored after a reload.
  // Next's router still handles navigation; filters are never copied into React state.
  window.addEventListener("popstate", notify);
  window.addEventListener("pageshow", notify);
  window.addEventListener(TRANSACTION_URL_CHANGE, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener("pageshow", notify);
    window.removeEventListener(TRANSACTION_URL_CHANGE, notify);
  };
}

function transactionUrlSnapshot() {
  return window.location.search.slice(1);
}

function kindLabel(value: string) {
  if (value === "bill_payment") return "Bill payment";
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

function statusLabel(transaction: Transaction) {
  return transaction.status === "pending_review"
    ? "Needs review"
    : transaction.status === "voided"
      ? "Voided"
      : "Posted";
}

function compactMonth(month: string) {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function isRecordedDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function recordedDateLabel(
  value: string | null,
  options?: Intl.DateTimeFormatOptions,
) {
  return isRecordedDate(value)
    ? formatDate(value, options)
    : value
      ? "Date unavailable"
      : "Date not recorded";
}

function transactionAccount(
  transaction: Transaction,
  accounts: Map<string, Account>,
) {
  const from = transaction.fromAccountId
    ? accounts.get(transaction.fromAccountId)?.name || "Unavailable account"
    : "";
  const to = transaction.toAccountId
    ? accounts.get(transaction.toAccountId)?.name || "Unavailable account"
    : "";
  if (from && to) return `${from} → ${to}`;
  if (from || to) return from || to;
  if (
    transaction.externalPayer &&
    !/unconfirmed|unknown/i.test(transaction.externalPayer)
  )
    return `Paid by ${transaction.externalPayer}`;
  return "Account not recorded";
}

function SignedAmount({ transaction }: { transaction: Transaction }) {
  const direction = transactionDirection(transaction);
  const sign =
    direction === "incoming"
      ? "+"
      : direction === "outgoing"
        ? "−"
        : direction === "between_accounts"
          ? "↔ "
          : "";
  return (
    <span className={`txw-amount txw-amount-${direction}`}>
      {sign}
      {formatMoney(transaction.amount)}
    </span>
  );
}

function TransactionDetails({
  transaction,
  accounts,
  sourceIds,
  onEdit,
  onClose,
}: {
  transaction: Transaction;
  accounts: Map<string, Account>;
  sourceIds: string[];
  onEdit: (transaction: Transaction) => void;
  onClose: () => void;
}) {
  const { deleteRecord, toast } = useFinance();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    try {
      setIsDeleting(true);
      await deleteRecord("transactions", transaction.id);
      toast("Transaction deleted", "success");
      onClose();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to delete transaction",
        "error",
      );
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }

  const sourceUrls = [
    ...new Set(
      [
        transactionNotionUrl(transaction),
        ...sourceIds.map((sourceObjectId) =>
          transactionNotionUrl({
            ...transaction,
            sourceSystem: "notion",
            sourceObjectId,
          }),
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  return (
    <>
      <div className="txw-detail-heading">
        <div>
          <Dialog.Title>Transaction details</Dialog.Title>
          <Dialog.Description>
            Saved activity in your workspace
          </Dialog.Description>
        </div>
        <Dialog.Close
          className="txw-icon-button"
          aria-label="Close transaction details"
        >
          <X size={20} aria-hidden="true" />
        </Dialog.Close>
      </div>
      <div className="txw-detail-body">
        <div className="txw-detail-primary">
          <span className="txw-transaction-icon">
            <TransactionIcon transaction={transaction} />
          </span>
          <h3>{transaction.merchant || transaction.description}</h3>
          <SignedAmount transaction={transaction} />
          {transaction.merchant &&
            transaction.merchant !== transaction.description && (
              <p>{transaction.description}</p>
            )}
        </div>
        <dl className="txw-detail-facts">
          <div>
            <dt>Date</dt>
            <dd>
              {recordedDateLabel(transaction.occurredOn, { year: "numeric" })}
            </dd>
          </div>
          <div>
            <dt>Transaction type</dt>
            <dd>{kindLabel(transaction.kind)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{statusLabel(transaction)}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{transaction.category || "Uncategorized"}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{transaction.platform || "Not recorded"}</dd>
          </div>
          <div>
            <dt>Payment account</dt>
            <dd>{transactionAccount(transaction, accounts)}</dd>
          </div>
          {transaction.externalReference && (
            <div>
              <dt>Reference</dt>
              <dd>{transaction.externalReference}</dd>
            </div>
          )}
          {transaction.refundOfTransactionId && (
            <div>
              <dt>Linked activity</dt>
              <dd>Linked to its original transaction</dd>
            </div>
          )}
          {transaction.notes && (
            <div>
              <dt>Notes</dt>
              <dd>{transaction.notes}</dd>
            </div>
          )}
        </dl>
        {sourceUrls.length > 0 && (
          <div className="txw-source-links">
            {sourceUrls.map((href, index) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                View original Notion record
                {sourceUrls.length > 1 ? ` ${index + 1}` : ""}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="txw-detail-footer" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
        {confirmDelete ? (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="button danger"
              disabled={isDeleting}
              onClick={handleDelete}
            >
              {isDeleting ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              className="button"
              disabled={isDeleting}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          className="button primary"
          onClick={() => {
            onClose();
            requestAnimationFrame(() => onEdit(transaction));
          }}
        >
          Edit transaction
        </button>
      </div>
    </>
  );
}

export function TransactionsWorkspace({
  onEdit,
}: {
  onEdit: (transaction: Transaction) => void;
}) {
  const { data, userId, today, toast, transactionSourceIds } = useFinance();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const queryString = useSyncExternalStore(
    subscribeToTransactionUrl,
    transactionUrlSnapshot,
    () => searchParams.toString(),
  );
  const filters = useMemo(
    () => parseTransactionFilters(new URLSearchParams(queryString), today),
    [queryString, today],
  );
  const view = useMemo(
    () => getTransactionView(data, userId, filters, today),
    [data, userId, filters, today],
  );
  const accounts = useMemo(
    () =>
      new Map(
        data.accounts
          .filter((account) => account.userId === userId)
          .map((account) => [account.id, account]),
      ),
    [data.accounts, userId],
  );
  const [searchOpened, setSearchOpened] = useState(false);
  const searchExpanded = searchOpened || Boolean(filters.query);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const categorySelect = useRef<HTMLSelectElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const selectedTransaction = selectedId
    ? data.transactions.find(
        (transaction) =>
          transaction.id === selectedId && transaction.userId === userId,
      )
    : null;
  const categoryEnabled =
    filters.kind !== "income" &&
    filters.kind !== "transfer" &&
    filters.kind !== "bill_payment";
  const currentTab =
    filters.kind === "bill_payment"
      ? "transfer"
      : tabs.some((tab) => tab.value === filters.kind)
        ? filters.kind
        : "all";

  useEffect(() => {
    if (searchExpanded) searchInput.current?.focus();
  }, [searchExpanded]);

  function updateFilters(
    patch: Partial<TransactionViewFilters>,
    replace = false,
  ) {
    const params = serializeTransactionFilters({ ...filters, ...patch });
    const query = params.toString();
    const href = `${pathname}${query ? `?${query}` : ""}`;
    if (href === `${window.location.pathname}${window.location.search}`) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", href);
    window.dispatchEvent(new Event(TRANSACTION_URL_CHANGE));
  }

  function closeSearch() {
    setSearchOpened(false);
    updateFilters({ query: "" });
    requestAnimationFrame(() => searchButton.current?.focus());
  }

  function clearFilters() {
    setSearchOpened(false);
    updateFilters({ category: "", platform: "", query: "" });
    requestAnimationFrame(() => {
      (categorySelect.current || searchButton.current)?.focus();
    });
  }

  function openDetails(transaction: Transaction, trigger: HTMLElement) {
    detailTrigger.current = trigger;
    setSelectedId(transaction.id);
  }

  const filtered = Boolean(
    (categoryEnabled && (filters.category || filters.platform)) ||
    filters.query ||
    filters.account ||
    filters.status ||
    !tabs.some((tab) => tab.value === filters.kind),
  );
  const expenseHeading =
    filters.category && categoryEnabled
      ? filters.platform
        ? `${filters.category} spending via ${filters.platform}`
        : `Expenses on ${filters.category}`
      : filters.query
        ? "Matching expenses"
        : filters.period === "month"
          ? "Total expenses this month"
          : filters.period === "date"
            ? "Total expenses this day"
            : "Total expenses";
  const periodValue = filters.invalidPeriod
    ? "__invalid__"
    : filters.period === "all"
      ? "__all__"
      : filters.period === "date"
        ? "__date__"
        : filters.month;
  const dateGroups = new Map<string, Transaction[]>();
  for (const transaction of view.transactions) {
    const key = isRecordedDate(transaction.occurredOn)
      ? transaction.occurredOn
      : transaction.occurredOn
        ? "__unavailable__"
        : "";
    const group = dateGroups.get(key) || [];
    group.push(transaction);
    dateGroups.set(key, group);
  }
  const hasLegacyKind = !tabs.some((tab) => tab.value === filters.kind);
  const contextVisible = Boolean(
    filters.account ||
    filters.status ||
    filters.period === "date" ||
    hasLegacyKind ||
    filters.invalidPeriod,
  );
  const accountContext = filters.account
    ? accounts.get(filters.account)?.name || "Unavailable account"
    : "";
  const statusContext =
    filters.status === "pending_review"
      ? "Needs review"
      : filters.status
        ? kindLabel(filters.status)
        : "";
  const hasNonSummaryActivity = view.transactions.some(
    (transaction) =>
      transaction.kind === "refund" || transaction.kind === "adjustment",
  );

  return (
    <div className="transactions-workspace">
      <header className="txw-header">
        <h1>Transactions</h1>
        <select
          aria-label="Transaction month"
          value={periodValue}
          onChange={(event) => {
            const value = event.target.value;
            updateFilters({
              period: value === "__all__" ? "all" : "month",
              month: value === "__all__" ? today.slice(0, 7) : value,
              date: "",
              invalidPeriod: false,
            });
          }}
        >
          {filters.invalidPeriod && (
            <option value="__invalid__">
              Unavailable {filters.period === "date" ? "date" : "month"}
            </option>
          )}
          {filters.period === "date" && !filters.invalidPeriod && (
            <option value="__date__">{formatDate(filters.date)}</option>
          )}
          {view.monthOptions.map((month) => (
            <option key={month} value={month}>
              {compactMonth(month)}
            </option>
          ))}
          <option value="__all__">All dates</option>
        </select>
      </header>

      <div className="txw-tabs" role="group" aria-label="Transaction type">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={currentTab === tab.value}
            onClick={() => updateFilters({ kind: tab.value })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className={`txw-filter-row ${searchExpanded ? "txw-search-expanded" : ""} ${categoryEnabled && filters.category ? "txw-has-platform" : ""}`}
      >
        {searchExpanded ? (
          <>
            <div className="txw-search-field">
              <Search size={17} aria-hidden="true" />
              <input
                ref={searchInput}
                aria-label="Search transactions"
                placeholder="Search transactions…"
                type="search"
                value={filters.query}
                onChange={(event) =>
                  updateFilters({ query: event.target.value }, true)
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="txw-icon-button"
              aria-label="Close search"
              onClick={closeSearch}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            {categoryEnabled && (
              <select
                ref={categorySelect}
                aria-label="Category"
                value={filters.category}
                onChange={(event) =>
                  updateFilters({ category: event.target.value, platform: "" })
                }
              >
                <option value="">All categories</option>
                {view.categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            )}
            {categoryEnabled && filters.category && (
              <select
                aria-label="Platform"
                value={filters.platform}
                onChange={(event) =>
                  updateFilters({ platform: event.target.value })
                }
              >
                <option value="">All platforms</option>
                {view.platformOptions.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            )}
            <button
              ref={searchButton}
              type="button"
              className="txw-icon-button txw-search-trigger"
              aria-label="Search transactions"
              onClick={() => setSearchOpened(true)}
            >
              <Search size={19} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {contextVisible && (
        <div
          className="txw-link-context"
          aria-label="Linked transaction filters"
        >
          <span>
            {[
              filters.period === "date" ? view.periodLabel : "",
              accountContext,
              statusContext,
              hasLegacyKind ? `${kindLabel(filters.kind)} only` : "",
              filters.invalidPeriod ? "Unavailable period" : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button
            type="button"
            onClick={() =>
              updateFilters({
                account: "",
                status: "",
                date: "",
                period:
                  filters.period === "date" || filters.invalidPeriod
                    ? "month"
                    : filters.period,
                month: filters.invalidPeriod
                  ? today.slice(0, 7)
                  : filters.month,
                invalidPeriod: false,
                kind: hasLegacyKind ? "all" : filters.kind,
              })
            }
          >
            Clear linked filters
          </button>
        </div>
      )}

      <section
        className={`txw-summary ${currentTab === "all" ? "txw-summary-all" : ""}`}
        aria-label="Transaction activity summary"
      >
        {currentTab === "all" ? (
          <>
            <div className="txw-summary-heading">
              <h2>
                {filtered
                  ? "Filtered activity"
                  : filters.period === "all"
                    ? "All activity"
                    : filters.period === "date"
                      ? "Daily activity"
                      : "Monthly activity"}
              </h2>
              <p>
                {view.summary.count} transaction
                {view.summary.count === 1 ? "" : "s"}
              </p>
            </div>
            <dl className="txw-activity-totals">
              <div>
                <dt>Expenses</dt>
                <dd>{formatMoney(view.summary.expenses)}</dd>
              </div>
              <div>
                <dt>Income</dt>
                <dd className="txw-green">
                  {formatMoney(view.summary.income)}
                </dd>
              </div>
              <div>
                <dt>Transfers</dt>
                <dd>{formatMoney(view.summary.transfers)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <h2>
              {currentTab === "expense"
                ? expenseHeading
                : currentTab === "income"
                  ? "Recognized income"
                  : "Transfer activity"}
            </h2>
            <strong
              className={`txw-summary-amount ${currentTab === "income" ? "txw-green" : ""}`}
            >
              {formatMoney(
                currentTab === "expense"
                  ? view.summary.expenses
                  : currentTab === "income"
                    ? view.summary.income
                    : view.summary.transfers,
              )}
            </strong>
            <p>
              {currentTab === "expense"
                ? view.summary.expenseCount
                : currentTab === "income"
                  ? view.summary.incomeCount
                  : view.summary.transferCount}{" "}
              posted{" "}
              {currentTab === "expense"
                ? "expense"
                : currentTab === "income"
                  ? "income transaction"
                  : "transfer"}
              {(currentTab === "expense"
                ? view.summary.expenseCount
                : currentTab === "income"
                  ? view.summary.incomeCount
                  : view.summary.transferCount) === 1
                ? ""
                : "s"}{" "}
              · {view.periodLabel}
            </p>
          </>
        )}
        {(view.summary.pendingCount > 0 ||
          view.summary.voidedCount > 0 ||
          view.summary.undatedPostedCount > 0 ||
          hasNonSummaryActivity ||
          currentTab === "all") && (
          <small className="txw-summary-note">
            {currentTab === "all"
              ? "Posted amounts · Gross expenses"
              : currentTab === "expense"
                ? "Gross posted expenses"
                : "Posted amounts only"}
            {view.summary.pendingCount > 0 &&
              ` · ${view.summary.pendingCount} ${view.summary.pendingCount === 1 ? "needs" : "need"} review`}
            {view.summary.voidedCount > 0 &&
              ` · ${view.summary.voidedCount} voided`}
            {view.summary.undatedPostedCount > 0 &&
              ` · ${view.summary.undatedPostedCount} awaiting a valid date`}
            {hasNonSummaryActivity &&
              " · Refunds and adjustments remain separate"}
          </small>
        )}
      </section>

      <section className="txw-history" aria-label="Transaction history">
        <div className="txw-history-heading">
          <h2>Transaction history</h2>
          <select
            aria-label="Transaction order"
            value={filters.sort}
            onChange={(event) =>
              updateFilters({ sort: event.target.value as "newest" | "oldest" })
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        {view.transactions.length ? (
          <>
            <div className="txw-mobile-history">
              {[...dateGroups].map(([date, transactions]) => (
                <div className="txw-date-group" key={date}>
                  <h3>
                    {date === "__unavailable__"
                      ? "Date unavailable"
                      : date
                        ? formatDate(date, {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })
                        : "Date not recorded"}
                  </h3>
                  <ul>
                    {transactions.map((transaction) => (
                      <li key={transaction.id}>
                        <button
                          type="button"
                          data-transaction-id={transaction.id}
                          className="txw-mobile-row"
                          onClick={(event) =>
                            openDetails(transaction, event.currentTarget)
                          }
                          aria-label={`View transaction: ${transaction.description}`}
                        >
                          <span
                            className={`txw-transaction-icon txw-icon-${transactionDirection(transaction)}`}
                          >
                            <TransactionIcon transaction={transaction} />
                          </span>
                          <span className="txw-row-description">
                            <strong>
                              {transaction.merchant || transaction.description}
                            </strong>
                            <span>
                              {transaction.category ||
                                kindLabel(transaction.kind)}
                              {transaction.platform
                                ? ` · ${transaction.platform}`
                                : ""}
                            </span>
                            {transactionDirection(transaction) ===
                              "between_accounts" && (
                              <span>
                                {transactionAccount(transaction, accounts)}
                              </span>
                            )}
                            {transaction.status !== "posted" && (
                              <small
                                className={`txw-status txw-status-${transaction.status}`}
                              >
                                {statusLabel(transaction)}
                              </small>
                            )}
                          </span>
                          <SignedAmount transaction={transaction} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="txw-desktop-history">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Platform</th>
                    <th>Account / source</th>
                    <th className="txw-right">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {view.transactions.map((transaction) => (
                    <tr
                      key={transaction.id}
                      data-transaction-id={transaction.id}
                    >
                      <td>{recordedDateLabel(transaction.occurredOn)}</td>
                      <td>
                        <button
                          type="button"
                          className="txw-desktop-description"
                          aria-label={`View transaction: ${transaction.description}`}
                          onClick={(event) =>
                            openDetails(transaction, event.currentTarget)
                          }
                        >
                          <span
                            className={`txw-transaction-icon txw-icon-${transactionDirection(transaction)}`}
                          >
                            <TransactionIcon transaction={transaction} />
                          </span>
                          <span>
                            <strong>
                              {transaction.merchant || transaction.description}
                            </strong>
                            <small>{kindLabel(transaction.kind)}</small>
                          </span>
                        </button>
                      </td>
                      <td>{transaction.category || "Uncategorized"}</td>
                      <td>{transaction.platform || "—"}</td>
                      <td>{transactionAccount(transaction, accounts)}</td>
                      <td className="txw-right">
                        <SignedAmount transaction={transaction} />
                      </td>
                      <td>
                        <span
                          className={`txw-status txw-status-${transaction.status}`}
                        >
                          {statusLabel(transaction)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="txw-empty">
            <Search size={25} aria-hidden="true" />
            <h3>No matching transactions</h3>
            <p>Try another category, platform, or search.</p>
            <button type="button" className="button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      <footer className="txw-secondary-actions">
        <Link href="/imports">
          Import transactions <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={() => {
            downloadFile(
              exportTransactionsCsv(view.transactions, [...accounts.values()]),
              `transactions-${filters.period === "all" ? "all-dates" : filters.period === "date" ? filters.date : filters.month}.csv`,
            );
            toast("Filtered transactions exported.");
          }}
        >
          <Download size={14} aria-hidden="true" />
          Export CSV
        </button>
      </footer>

      <Dialog.Root
        open={Boolean(selectedTransaction)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="txw-dialog-overlay" />
          <Dialog.Content
            className="txw-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (detailTrigger.current?.isConnected)
                detailTrigger.current.focus();
            }}
          >
            {selectedTransaction && (
              <TransactionDetails
                transaction={selectedTransaction}
                accounts={accounts}
                sourceIds={transactionSourceIds[selectedTransaction.id] || []}
                onEdit={onEdit}
                onClose={() => setSelectedId(null)}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
