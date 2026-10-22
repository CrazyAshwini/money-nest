"use client";

import type { ReactNode } from "react";
import type { AccountDetailView } from "@/lib/account-detail-view";
import { formatDate, formatMoney } from "@/lib/finance";
import "./account-statement-details.css";

const money = (value: string | null | undefined, missing = "Not available") =>
  value == null ? missing : formatMoney(value);

const date = (value: string | null | undefined) =>
  value ? formatDate(value, { year: "numeric" }) : "Not recorded";

function StatementValue({
  field,
  label,
  children,
  note,
}: {
  field: string;
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div data-field={field}>
      <dt>{label}</dt>
      <dd>
        {children}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

/** Supporting account-page details; primary debt values stay on the card. */
export function AccountStatementDetails({ view }: { view: AccountDetailView }) {
  const usage = view.usage;
  if (!usage) return null;
  const creditCard = view.account.kind === "credit_card";
  const nextDue = view.dues.nextDueDate
    ? date(view.dues.nextDueDate)
    : view.dues.hasUnknownDate
      ? "Date not recorded"
      : view.dues.amount !== null && view.dues.unpaidCount === 0
        ? "No unpaid statements"
        : "Not recorded";
  const verification = {
    verified: "Verified outstanding report",
    estimated:
      view.balance.currentSource === "opening"
        ? "Outstanding calculated from opening balance · Estimated"
        : view.balance.movementsSinceSnapshot > 0
          ? "Outstanding report + posted movements · Estimated"
          : "Reported outstanding · Estimated",
    partial: "Partial exposure · Unverified",
    unconfirmed: "Outstanding unconfirmed",
  }[usage.balanceVerificationStatus];

  return (
    <section
      className="account-statement-details"
      aria-label={`${view.account.name} statement and report details`}
    >
      <h2>Statements and reports</h2>
      <dl className="account-statement-details-grid">
        <StatementValue
          field="recorded-amount-due"
          label="Recorded amount due"
          note="Recorded statement balances"
        >
          {money(view.dues.amount)}
        </StatementValue>
        <StatementValue
          field="next-payment-due"
          label="Next payment due"
          note={
            view.dues.hasUnknownDate
              ? "Some unpaid statements have no due date"
              : undefined
          }
        >
          {nextDue}
        </StatementValue>
        {(creditCard || usage.statementGenerationDate) && (
          <StatementValue
            field="next-bill-generation"
            label="Next bill generation"
          >
            {date(
              usage.statementGenerationDate || view.snapshot?.nextStatementDate,
            )}
          </StatementValue>
        )}
        <StatementValue field="last-updated" label="Last updated">
          {date(usage.asOf || usage.baselineAsOf)}
        </StatementValue>
        {creditCard && (
          <>
            <StatementValue
              field="unbilled-purchases"
              label="Unbilled purchases"
            >
              {money(usage.unbilledAmount, "Unknown")}
            </StatementValue>
            <StatementValue
              field="confirmed-repayments"
              label="Confirmed repayments"
            >
              {money(usage.confirmedRepayments)}
            </StatementValue>
            <StatementValue field="confirmed-refunds" label="Confirmed refunds">
              {money(usage.confirmedRefunds)}
            </StatementValue>
            <StatementValue field="pending-holds" label="Pending holds">
              {money(usage.pendingAuthorizations, "Unknown")}
            </StatementValue>
          </>
        )}
      </dl>
      {usage.financedPrincipal && (
        <div className="account-emi-section" style={{ marginTop: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Active EMI agreements</h3>
          <dl className="account-statement-details-grid">
            <StatementValue field="financed-principal" label="Financed principal" note="Original financed amount">
              {money(usage.financedPrincipal)}
            </StatementValue>
            <StatementValue field="unbilled-interest" label="Unbilled future interest" note="Does not consume limit upfront">
              {money(usage.unbilledFutureInterest)}
            </StatementValue>
            <StatementValue field="processing-fees" label="Processing fees" note="One-time fee">
              {money(usage.processingFees)}
            </StatementValue>
            <StatementValue field="total-scheduled" label="Total scheduled repayments">
              {money(usage.totalScheduledRepayments)}
            </StatementValue>
          </dl>
          <p className="account-statement-details-note" style={{ marginTop: "0.5rem" }}>
            Remaining financed principal consumes available limit. Future interest is recognized as billed.
          </p>
        </div>
      )}
      <p className="account-statement-details-note" style={{ marginTop: "1rem" }}>
        {verification}. Usage and outstanding can differ. Recorded statement
        dues are separate from the facility’s credit limit.
        {creditCard && " Pending review is not evidence of an issuer hold."}
      </p>
    </section>
  );
}
