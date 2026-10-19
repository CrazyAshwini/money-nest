"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { maskedAccountSuffix } from "@/lib/account-presentation";
import { getCreditAvailabilityPresentation } from "@/lib/credit-presentation";
import {
  accountBalance,
  formatDate,
  formatMoney,
  isDebtAccount,
} from "@/lib/finance";
import type { Account, WorkspaceData } from "@/lib/types";
import { accountUsage } from "@/lib/usage";
import { formatUsagePercentage, UsageMeter } from "./account-summary";
import "./financial-card-carousel.css";

const kindLabels = {
  bank: "Bank account",
  credit_card: "Credit card",
  wallet: "Wallet",
  pay_later: "Pay Later",
};

/** A safe front with primary debt balances and optional supporting facts below. */
export function VirtualAccountCard({
  account,
  data,
  today,
  onNavigate,
  showFinancialFacts = true,
}: {
  account: Account;
  data: WorkspaceData;
  today: string;
  onNavigate?: () => void;
  showFinancialFacts?: boolean;
}) {
  const debt = isDebtAccount(account);
  const balance = debt ? null : accountBalance(data, account.id, today);
  const usage = debt ? accountUsage(data, account.id, today) : null;
  const availability = usage ? getCreditAvailabilityPresentation(usage) : null;
  const outstandingStatus = usage?.balanceVerificationStatus ?? "unconfirmed";
  const institution = account.institution.trim() || "Institution not available";
  const initials =
    account.institution
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?";
  const calculated =
    balance &&
    (balance.currentSource === "opening" || balance.movementsSinceSnapshot > 0);
  const asOf = usage?.asOf ?? balance?.currentAsOf;

  return (
    <Link
      href={`/accounts/${encodeURIComponent(account.id)}`}
      onClick={onNavigate}
      className="virtual-account-card"
      data-kind={account.kind}
      data-archived={!account.active}
      aria-label={`${account.name} account details`}
    >
      <div className="virtual-account-face" data-branding="issuer-initials">
        <div className="virtual-account-card-top">
          <span
            className="virtual-account-initials"
            role="img"
            aria-label={`${institution} initials`}
          >
            {initials}
          </span>
          <span className="virtual-account-issuer">{institution}</span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </div>
        {usage && availability && (
          <dl className="virtual-account-face-metrics">
            <div data-metric="outstanding" data-status={outstandingStatus}>
              <dt>Outstanding</dt>
              <dd>
                <strong>
                  {usage.currentOutstanding === null
                    ? "Not available"
                    : formatMoney(usage.currentOutstanding)}
                </strong>
                <small>
                  {outstandingStatus === "verified"
                    ? "Verified report"
                    : outstandingStatus === "estimated"
                      ? "Estimated"
                      : outstandingStatus === "partial"
                        ? "Partial data"
                        : "Not reported"}
                </small>
              </dd>
            </div>
            <div data-metric="available" data-status={availability.status}>
              <dt>
                {account.kind === "pay_later"
                  ? "Available limit"
                  : "Available credit"}
              </dt>
              <dd>
                <strong>
                  {availability.amount === null
                    ? "Not available"
                    : formatMoney(availability.amount)}
                </strong>
                <small>
                  {availability.status === "verified"
                    ? "Verified report"
                    : availability.status === "estimated"
                      ? "Estimated"
                      : "Not reported"}
                </small>
              </dd>
            </div>
          </dl>
        )}
        <div className="virtual-account-face-bottom">
          <div className="virtual-account-identity">
            <span>
              {kindLabels[account.kind]}
              {!account.active ? " · Archived" : ""}
            </span>
            <h3>{account.name}</h3>
          </div>
          <span className="virtual-account-number">
            {maskedAccountSuffix(account.maskedSuffix)}
          </span>
        </div>
      </div>
      {showFinancialFacts && (
        <div className="virtual-account-facts">
          {usage ? (
            <>
              <div className="virtual-account-credit-facts">
                <div>
                  <span>
                    {usage.provenance === "partial"
                      ? "Minimum known outstanding"
                      : "Current usage"}
                  </span>
                  <strong>
                    {usage.used === null
                      ? "Not reported"
                      : `${usage.provenance === "partial" ? "At least " : ""}${formatMoney(usage.used)}`}
                  </strong>
                  {usage.used !== null && (
                    <small>
                      {usage.provenance === "partial"
                        ? "Bill-only exposure"
                        : "Recorded usage"}
                    </small>
                  )}
                </div>
                <div>
                  <span>
                    {account.kind === "pay_later"
                      ? "Approved limit"
                      : "Credit limit"}
                  </span>
                  <strong>
                    {usage.limit === null
                      ? "Not set"
                      : formatMoney(usage.limit)}
                  </strong>
                </div>
              </div>
              {usage.percentage !== null && usage.provenance !== "partial" && (
                <div className="virtual-account-utilization">
                  <UsageMeter
                    {...usage}
                    label={`${account.name} utilization`}
                  />
                  <span>{formatUsagePercentage(usage.percentage)} used</span>
                </div>
              )}
              {usage.latestBill && (
                <div className="virtual-account-bill">
                  <span>
                    Statement remaining{" "}
                    <b>
                      {usage.billedAmount === null
                        ? "Not available"
                        : formatMoney(usage.billedAmount)}
                    </b>
                  </span>
                  {usage.paymentDueDate && (
                    <span>
                      Statement due {formatDate(usage.paymentDueDate)}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="virtual-account-primary">
              <span>Current balance</span>
              <strong>
                {balance?.current === null || balance?.current === undefined
                  ? "Not reported"
                  : formatMoney(balance.current)}
              </strong>
            </div>
          )}
          <div className="virtual-account-card-footer">
            <span>
              {asOf
                ? `${
                    usage
                      ? usage.provenance === "partial"
                        ? "Known bill only"
                        : usage.provenance === "calculated"
                          ? "Calculated"
                          : usage.provenance === "inferred"
                            ? "Estimated"
                            : "Reported"
                      : calculated
                        ? "Calculated"
                        : "Reported"
                  } · ${formatDate(asOf)}`
                : "No balance report yet"}
            </span>
            <span>
              Details <ArrowUpRight size={12} aria-hidden="true" />
            </span>
          </div>
        </div>
      )}
    </Link>
  );
}
