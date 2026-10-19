"use client";

import Link from "next/link";
import { ArrowUpRight, Landmark } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  accountDetailView,
  type AccountDetailView,
} from "@/lib/account-detail-view";
import { resolveSelectedAccountId } from "@/lib/account-presentation";
import {
  compareMoney,
  formatDate,
  formatMoney,
  monthLabel,
} from "@/lib/finance";
import type { WorkspaceData } from "@/lib/types";
import { formatUsagePercentage, UsageMeter } from "./account-summary";
import { CreditAvailability } from "./credit-availability";
import { FinancialCardCarousel } from "./financial-card-carousel";
import { RecentAccountTransactions } from "./recent-account-transactions";
import { VirtualAccountCard } from "./virtual-account-card";
import "./financial-account-details.css";

type AccountKind = "bank" | "credit_card" | "pay_later";

const accountLabels: Record<AccountKind, string> = {
  bank: "Bank account",
  credit_card: "Credit card",
  pay_later: "Pay Later",
};

const money = (value: string | null | undefined, missing = "Not available") =>
  value == null ? missing : formatMoney(value);

const date = (value: string | null | undefined) =>
  value ? formatDate(value, { year: "numeric" }) : "Not recorded";

function Value({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div className="fac-value">
      <dt>{label}</dt>
      <dd>
        {children}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

function BankSummary({
  view,
  month,
}: {
  view: AccountDetailView;
  month: string;
}) {
  const balance = view.balance;
  const provenance =
    balance.currentSource === "opening"
      ? "Calculated from opening balance"
      : balance.currentSource === "snapshot"
        ? balance.movementsSinceSnapshot > 0
          ? "Report + posted movements"
          : "Reported balance"
        : "Balance not reported";
  return (
    <>
      <div className="fac-primary-balance">
        <span>Current balance</span>
        <strong>{money(balance.current)}</strong>
        <small>
          {provenance}
          {balance.currentAsOf ? ` · ${date(balance.currentAsOf)}` : ""}
        </small>
      </div>
      <dl className="fac-summary-grid">
        <Value label="Recorded credits" note={monthLabel(month)}>
          {money(view.monthly.credits)}
        </Value>
        <Value label="Recorded debits" note={monthLabel(month)}>
          {money(view.monthly.debits)}
        </Value>
        <Value label="Reported balance">
          {money(view.snapshot?.reportedBalance, "Not reported")}
        </Value>
        <Value label="Reporting baseline">
          {date(balance.currentBaselineAsOf)}
        </Value>
      </dl>
      <p className="fac-note">
        {view.monthly.count} posted movement
        {view.monthly.count === 1 ? "" : "s"} recorded in {monthLabel(month)}.
        Credits and debits include account transfers. Current balance is
        separate from the selected month’s activity.
      </p>
    </>
  );
}

function DebtSummary({ view }: { view: AccountDetailView }) {
  const usage = view.usage!;
  const creditCard = view.account.kind === "credit_card";
  const partial = usage.provenance === "partial";
  const verification = {
    verified: "Verified report",
    estimated:
      view.balance.currentSource === "opening"
        ? "Calculated from opening balance · Estimated"
        : view.balance.movementsSinceSnapshot > 0
          ? "Report + posted movements · Estimated"
          : "Reported balance · Estimated",
    partial: "Partial exposure · Unverified",
    unconfirmed: "Unconfirmed",
  }[usage.balanceVerificationStatus];
  const nextDue = view.dues.nextDueDate
    ? date(view.dues.nextDueDate)
    : view.dues.hasUnknownDate
      ? "Date not recorded"
      : view.dues.amount !== null && view.dues.unpaidCount === 0
        ? "No unpaid statements"
        : "Not recorded";
  return (
    <>
      <CreditAvailability usage={usage} />
      <div className="fac-debt-balances">
        <div className="fac-primary-balance">
          <span>Current outstanding</span>
          <strong>{money(usage.currentOutstanding)}</strong>
          <small>{verification}</small>
        </div>
        <div className="fac-primary-balance">
          <span>{partial ? "Minimum known outstanding" : "Credit used"}</span>
          <strong>
            {usage.used === null
              ? "Not available"
              : `${partial ? "At least " : ""}${money(usage.used)}`}
          </strong>
          <small>
            {partial
              ? "Known unpaid bills only"
              : usage.provenance === "reported"
                ? "Reported usage"
                : usage.provenance === "inferred"
                  ? "Inferred from available credit"
                  : usage.provenance === "calculated"
                    ? "Calculated usage"
                    : "Usage not reported"}
          </small>
        </div>
      </div>
      <dl className="fac-summary-grid">
        <Value label={creditCard ? "Credit limit" : "Approved limit"}>
          {money(usage.totalCreditLimit, "Not set")}
        </Value>
        {view.dues.amount !== null && (
          <Value label="Recorded amount due" note="Recorded statement balances">
            {money(view.dues.amount)}
          </Value>
        )}
        <Value
          label="Next payment due"
          note={
            view.dues.hasUnknownDate
              ? "Some unpaid statements have no due date"
              : undefined
          }
        >
          {nextDue}
        </Value>
        {creditCard && (
          <Value label="Reported outstanding">
            {money(usage.issuerReportedOutstanding, "Not reported")}
          </Value>
        )}
        {creditCard && (
          <Value label="Next bill generation">
            {date(
              usage.statementGenerationDate || view.snapshot?.nextStatementDate,
            )}
          </Value>
        )}
        <Value label="Last updated">
          {date(usage.asOf || usage.baselineAsOf)}
        </Value>
        <Value label="Utilization">
          {formatUsagePercentage(partial ? null : usage.creditUtilization)}
        </Value>
      </dl>
      {usage.creditUtilization !== null && !partial && (
        <div className="fac-utilization">
          <UsageMeter {...usage} label={`${view.account.name} utilization`} />
        </div>
      )}
      {creditCard && (
        <dl className="fac-breakdown">
          <Value label="Unbilled purchases">
            {money(usage.unbilledAmount, "Unknown")}
          </Value>
          <Value label="Confirmed repayments">
            {money(usage.confirmedRepayments)}
          </Value>
          <Value label="Confirmed refunds">
            {money(usage.confirmedRefunds)}
          </Value>
          <Value label="Pending holds">
            {money(usage.pendingAuthorizations, "Unknown")}
          </Value>
        </dl>
      )}
      <p className="fac-note">
        Usage and outstanding can differ. Recorded statement dues are separate
        from the facility’s credit limit.
        {creditCard && " Pending review is not evidence of an issuer hold."}
      </p>
    </>
  );
}

export function FinancialAccountDetails({
  data,
  userId,
  month,
  today,
  kind,
  onClose,
}: {
  data: WorkspaceData;
  userId: string;
  month: string;
  today: string;
  kind: AccountKind;
  onClose: () => void;
}) {
  const accounts = data.accounts.filter(
    (account) =>
      account.userId === userId && account.active && account.kind === kind,
  );
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const selectedId = resolveSelectedAccountId(accounts, requestedId);
  const account = accounts.find((item) => item.id === selectedId);
  if (!account)
    return (
      <div className="fac-details fac-empty" data-kind={kind}>
        <Landmark size={30} aria-hidden="true" />
        <h3>
          No active{" "}
          {kind === "bank"
            ? "bank accounts"
            : kind === "credit_card"
              ? "credit cards"
              : "Pay Later accounts"}
        </h3>
        <p>Add an account to see its balance and recorded activity.</p>
      </div>
    );

  const view = accountDetailView(data, account, month, today);
  const deposit =
    kind === "credit_card"
      ? data.fixedDeposits.find(
          (item) =>
            item.userId === userId && item.backingAccountId === account.id,
        )
      : undefined;
  return (
    <div
      className="fac-details"
      data-kind={kind}
      data-selected-account={account.id}
    >
      <FinancialCardCarousel
        accounts={accounts}
        selectedId={selectedId}
        onSelect={setRequestedId}
        label={
          kind === "bank"
            ? "Bank accounts"
            : kind === "credit_card"
              ? "Credit cards"
              : "Pay Later providers"
        }
        renderCard={(card) => (
          <VirtualAccountCard
            account={card}
            data={data}
            today={today}
            onNavigate={onClose}
            showFinancialFacts={false}
          />
        )}
      />
      <section className="fac-summary" aria-label={`${account.name} summary`}>
        <div className="fac-section-heading">
          <div>
            <h3>Account summary</h3>
            <p>
              {account.name} ·{" "}
              {account.institution || "Institution not recorded"}
            </p>
          </div>
          <span className="fac-type-label">{accountLabels[kind]}</span>
        </div>
        {deposit && (
          <p className="fac-deposit-label">
            {deposit.pledged === true ? "FD backed" : "Fixed deposit linked"} ·{" "}
            {deposit.name}
            {deposit.pledged === null ? " · Pledge status unknown" : ""}
          </p>
        )}
        {kind === "bank" ? (
          <BankSummary view={view} month={month} />
        ) : (
          <DebtSummary view={view} />
        )}
        <Link
          href={`/accounts/${encodeURIComponent(account.id)}`}
          className="fac-link fac-manage-link"
          onClick={onClose}
        >
          Manage account <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </section>
      <RecentAccountTransactions
        data={data}
        accountId={account.id}
        limit={5}
        asOf={today}
        onNavigate={onClose}
      />
      {kind === "credit_card" && view.statements.length > 0 && (
        <section
          className="fac-statements"
          aria-label={`${account.name} statements`}
        >
          <div className="fac-section-heading">
            <div>
              <h3>Latest statements</h3>
              <p>Statement balances remain separate from account usage.</p>
            </div>
          </div>
          <ul className="fac-statement-list">
            {view.statements.slice(0, 3).map(({ bill, summary }) => (
              <li key={bill.id}>
                <div>
                  <strong>Statement · {date(bill.statementDate)}</strong>
                  <p>
                    Due {date(bill.dueDate)} ·{" "}
                    {summary.status === "paid"
                      ? "Paid"
                      : summary.status === "unknown"
                        ? "Due date unknown"
                        : summary.status === "partial"
                          ? "Partially paid"
                          : summary.status === "overdue"
                            ? "Overdue"
                            : "Unpaid"}
                  </p>
                  <span>
                    {money(summary.remaining)} remaining of{" "}
                    {money(summary.statement)}
                  </span>
                  {compareMoney(summary.provisional, "0") > 0 && (
                    <p>
                      {money(summary.provisional)} in provisional payments
                      awaits verification.
                    </p>
                  )}
                </div>
                <Link
                  href={`/bills/${encodeURIComponent(bill.id)}`}
                  onClick={onClose}
                  className="fac-link"
                  aria-label={`View statement dated ${date(bill.statementDate)}`}
                >
                  View statement <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
