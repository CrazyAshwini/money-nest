"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import {
  formatDate,
  formatMoney,
  monthlySummary,
  monthLabel,
  spendingByCategory,
} from "@/lib/finance";
import type { Transaction, WorkspaceData } from "@/lib/types";
import { useFinance } from "./finance-provider";
import { FinancialAccountDetails } from "./financial-account-details";
import "./dashboard-details.css";

export type DashboardFinancialSection =
  "bank" | "spending" | "credit" | "paylater";

const titles: Record<DashboardFinancialSection, string> = {
  bank: "Bank balance details",
  spending: "Spending details",
  credit: "Credit card details",
  paylater: "Pay Later details",
};

const date = (value: string | null | undefined) =>
  value ? formatDate(value, { year: "numeric" }) : "Not available";

function DetailValue({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DetailLink({
  href,
  children,
  onClose,
}: {
  href: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Link href={href} onClick={onClose} className="financial-details-link">
      {children} <ArrowUpRight size={15} aria-hidden="true" />
    </Link>
  );
}

function EmptyDetails({ children }: { children: ReactNode }) {
  return <p className="financial-details-empty">{children}</p>;
}

function TransactionDetails({
  transactions,
  data,
}: {
  transactions: Transaction[];
  data: WorkspaceData;
}) {
  const accounts = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  return (
    <ul className="financial-details-transactions">
      {transactions.map((transaction) => {
        const source = transaction.fromAccountId
          ? accounts.get(transaction.fromAccountId)
          : null;
        const destination = transaction.toAccountId
          ? accounts.get(transaction.toAccountId)
          : null;
        return (
          <li key={transaction.id}>
            <div className="financial-details-transaction-heading">
              <strong>
                {transaction.merchant ||
                  transaction.description ||
                  "Description not available"}
              </strong>
              <b>{formatMoney(transaction.amount)}</b>
            </div>
            {transaction.merchant &&
              transaction.description !== transaction.merchant && (
                <p>{transaction.description}</p>
              )}
            <p>
              {date(transaction.occurredOn)} ·{" "}
              {transaction.kind === "bill_payment"
                ? "Repayment"
                : transaction.category || "Other"}
            </p>
            <div className="financial-details-transaction-meta">
              <span>
                {source?.name || "Source account not available"}
                {destination ? ` → ${destination.name}` : ""}
              </span>
              <span className="financial-details-status" data-status="paid">
                Posted
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SpendingDetails({
  data,
  month,
}: {
  data: WorkspaceData;
  month: string;
}) {
  const summary = monthlySummary(data, month);
  const categories = spendingByCategory(data, month);
  const expenses = data.transactions
    .filter(
      (transaction) =>
        transaction.status === "posted" &&
        transaction.kind === "expense" &&
        transaction.occurredOn?.startsWith(`${month}-`),
    )
    .sort(
      (a, b) =>
        (b.occurredOn || "").localeCompare(a.occurredOn || "") ||
        a.id.localeCompare(b.id),
    );
  return (
    <>
      <div className="financial-details-total">
        <span>Posted spending · {monthLabel(month)}</span>
        <strong>{formatMoney(summary.gross)}</strong>
        <p>
          {summary.expenseCount} posted expense
          {summary.expenseCount === 1 ? "" : "s"}
        </p>
      </div>
      <p className="financial-details-note">
        Transfers, bill repayments, pending records and voided records are
        excluded. Matched refunds are shown separately in the month they were
        received.
      </p>
      <dl className="financial-details-values financial-details-refunds">
        <DetailValue label="Matched refunds this period">
          {formatMoney(summary.refunds)}
        </DetailValue>
        <DetailValue label="Net after matched refunds">
          {formatMoney(summary.net)}
        </DetailValue>
      </dl>
      <section className="financial-details-section">
        <h3>By category</h3>
        {categories.length ? (
          <ul className="financial-details-categories">
            {categories.map((category) => (
              <li key={category.category}>
                <div>
                  <span>{category.category}</span>
                  <strong>{formatMoney(category.amount)}</strong>
                </div>
                <div
                  className="financial-details-category-track"
                  aria-hidden="true"
                >
                  <span
                    style={{
                      width: `${Math.min(100, Math.max(0, category.percentage))}%`,
                    }}
                  />
                </div>
                <small>
                  {category.count} expense{category.count === 1 ? "" : "s"} ·{" "}
                  {category.percentage.toFixed(1)}%
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyDetails>
            No posted expenses are recorded for {monthLabel(month)}.
          </EmptyDetails>
        )}
      </section>
      {expenses.length > 0 && (
        <section className="financial-details-section">
          <h3>Posted expenses</h3>
          <TransactionDetails data={data} transactions={expenses} />
        </section>
      )}
    </>
  );
}

export function DashboardFinancialDetails({
  section,
  onClose,
  trigger,
}: {
  section: DashboardFinancialSection;
  onClose: () => void;
  trigger: HTMLElement | null;
}) {
  const { data, month, today, mode, userId } = useFinance();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const available = mode === "cloud" || mode === "private" || mode === "demo";
  const href =
    section === "spending"
      ? "/transactions?kind=expense"
      : section === "paylater"
        ? "/pay-later"
        : "/accounts";
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="financial-details-overlay" />
        <Dialog.Content
          className="financial-details-dialog"
          data-section={section}
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger?.isConnected) trigger.focus({ preventScroll: true });
          }}
        >
          <div className="financial-details-handle" aria-hidden="true" />
          <header className="financial-details-heading">
            <div>
              <Dialog.Title ref={titleRef} tabIndex={-1}>
                {titles[section]}
              </Dialog.Title>
              <Dialog.Description>
                {section === "spending"
                  ? `${monthLabel(month)} · Posted transaction records`
                  : `Your saved financial records · As of ${date(today)}`}
              </Dialog.Description>
            </div>
            <Dialog.Close
              type="button"
              className="financial-details-close"
              aria-label="Close financial details"
            >
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div className="financial-details-body">
            {!available ? (
              <p
                className="financial-details-empty"
                role={mode === "loading" ? "status" : "alert"}
              >
                {mode === "loading"
                  ? "Loading financial details…"
                  : mode === "login"
                    ? "Sign in to view your financial details."
                    : "Financial details could not be loaded. Return to the workspace and try again."}
              </p>
            ) : section === "spending" ? (
              <SpendingDetails data={data} month={month} />
            ) : (
              <FinancialAccountDetails
                data={data}
                userId={userId}
                month={month}
                today={today}
                kind={
                  section === "bank"
                    ? "bank"
                    : section === "credit"
                      ? "credit_card"
                      : "pay_later"
                }
                onClose={onClose}
              />
            )}
          </div>
          <footer className="financial-details-footer">
            {available && (
              <DetailLink href={href} onClose={onClose}>
                {section === "spending"
                  ? "View all transactions"
                  : section === "paylater"
                    ? "Manage Pay Later"
                    : "Manage accounts"}
              </DetailLink>
            )}
            {mode === "login" && (
              <DetailLink href="/login" onClose={onClose}>
                Sign in
              </DetailLink>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
