"use client";

import { ArrowUpRight, Pencil } from "lucide-react";
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

/** A safe card face with canonical financial values and separate account actions. */
export function VirtualAccountCard({
  account,
  data,
  today,
  onNavigate,
  onEdit,
  showFinancialFacts = true,
}: {
  account: Account;
  data: WorkspaceData;
  today: string;
  onNavigate?: () => void;
  onEdit?: (account: Account) => void;
  showFinancialFacts?: boolean;
}) {
  const debt = isDebtAccount(account);
  const balance = debt ? null : accountBalance(data, account.id, today);
  const usage = debt ? accountUsage(data, account.id, today) : null;
  const availability = usage ? getCreditAvailabilityPresentation(usage) : null;
  const outstandingStatus = usage?.balanceVerificationStatus ?? "unconfirmed";
  const showKnownExposure =
    usage?.currentOutstanding === null &&
    usage.provenance === "partial" &&
    usage.used !== null;
  const showUtilization =
    usage &&
    usage.creditUtilization !== null &&
    usage.percentage !== null &&
    usage.provenance !== "partial" &&
    usage.provenance !== "unknown";
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
  const asOf = balance?.currentAsOf;
  const showAssetSummary = !debt && showFinancialFacts;
  const hasIdentifier = Boolean(account.maskedSuffix?.trim());

  return (
    <div
      className="virtual-account-card"
      data-kind={account.kind}
      data-archived={!account.active}
      data-editable={Boolean(onEdit)}
    >
      <Link
        href={`/accounts/${encodeURIComponent(account.id)}`}
        onClick={onNavigate}
        className="virtual-account-details-link"
        aria-label={`${account.name} account details`}
      >
        <div
          className="virtual-account-face"
          data-branding="issuer-initials"
          data-asset-summary={showAssetSummary}
        >
          <div className="virtual-account-card-top">
            <span
              className="virtual-account-initials"
              role="img"
              aria-label={`${institution} initials`}
            >
              {initials}
            </span>
            <span className="virtual-account-issuer">{institution}</span>
            {!onEdit && <ArrowUpRight size={17} aria-hidden="true" />}
          </div>
          {usage && availability && (
            <div className="virtual-account-face-finances">
              <dl className="virtual-account-face-metrics">
                <div data-metric="outstanding" data-status={outstandingStatus}>
                  <dt>
                    {showKnownExposure ? "Known exposure" : "Outstanding"}
                  </dt>
                  <dd>
                    <strong>
                      {showKnownExposure
                        ? `At least ${formatMoney(usage.used!)}`
                        : usage.currentOutstanding === null
                          ? "Not available"
                          : formatMoney(usage.currentOutstanding)}
                    </strong>
                    <small>
                      {showKnownExposure
                        ? "Partial · Bills only"
                        : outstandingStatus === "verified"
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
              <dl className="virtual-account-face-limit">
                <div
                  data-metric="limit"
                  data-status={
                    usage.totalCreditLimit === null ? "unknown" : "known"
                  }
                >
                  <dt>
                    {account.kind === "pay_later"
                      ? "Total approved limit"
                      : "Total credit limit"}
                  </dt>
                  <dd>
                    {usage.totalCreditLimit === null
                      ? "Not available"
                      : formatMoney(usage.totalCreditLimit)}
                  </dd>
                </div>
              </dl>
              <div
                className="virtual-account-face-utilization"
                data-state={showUtilization ? "available" : "unavailable"}
                data-provenance={usage.provenance}
              >
                {showUtilization ? (
                  <>
                    <div>
                      <span>
                        {usage.provenance === "reported"
                          ? "Utilization"
                          : "Estimated utilization"}
                      </span>
                      <strong>
                        {formatUsagePercentage(usage.creditUtilization)}
                      </strong>
                    </div>
                    <UsageMeter
                      {...usage}
                      label={`${account.name} utilization`}
                    />
                  </>
                ) : (
                  <span>Usage unavailable</span>
                )}
              </div>
            </div>
          )}
          <div className="virtual-account-face-bottom">
            <div className="virtual-account-identity">
              {(!debt || !account.active) && (
                <span>
                  {kindLabels[account.kind]}
                  {!account.active ? " · Archived" : ""}
                </span>
              )}
              <h3>{account.name}</h3>
            </div>
            {hasIdentifier && (
              <span className="virtual-account-number">
                {maskedAccountSuffix(account.maskedSuffix)}
              </span>
            )}
          </div>
          {showAssetSummary && (
            <div
              className="virtual-account-face-balance"
              data-metric="balance"
              data-status={
                balance?.current === null || balance?.current === undefined
                  ? "unknown"
                  : calculated
                    ? "calculated"
                    : "reported"
              }
            >
              <span>Current balance</span>
              <strong>
                {balance?.current === null || balance?.current === undefined
                  ? "Balance unavailable"
                  : formatMoney(balance.current)}
              </strong>
              {balance?.current !== null &&
                balance?.current !== undefined &&
                asOf && (
                  <small>
                    {calculated ? "Calculated" : "Reported"} ·{" "}
                    {formatDate(asOf)}
                  </small>
                )}
            </div>
          )}
        </div>
      </Link>
      {onEdit && (
        <button
          type="button"
          className="virtual-account-edit"
          aria-label={`Edit ${account.name} account`}
          title={`Edit ${account.name} account`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit(account);
          }}
        >
          <Pencil size={17} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
