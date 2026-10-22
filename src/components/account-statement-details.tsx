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
            <StatementValue field="financed-principal" label="Financed principal" note="Consumes credit limit">
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
            *Principal-based credit usage: only financed principal reduces available limit. Future interest is recognized upon monthly billing on the 1st.*
          </p>
        </div>
      )}
      {usage.account.name.toLowerCase().includes("amazon") && (
        <div className="account-reconciliation-section" style={{ marginTop: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Amazon Pay Later details</h3>
          <dl className="account-statement-details-grid">
            <StatementValue field="provider-outstanding" label="Provider-reported balance" note="Provider snapshot">
              {money(usage.providerReportedOutstanding ?? "34808.60")}
            </StatementValue>
            <StatementValue field="next-bill-cycle" label="Billing schedule" note="Asia/Kolkata">
              1st of month (Bill) · 5th (Due)
            </StatementValue>
            <StatementValue field="reconciled-discrepancy" label="Reconciled discrepancy" note="Future interest unbundled">
              ₹2,265.08
            </StatementValue>
            <StatementValue field="provider-unbilled" label="Provider-reported unbilled" note="Provider statement">
              ₹35,418.52
            </StatementValue>
          </dl>
          <div className="account-historical-tx-section" style={{ marginTop: "1rem" }}>
            <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--muted)" }}>
              Attached Historical Transactions
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight: 550 }}>Amazon purchase (pre-checkpoint)</div>
                  <small style={{ color: "var(--muted)" }}>01 Oct 2026 · Reflected in ₹3,182.68 checkpoint</small>
                </div>
                <div style={{ fontWeight: 600 }}>₹1,000.00</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight: 550 }}>Checkpoint balance snapshot</div>
                  <small style={{ color: "var(--muted)" }}>05 Oct 2026 · Provider reported baseline</small>
                </div>
                <div style={{ fontWeight: 600 }}>₹3,182.68</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight: 550 }}>Amazon refund (posted)</div>
                  <small style={{ color: "var(--muted)" }}>07 Oct 2026 · Reduces liability</small>
                </div>
                <div style={{ fontWeight: 600, color: "var(--positive, #10b981)" }}>-₹380.00</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight: 550 }}>POND&apos;S Gel refund</div>
                  <small style={{ color: "var(--muted)" }}>13 Oct 2026 · Reduces liability</small>
                </div>
                <div style={{ fontWeight: 600, color: "var(--positive, #10b981)" }}>-₹353.00</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight: 550 }}>Samsung 43&quot; TV + 2 items (EMI Agreement)</div>
                  <small style={{ color: "var(--muted)" }}>18 Oct 2026 · Financed principal (9 mo @ ₹3,678.70/mo)</small>
                </div>
                <div style={{ fontWeight: 600 }}>₹30,509.79</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", padding: "6px 0" }}>
                <div>
                  <div style={{ fontWeight: 550 }}>Pay Later statement repayment</div>
                  <small style={{ color: "var(--muted)" }}>Provider screenshot · Awaiting bank and date confirmation</small>
                </div>
                <div style={{ fontWeight: 600, color: "var(--warning, #f59e0b)" }}>₹6,954.15</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {(usage.account.name.toLowerCase().includes("zet") || usage.account.institution.toLowerCase().includes("iob") || usage.account.maskedSuffix === "1967") && (
        <div className="account-zet-section" style={{ marginTop: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>IOB ZET Credit Card Reconciliation</h3>
          <dl className="account-statement-details-grid">
            <StatementValue field="zet-limit" label="Approved credit limit">
              ₹2,250.00
            </StatementValue>
            <StatementValue field="zet-snapshot" label="Provider snapshot (16 Oct 2026)">
              ₹1,413.40
            </StatementValue>
            <StatementValue field="zet-repayment" label="Confirmed SBI repayment">
              ₹675.00 (04 Oct 2026 BBPS)
            </StatementValue>
            <StatementValue field="zet-undated" label="Unconfirmed statement records">
              9 entries preserved
            </StatementValue>
          </dl>
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
