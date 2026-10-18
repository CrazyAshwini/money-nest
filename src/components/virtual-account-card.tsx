"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { maskedAccountSuffix } from "@/lib/account-presentation";
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

/** A compact read-only front card. All amounts come from the existing selectors. */
export function VirtualAccountCard({
  account,
  data,
  today,
  onNavigate,
}: {
  account: Account;
  data: WorkspaceData;
  today: string;
  onNavigate?: () => void;
}) {
  const debt = isDebtAccount(account);
  const balance = debt ? null : accountBalance(data, account.id, today);
  const usage = debt ? accountUsage(data, account.id, today) : null;
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
      <div className="virtual-account-card-top">
        <span
          className="virtual-account-initials"
          role="img"
          aria-label={`${institution} initials`}
        >
          {initials}
        </span>
        <div className="virtual-account-identity">
          <span>{institution}</span>
          <h3>{account.name}</h3>
        </div>
        <ArrowUpRight size={17} aria-hidden="true" />
      </div>
      <div className="virtual-account-type">
        <span>
          {kindLabels[account.kind]}
          {!account.active ? " · Archived" : ""}
        </span>
        <span>{maskedAccountSuffix(account.maskedSuffix)}</span>
      </div>
      <div className="virtual-account-primary">
        <span>{debt ? "Current usage" : "Current balance"}</span>
        <strong>
          {usage
            ? usage.used === null
              ? "Not reported"
              : `${usage.provenance === "partial" ? "At least " : ""}${formatMoney(usage.used)}`
            : balance?.current === null || balance?.current === undefined
              ? "Not reported"
              : formatMoney(balance.current)}
        </strong>
      </div>
      {usage && (
        <>
          <div className="virtual-account-credit-facts">
            <span>
              Limit{" "}
              <b>
                {usage.limit === null
                  ? "Not set"
                  : formatMoney(usage.limit, { decimals: 0 })}
              </b>
            </span>
            <span>
              {usage.availableCreditStatus === "verified"
                ? "Available"
                : "Est. available"}{" "}
              <b>
                {usage.provenance === "partial" ||
                usage.availableCredit === null
                  ? "Unknown"
                  : formatMoney(usage.availableCredit, { decimals: 0 })}
              </b>
            </span>
          </div>
          {usage.percentage !== null && usage.provenance !== "partial" && (
            <div className="virtual-account-utilization">
              <UsageMeter {...usage} label={`${account.name} utilization`} />
              <span>{formatUsagePercentage(usage.percentage)} used</span>
            </div>
          )}
          {usage.latestBill && (
            <div className="virtual-account-bill">
              <span>
                Statement{" "}
                <b>
                  {formatMoney(usage.latestBill.statementAmount, {
                    decimals: 0,
                  })}
                </b>
              </span>
              {usage.latestBill.dueDate && (
                <span>Statement due {formatDate(usage.latestBill.dueDate)}</span>
              )}
            </div>
          )}
        </>
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
    </Link>
  );
}
