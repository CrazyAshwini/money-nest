"use client";

import type { ReactNode } from "react";
import Link from "next/link";
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
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Active EMI agreements
          </h3>
          {usage.activeAgreements && usage.activeAgreements.length > 0 && (
            <div
              className="account-emi-agreements-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                marginBottom: "1rem",
              }}
            >
              {usage.activeAgreements.map((agreement) => (
                <div
                  key={agreement.id}
                  className="account-emi-agreement-card"
                  style={{
                    padding: "0.85rem",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--background)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "0.95rem", display: "block" }}>
                        {agreement.description}
                      </strong>
                      {agreement.orderIds && agreement.orderIds.length > 0 && (
                        <small
                          style={{
                            color: "var(--muted)",
                            display: "block",
                            marginTop: "3px",
                          }}
                        >
                          Orders: {agreement.orderIds.join(", ")}
                        </small>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                        backgroundColor: "var(--accent-subtle, rgba(16, 185, 129, 0.1))",
                        color: "var(--accent, #059669)",
                        fontWeight: 600,
                        textTransform: "uppercase",
                      }}
                    >
                      {agreement.status}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: "0.5rem 1rem",
                      marginTop: "0.75rem",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          color: "var(--muted)",
                          display: "block",
                          fontSize: "0.75rem",
                        }}
                      >
                        Financed Principal
                      </span>
                      <strong>{money(agreement.financedPrincipal)}</strong>
                    </div>
                    <div>
                      <span
                        style={{
                          color: "var(--muted)",
                          display: "block",
                          fontSize: "0.75rem",
                        }}
                      >
                        Monthly Installment
                      </span>
                      <strong>
                        {money(agreement.monthlyPayment)}/mo ({agreement.emiCount} mos)
                      </strong>
                    </div>
                    <div>
                      <span
                        style={{
                          color: "var(--muted)",
                          display: "block",
                          fontSize: "0.75rem",
                        }}
                      >
                        Total Repayment
                      </span>
                      <strong>{money(agreement.totalScheduledRepayment)}</strong>
                    </div>
                    <div>
                      <span
                        style={{
                          color: "var(--muted)",
                          display: "block",
                          fontSize: "0.75rem",
                        }}
                      >
                        First Due Date
                      </span>
                      <strong>
                        {agreement.firstDueDate ? date(agreement.firstDueDate) : "5th of month"}
                      </strong>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: "0.75rem",
                      paddingTop: "0.5rem",
                      borderTop: "1px solid var(--border)",
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <Link
                      href="/loans"
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        color: "var(--primary, #2563eb)",
                        textDecoration: "none",
                      }}
                    >
                      View repayment schedule in Loans & EMIs →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          <dl className="account-statement-details-grid">
            <StatementValue
              field="financed-principal"
              label="Financed principal"
              note="Original financed amount"
            >
              {money(usage.financedPrincipal)}
            </StatementValue>
            <StatementValue
              field="unbilled-interest"
              label="Unbilled future interest"
              note="Does not consume limit upfront"
            >
              {money(usage.unbilledFutureInterest)}
            </StatementValue>
            <StatementValue
              field="processing-fees"
              label="Processing fees"
              note="One-time fee"
            >
              {money(usage.processingFees)}
            </StatementValue>
            <StatementValue
              field="total-scheduled"
              label="Total scheduled repayments"
            >
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
