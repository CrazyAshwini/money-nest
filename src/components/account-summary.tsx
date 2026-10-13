"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { accountBalance, formatDate, formatMoney } from "@/lib/finance";
import {
  usageBandLabels,
  type UsageBand,
  type UsageSummary,
} from "@/lib/usage";
import type { Account, WorkspaceData } from "@/lib/types";

export function AccountBreakdown({
  count,
  label,
  children,
}: {
  count: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="account-breakdown">
      <summary>
        <span>
          {count} {label}
          {count === 1 ? "" : "s"}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}

export function formatUsagePercentage(percentage: number | null) {
  // Keep a value just below a threshold from appearing in the next band.
  return percentage === null
    ? "Unknown"
    : `${new Decimal(percentage).toDecimalPlaces(1, Decimal.ROUND_DOWN)}%`;
}

export function UsageStatus({ band }: { band: UsageBand }) {
  return (
    <span className="usage-status" data-band={band}>
      <i aria-hidden="true" />
      {usageBandLabels[band]}
    </span>
  );
}

export function UsageMeter({
  percentage,
  progress,
  band,
  label,
}: {
  percentage: number | null;
  progress: number;
  band: UsageBand;
  label: string;
}) {
  return (
    <div
      className="usage-meter"
      data-band={band}
      role={percentage === null ? undefined : "meter"}
      aria-label={label}
      aria-valuemin={percentage === null ? undefined : 0}
      aria-valuemax={percentage === null ? undefined : 100}
      aria-valuenow={percentage === null ? undefined : progress}
      aria-valuetext={
        percentage === null
          ? undefined
          : `${formatUsagePercentage(percentage)} used · ${usageBandLabels[band]}`
      }
    >
      <span style={{ width: `${progress}%` }} />
    </div>
  );
}

function AccountIdentity({ account }: { account: Account }) {
  return (
    <div className="stat-account-identity">
      <span>{account.name}</span>
      <small>
        {account.institution}
        {account.maskedSuffix ? ` · ••${account.maskedSuffix}` : ""}
      </small>
    </div>
  );
}

export function BankAccountSummary({
  data,
  today,
}: {
  data: WorkspaceData;
  today: string;
}) {
  const accounts = data.accounts.filter((a) => a.active && a.kind === "bank");
  return (
    <div
      className="stat-account-list"
      role="group"
      aria-label="Bank balance by account"
    >
      {accounts.map((account) => {
        const balance = accountBalance(data, account.id, today);
        return (
          <Link
            key={account.id}
            href={`/accounts/${account.id}`}
            className="stat-account-row bank-summary-row"
          >
            <AccountIdentity account={account} />
            <div className="stat-account-balance">
              <b>
                {balance.current === null
                  ? "Not reported"
                  : formatMoney(balance.current)}
              </b>
              <small>
                {balance.currentAsOf
                  ? `${balance.currentSource === "opening" || balance.movementsSinceSnapshot > 0 ? "Calculated" : "Reported"} · ${formatDate(balance.currentAsOf)}`
                  : "Snapshot needed"}
              </small>
            </div>
          </Link>
        );
      })}
      {accounts.length === 0 && (
        <Link href="/accounts" className="stat-account-empty">
          Add a bank account
        </Link>
      )}
    </div>
  );
}

export function CreditUsageSummary({
  summary,
  kind,
}: {
  summary: UsageSummary;
  kind: "credit_card" | "pay_later";
}) {
  return (
    <div className="stat-credit-summary">
      <div className="stat-limit-total">
        <span>
          {summary.knownLimitCount === summary.count && summary.count > 0
            ? "Total limit"
            : "Known limits"}
        </span>
        <b>
          {summary.knownLimitCount > 0
            ? formatMoney(summary.limitTotal, { decimals: 0 })
            : "Not set"}
        </b>
      </div>
      <div className="usage-level">
        <span>
          {summary.percentage === null
            ? "Overall usage unknown"
            : `${formatUsagePercentage(summary.percentage)} used`}
        </span>
        <UsageStatus band={summary.band} />
      </div>
      <UsageMeter
        {...summary}
        label={`Overall ${kind === "pay_later" ? "Pay Later" : "credit card"} usage`}
      />
      <AccountBreakdown
        count={summary.count}
        label={kind === "pay_later" ? "provider" : "card"}
      >
        <div
          className="stat-account-list"
          role="group"
          aria-label="Usage by account"
        >
          {summary.rows.map((row) => (
            <Link
              key={row.account.id}
              href={`/accounts/${row.account.id}`}
              className="stat-account-row credit-summary-row"
            >
              <AccountIdentity account={row.account} />
              <div className="stat-account-amount">
                <b>
                  {row.used === null
                    ? "Usage unknown"
                    : `${row.provenance === "partial" ? "At least " : ""}${formatMoney(row.used)}`}
                </b>
                <span>
                  Limit{" "}
                  {row.limit === null
                    ? "not set"
                    : formatMoney(row.limit, { decimals: 0 })}
                </span>
              </div>
              <UsageMeter {...row} label={`${row.account.name} usage`} />
              <div className="usage-level">
                <span>
                  {row.percentage === null
                    ? "Percentage unknown"
                    : `${formatUsagePercentage(row.percentage)} used`}
                </span>
                <UsageStatus band={row.band} />
              </div>
              <small className="stat-account-source">
                {row.asOf
                  ? `${row.provenance === "partial" ? "Known bill only" : row.provenance === "inferred" ? "From available credit" : row.provenance === "reported" ? "Reported" : "Usage not reported"} · ${formatDate(row.asOf)}`
                  : "Snapshot needed"}
              </small>
            </Link>
          ))}
          {summary.count === 0 && (
            <Link href="/accounts" className="stat-account-empty">
              Add an account to track usage
            </Link>
          )}
        </div>
      </AccountBreakdown>
    </div>
  );
}
