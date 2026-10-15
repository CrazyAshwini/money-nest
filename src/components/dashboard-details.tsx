"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import {
  accountBalance,
  billSummary,
  compareMoney,
  dashboardMetrics,
  formatDate,
  formatMoney,
  latestSnapshot,
  monthlySummary,
  monthLabel,
  spendingByCategory,
  sumMoney,
} from "@/lib/finance";
import type { Account, Bill, Transaction, WorkspaceData } from "@/lib/types";
import { usageSummary, type AccountUsage } from "@/lib/usage";
import { formatUsagePercentage, UsageMeter } from "./account-summary";
import { useFinance } from "./finance-provider";
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

function AccountIdentity({ account }: { account: Account }) {
  // The model stores a suffix, but never display more than the last four characters.
  const suffix = account.maskedSuffix?.trim().slice(-4);
  return (
    <div className="financial-details-identity">
      <h3>{account.name}</h3>
      <p>
        {account.institution || "Institution not available"}
        {suffix ? ` · ••${suffix}` : " · Identifier not available"}
      </p>
    </div>
  );
}

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

function BankDetails({
  data,
  month,
  today,
  onClose,
}: {
  data: WorkspaceData;
  month: string;
  today: string;
  onClose: () => void;
}) {
  const metrics = dashboardMetrics(data, month, today);
  const accounts = data.accounts.filter(
    (account) => account.active && account.kind === "bank",
  );
  const partial = metrics.knownBankCount < metrics.totalBankCount;
  return (
    <>
      <div className="financial-details-total">
        <span>{partial ? "Known bank balance" : "Total bank balance"}</span>
        <strong>
          {metrics.knownBankCount
            ? formatMoney(metrics.bankBalance)
            : "Not reported"}
        </strong>
        <p>
          {metrics.knownBankCount} of {metrics.totalBankCount} active bank
          accounts have a known balance.
          {partial && " The total excludes unreported accounts."}
        </p>
      </div>
      <p className="financial-details-note">
        Current reported or calculated balances, using records through{" "}
        {date(today)}. This is not a month-end balance for {monthLabel(month)}.
        Wallets, credit limits, Pay Later limits and fixed deposits are
        excluded.
      </p>
      <div
        className="financial-details-records"
        aria-label="Bank balances by account"
      >
        {accounts.map((account) => {
          const balance = accountBalance(data, account.id, today);
          const calculated =
            balance.currentSource === "opening" ||
            balance.movementsSinceSnapshot > 0;
          return (
            <article className="financial-details-record" key={account.id}>
              <div className="financial-details-record-heading">
                <AccountIdentity account={account} />
                <strong>
                  {balance.current === null
                    ? "Not reported"
                    : formatMoney(balance.current)}
                </strong>
              </div>
              <dl className="financial-details-values">
                <DetailValue
                  label={calculated ? "Calculated as of" : "Reported as of"}
                >
                  {date(balance.currentAsOf)}
                </DetailValue>
                <DetailValue
                  label={
                    balance.currentSource === "opening"
                      ? "Opening balance date"
                      : "Reporting baseline"
                  }
                >
                  {date(balance.currentBaselineAsOf)}
                </DetailValue>
              </dl>
              <p className="financial-details-note">
                {balance.current === null
                  ? "Add a reported balance or a known opening balance to calculate this account."
                  : balance.currentSource === "opening"
                    ? "Calculated from the opening balance and dated posted movements."
                    : balance.movementsSinceSnapshot > 0
                      ? `Includes ${balance.movementsSinceSnapshot} posted movement${balance.movementsSinceSnapshot === 1 ? "" : "s"} after the reporting baseline.`
                      : "Last available balance report; no live bank synchronization."}
              </p>
              <DetailLink href={`/accounts/${account.id}`} onClose={onClose}>
                View account
              </DetailLink>
            </article>
          );
        })}
        {!accounts.length && (
          <EmptyDetails>
            No active bank accounts are recorded. Add an account to track its
            balance.
          </EmptyDetails>
        )}
      </div>
    </>
  );
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

function usageSource(row: AccountUsage) {
  return row.provenance === "partial"
    ? "Known unpaid bills only"
    : row.provenance === "inferred"
      ? "Inferred from reported available credit"
      : row.provenance === "reported"
        ? "Reported usage"
        : row.provenance === "calculated"
          ? "Report plus posted payments"
          : "Usage not reported";
}

function availableCredit(row: AccountUsage) {
  return row.available;
}

function dueStatus(data: WorkspaceData, bill: Bill, today: string) {
  const summary = billSummary(data, bill, today);
  const label =
    summary.status === "paid"
      ? "Paid"
      : summary.status === "overdue"
        ? "Overdue"
        : summary.status === "unknown"
          ? "Due date unknown"
          : summary.status === "partial"
            ? "Partially paid"
            : bill.dueDate === today
              ? "Due today"
              : "Upcoming";
  return { ...summary, label };
}

function DebtDetails({
  data,
  today,
  kind,
  onClose,
}: {
  data: WorkspaceData;
  today: string;
  kind: "credit_card" | "pay_later";
  onClose: () => void;
}) {
  const summary = usageSummary(data, kind, today);
  const accountIds = new Set(summary.rows.map((row) => row.account.id));
  const outstandingRows = summary.rows.map(
    (row) => latestSnapshot(data, row.account.id, today)?.reportedOutstanding,
  );
  const outstandingCount = outstandingRows.filter(
    (value) => value != null,
  ).length;
  const exposureComplete =
    summary.count > 0 &&
    summary.rows.every(
      (row) =>
        row.used !== null &&
        ["reported", "inferred", "calculated"].includes(row.provenance),
    );
  const available = summary.rows.map(availableCredit);
  const availableComplete =
    summary.count > 0 && available.every((value) => value !== null);
  const currentOutstanding = summary.rows.map(
    (row) => accountBalance(data, row.account.id, today).current,
  );
  const knownCurrentOutstanding = currentOutstanding.filter(
    (value) => value !== null,
  );
  const bills = data.bills
    .filter(
      (bill) =>
        accountIds.has(bill.accountId) &&
        bill.statementDate <= today &&
        summary.rows.some(
          (row) =>
            row.account.id === bill.accountId &&
            row.account.userId === bill.userId,
        ),
    )
    .map((bill) => ({ bill, summary: dueStatus(data, bill, today) }))
    .sort(
      (a, b) =>
        Number(a.summary.status === "paid") -
          Number(b.summary.status === "paid") ||
        (a.bill.dueDate || "9999").localeCompare(b.bill.dueDate || "9999") ||
        b.bill.statementDate.localeCompare(a.bill.statementDate),
    );
  const repayments = data.transactions
    .filter(
      (transaction) =>
        transaction.kind === "bill_payment" &&
        transaction.status === "posted" &&
        transaction.occurredOn &&
        transaction.occurredOn <= today &&
        transaction.toAccountId &&
        summary.rows.some(
          (row) =>
            row.account.id === transaction.toAccountId &&
            row.account.userId === transaction.userId,
        ),
    )
    .sort(
      (a, b) =>
        (b.occurredOn || "").localeCompare(a.occurredOn || "") ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 5);
  return (
    <>
      <div className="financial-details-total">
        <span>
          {exposureComplete ? "Total usage" : "Known usage · partial coverage"}
        </span>
        <strong>
          {summary.knownUsageCount
            ? `${!exposureComplete ? "At least " : ""}${formatMoney(summary.usedTotal)}`
            : "Not reported"}
        </strong>
        <p>
          {summary.knownUsageCount} of {summary.count}{" "}
          {kind === "pay_later" ? "providers" : "cards"} have known usage ·
          Records through {date(today)}
        </p>
      </div>
      <dl className="financial-details-values financial-details-aggregate">
        <DetailValue
          label={
            knownCurrentOutstanding.length === summary.count
              ? "Current outstanding"
              : "Known current outstanding"
          }
        >
          {knownCurrentOutstanding.length
            ? formatMoney(sumMoney(knownCurrentOutstanding))
            : "Not available"}
          <small>
            {knownCurrentOutstanding.length}/{summary.count} balances known
          </small>
        </DetailValue>
        <DetailValue
          label={
            outstandingCount === summary.count && summary.count
              ? "Total reported outstanding"
              : "Known reported outstanding"
          }
        >
          {outstandingCount
            ? formatMoney(sumMoney(outstandingRows))
            : "Not reported"}
          <small>
            {outstandingCount}/{summary.count}{" "}
            {kind === "pay_later" ? "providers" : "cards"} reported
          </small>
        </DetailValue>
        <DetailValue
          label={
            summary.knownLimitCount === summary.count && summary.count
              ? "Total credit limit"
              : "Known credit limits"
          }
        >
          {summary.knownLimitCount
            ? formatMoney(summary.limitTotal)
            : "Not set"}
          <small>
            {summary.knownLimitCount}/{summary.count} limits known
          </small>
        </DetailValue>
        <DetailValue label="Available limit from known usage">
          {availableComplete
            ? formatMoney(sumMoney(available))
            : "Not available"}
        </DetailValue>
        <DetailValue label="Overall utilization">
          {formatUsagePercentage(summary.percentage)}
        </DetailValue>
      </dl>
      <p className="financial-details-note">
        Usage and outstanding can differ. Current figures apply posted payments
        to each account’s report or confirmed opening balance. Reported values
        keep their original dates.
        {!exposureComplete &&
          " Missing reports or bill-only exposure prevent an exact total."}
        {!summary.complete &&
          " Overall utilization is unknown until full usage and positive limits are known."}
        {kind === "pay_later" &&
          " Unpaid bills are separate from the facility limit and do not establish all account usage."}
      </p>
      <div
        className="financial-details-records"
        aria-label={
          kind === "pay_later" ? "Pay Later providers" : "Credit cards"
        }
      >
        {summary.rows.map((row) => {
          const snapshot = latestSnapshot(data, row.account.id, today);
          const nextBill = bills.find(
            ({ bill, summary }) =>
              bill.accountId === row.account.id &&
              compareMoney(summary.remaining, "0") > 0,
          );
          const deposit = data.fixedDeposits.find(
            (item) => item.backingAccountId === row.account.id,
          );
          const availableDisplay =
            row.availableCredit !== null
              ? `${formatMoney(row.availableCredit)} (${row.availableCreditStatus === "verified" ? "Verified" : "Estimated"})`
              : row.estimatedAvailableCredit !== null
                ? `Estimated ${formatMoney(row.estimatedAvailableCredit)} (Unverified)`
                : "Unknown";

          const verificationLabel =
            row.balanceVerificationStatus === "verified"
              ? "Verified"
              : row.balanceVerificationStatus === "estimated"
                ? "Report + payments (Estimated)"
                : row.balanceVerificationStatus === "partial"
                  ? "Partial exposure (Unverified bills only)"
                  : "Unconfirmed";

          return (
            <article className="financial-details-record" key={row.account.id}>
              <div className="financial-details-record-heading">
                <AccountIdentity account={row.account} />
                <strong>
                  {row.used === null
                    ? "Usage unknown"
                    : `${row.provenance === "partial" ? "At least " : ""}${formatMoney(row.used)}`}
                </strong>
              </div>
              {deposit && (
                <p className="financial-details-note">
                  {deposit.pledged === true
                    ? "FD backed"
                    : "Fixed deposit linked"}{" "}
                  · {deposit.name}
                  {deposit.pledged === null ? " · Pledge status unknown" : ""}
                </p>
              )}
              <dl className="financial-details-values">
                <DetailValue label="Current outstanding">
                  {row.currentOutstanding == null
                    ? "Not available"
                    : formatMoney(row.currentOutstanding)}
                </DetailValue>
                <DetailValue label="Reported outstanding">
                  {row.issuerReportedOutstanding == null
                    ? "Not reported"
                    : formatMoney(row.issuerReportedOutstanding)}
                </DetailValue>
                <DetailValue label="Credit limit">
                  {row.totalCreditLimit === null
                    ? "Not set"
                    : formatMoney(row.totalCreditLimit)}
                </DetailValue>
                <DetailValue label="Available credit">
                  {availableDisplay}
                </DetailValue>
                <DetailValue label="Utilization">
                  {formatUsagePercentage(row.creditUtilization)}
                </DetailValue>
                <DetailValue label="Amount due">
                  {row.billedAmount !== null
                    ? formatMoney(row.billedAmount)
                    : "Not available"}
                </DetailValue>
                <DetailValue label="Next bill generation date">
                  {date(
                    row.statementGenerationDate || snapshot?.nextStatementDate,
                  )}
                </DetailValue>
                <DetailValue label="Payment due date">
                  {nextBill
                    ? date(nextBill.bill.dueDate)
                    : date(row.paymentDueDate)}
                </DetailValue>
                <DetailValue label="Verification status">
                  {verificationLabel}
                </DetailValue>
                <DetailValue label="Last updated date">
                  {date(row.asOf || row.baselineAsOf)}
                </DetailValue>
                <DetailValue label="Payment status">
                  {nextBill?.summary.label ||
                    (bills.some(({ bill }) => bill.accountId === row.account.id)
                      ? "Recorded statements paid"
                      : "Not available")}
                </DetailValue>
              </dl>

              {/* Transaction details breakdown (Part A6) */}
              <div className="financial-details-breakdown">
                <div>
                  <dt>Unbilled purchases</dt>
                  <dd>
                    {row.unbilledAmount == null
                      ? "Unknown"
                      : formatMoney(row.unbilledAmount)}
                  </dd>
                </div>
                <div>
                  <dt>Confirmed repayments</dt>
                  <dd>{formatMoney(row.confirmedRepayments)}</dd>
                </div>
                <div>
                  <dt>Confirmed refunds</dt>
                  <dd>{formatMoney(row.confirmedRefunds)}</dd>
                </div>
                <div>
                  <dt>Pending holds</dt>
                  <dd>
                    {row.pendingAuthorizations == null
                      ? "Unknown"
                      : formatMoney(row.pendingAuthorizations)}
                  </dd>
                </div>
              </div>

              {/* Utilization progress bar: only render when valid utilization is known */}
              {row.creditUtilization !== null &&
              row.provenance !== "partial" ? (
                <UsageMeter
                  {...row}
                  label={`${row.account.name} utilization`}
                />
              ) : (
                <p className="financial-details-note">
                  Utilization progress bar hidden · Complete outstanding balance
                  not verified
                </p>
              )}

              <p className="financial-details-note">
                {usageSource(row)}
                {row.asOf ? ` · As of ${date(row.asOf)}` : " · Snapshot needed"}
              </p>

              {/* Account actions (Part A6) */}
              <div className="financial-details-actions">
                <DetailLink
                  href={`/transactions?account=${row.account.id}`}
                  onClose={onClose}
                >
                  View transactions
                </DetailLink>
                <DetailLink
                  href={`/bills?account=${row.account.id}`}
                  onClose={onClose}
                >
                  View statement
                </DetailLink>
                <DetailLink
                  href={`/accounts/${row.account.id}?action=repay`}
                  onClose={onClose}
                >
                  Record repayment
                </DetailLink>
                <DetailLink
                  href={`/accounts/${row.account.id}?action=snapshot`}
                  onClose={onClose}
                >
                  Update balance
                </DetailLink>
                <DetailLink
                  href={`/accounts/${row.account.id}`}
                  onClose={onClose}
                >
                  Reconcile account
                </DetailLink>
              </div>
            </article>
          );
        })}
        {!summary.count && (
          <EmptyDetails>
            No active{" "}
            {kind === "pay_later" ? "Pay Later providers" : "credit cards"} are
            recorded.
          </EmptyDetails>
        )}
      </div>
      {summary.count > 0 && (
        <section className="financial-details-section">
          <h3>Statements &amp; payment dues</h3>
          <p className="financial-details-note">
            Statement balances are shown separately from account usage.
          </p>
          {bills.length ? (
            <ul className="financial-details-bills">
              {bills.map(({ bill, summary: billState }) => (
                <li key={bill.id}>
                  <div className="financial-details-transaction-heading">
                    <strong>
                      {data.accounts.find(
                        (account) => account.id === bill.accountId,
                      )?.name || "Account not available"}
                    </strong>
                    <span
                      className="financial-details-status"
                      data-status={billState.status}
                    >
                      {billState.label}
                    </span>
                  </div>
                  <p>
                    Statement {date(bill.statementDate)} ·{" "}
                    {bill.dueDate
                      ? `Due ${date(bill.dueDate)}`
                      : "Due date not available"}
                  </p>
                  <dl className="financial-details-values">
                    <DetailValue label="Statement amount">
                      {formatMoney(billState.statement)}
                    </DetailValue>
                    <DetailValue label="Remaining to pay">
                      {formatMoney(billState.remaining)}
                    </DetailValue>
                  </dl>
                  {compareMoney(billState.provisional, "0") > 0 && (
                    <p className="financial-details-note">
                      {formatMoney(billState.provisional)} in provisional
                      payments awaits verification.
                    </p>
                  )}
                  <DetailLink href={`/bills/${bill.id}`} onClose={onClose}>
                    View bill &amp; payments
                  </DetailLink>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyDetails>
              No statements are recorded. Payment dates and status are not
              available.
            </EmptyDetails>
          )}
        </section>
      )}
      {kind === "pay_later" && summary.count > 0 && (
        <section className="financial-details-section">
          <h3>Recent recorded repayments</h3>
          <p className="financial-details-note">
            Posted bill payments do not add to spending. Payment verification is
            shown on each bill.
          </p>
          {repayments.length ? (
            <TransactionDetails data={data} transactions={repayments} />
          ) : (
            <EmptyDetails>
              No posted repayments to these providers are recorded.
            </EmptyDetails>
          )}
          <DetailLink href="/bills" onClose={onClose}>
            View bills &amp; payment history
          </DetailLink>
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
  const { data, month, today, mode } = useFinance();
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
            ) : section === "bank" ? (
              <BankDetails
                data={data}
                month={month}
                today={today}
                onClose={onClose}
              />
            ) : section === "spending" ? (
              <SpendingDetails data={data} month={month} />
            ) : (
              <DebtDetails
                data={data}
                today={today}
                kind={section === "credit" ? "credit_card" : "pay_later"}
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
