"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  getAggregateCreditAvailability,
  getAggregateCreditOutstanding,
} from "@/lib/credit-presentation";
import type { UsageSummary } from "@/lib/usage";
import { DashboardFinancialDetails } from "../dashboard-details";
import {
  Landmark,
  CreditCard,
  ChartNoAxesCombined,
  ArrowUpRight,
  ChevronRight,
  Wallet,
  Clock,
} from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Badge, Empty } from "../ui";
import {
  dashboardMetrics,
  formatMoney,
  formatDate,
  monthLabel,
  billSummary,
} from "@/lib/finance";
import { TransactionHistory } from "../unified-transaction-history";
import { usageSummary } from "@/lib/usage";
import { type Bill } from "@/lib/types";
import type { Open } from "./types";

type FinancialSection = "bank" | "spending" | "credit" | "paylater";

function FinancialCard({
  section,
  title,
  value,
  valueLabel,
  caption,
  icon,
  active,
  onOpen,
  children,
}: {
  section: FinancialSection;
  title: string;
  value: string;
  valueLabel?: ReactNode;
  caption: string;
  icon: ReactNode;
  active: boolean;
  onOpen: (section: FinancialSection, trigger: HTMLButtonElement) => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"stat financial-summary-card dashboard-card-" + section}
      aria-label={title + " details"}
      aria-describedby={`${valueLabel ? `financial-${section}-label ` : ""}financial-${section}-value${children ? ` financial-${section}-extra` : ""} financial-${section}-caption`}
      aria-haspopup="dialog"
      aria-expanded={active}
      onClick={(event) => onOpen(section, event.currentTarget)}
    >
      <span className="stat-top">
        <span>{title}</span>
        {icon}
      </span>
      {valueLabel && (
        <span
          id={`financial-${section}-label`}
          className="financial-value-label"
        >
          {valueLabel}
        </span>
      )}
      <strong id={`financial-${section}-value`}>{value}</strong>
      {children && <span id={`financial-${section}-extra`}>{children}</span>}
      <span id={`financial-${section}-caption`} className="stat-bottom">
        {caption}
      </span>
      <span className="financial-card-cue">
        <span>View details</span>
        <ChevronRight size={17} aria-hidden="true" />
      </span>
    </button>
  );
}

function creditStatusLabel(status: string, estimatedCount: number) {
  return status === "partial"
    ? estimatedCount
      ? "Partial · Estimated"
      : "Partial"
    : status === "estimated"
      ? "Estimated"
      : status === "verified"
        ? "Verified reports"
        : "";
}

function DashboardCreditAvailability({
  summary,
  payLater = false,
}: {
  summary: UsageSummary;
  payLater?: boolean;
}) {
  const availability = getAggregateCreditAvailability(summary.rows);
  const status = creditStatusLabel(
    availability.status,
    availability.estimatedCount,
  );
  const label = payLater ? "Available limit" : "Available credit";
  return (
    <span
      className="dashboard-credit-available"
      data-availability-status={availability.status}
    >
      <span>
        {availability.status === "partial"
          ? `Known ${label.toLowerCase()}`
          : label}
        {status && <small>{status}</small>}
      </span>
      <b>
        {availability.amount === null
          ? "Not available"
          : formatMoney(availability.amount)}
      </b>
    </span>
  );
}

function DashboardCreditLimit({
  summary,
  payLater = false,
}: {
  summary: UsageSummary;
  payLater?: boolean;
}) {
  const partial = summary.knownLimitCount < summary.count;
  const status = !summary.knownLimitCount
    ? "unknown"
    : partial
      ? "partial"
      : "known";
  return (
    <span className="dashboard-credit-limit" data-limit-status={status}>
      <span>
        {payLater ? "Total approved limit" : "Total credit limit"}
        {partial && summary.knownLimitCount > 0 && (
          <small>Known limits · Partial</small>
        )}
      </span>
      <b>
        {summary.knownLimitCount
          ? formatMoney(summary.limitTotal)
          : "Not available"}
      </b>
    </span>
  );
}

function Kpis() {
  const { data, month, today } = useFinance();
  const [details, setDetails] = useState<{
    section: FinancialSection;
    trigger: HTMLButtonElement;
  } | null>(null);
  const metrics = dashboardMetrics(data, month, today);
  const credit = usageSummary(data, "credit_card", today);
  const payLater = usageSummary(data, "pay_later", today);
  const show = (section: FinancialSection, trigger: HTMLButtonElement) =>
    setDetails({ section, trigger });
  const creditOutstanding = getAggregateCreditOutstanding(credit.rows);
  const payLaterOutstanding = getAggregateCreditOutstanding(payLater.rows);
  const outstandingLabel = (value: typeof creditOutstanding) => {
    const status = creditStatusLabel(value.status, value.estimatedCount);
    return (
      <>
        {value.label}
        {status && <small>{status}</small>}
      </>
    );
  };
  const accountCount = (
    summary: UsageSummary,
    singular: string,
    plural: string,
  ) =>
    summary.count
      ? `${summary.count} ${summary.count === 1 ? singular : plural}`
      : `No active ${plural}`;
  const bankCaption =
    (metrics.knownBankCount < metrics.totalBankCount
      ? `${metrics.knownBankCount}/${metrics.totalBankCount} balances known · Partial coverage`
      : `${metrics.totalBankCount} account${metrics.totalBankCount === 1 ? "" : "s"}`) +
    " · " +
    (metrics.bankAsOf
      ? metrics.updatedBankCount || metrics.openingBankCount
        ? "Calculated through " + formatDate(today)
        : "Reported from " + formatDate(metrics.bankAsOf)
      : "No balance reports");
  return (
    <>
      <section
        className="stats-grid home-kpis dashboard-financial-grid"
        aria-labelledby="financial-overview-title"
      >
        <FinancialCard
          section="bank"
          title="Total bank balance"
          value={
            metrics.knownBankCount > 0
              ? formatMoney(metrics.bankBalance)
              : "Not reported"
          }
          caption={bankCaption}
          icon={<Landmark size={20} aria-hidden="true" />}
          active={details?.section === "bank"}
          onOpen={show}
        />
        <FinancialCard
          section="spending"
          title={`Gross spending · ${monthLabel(month)}`}
          value={formatMoney(metrics.monthSpending)}
          caption={
            metrics.expenseCount + " posted expenses · " + monthLabel(month)
          }
          icon={<ArrowUpRight size={20} aria-hidden="true" />}
          active={details?.section === "spending"}
          onOpen={show}
        />
        <FinancialCard
          section="credit"
          title="Credit cards"
          value={
            creditOutstanding.amount === null
              ? "Not available"
              : formatMoney(creditOutstanding.amount)
          }
          valueLabel={outstandingLabel(creditOutstanding)}
          caption={accountCount(credit, "card", "cards")}
          icon={<CreditCard size={19} aria-hidden="true" />}
          active={details?.section === "credit"}
          onOpen={show}
        >
          <DashboardCreditAvailability summary={credit} />
          <DashboardCreditLimit summary={credit} />
        </FinancialCard>
        <FinancialCard
          section="paylater"
          title="Pay Later"
          value={
            payLaterOutstanding.amount === null
              ? "Not available"
              : formatMoney(payLaterOutstanding.amount)
          }
          valueLabel={outstandingLabel(payLaterOutstanding)}
          caption={accountCount(payLater, "provider", "providers")}
          icon={<Wallet size={19} aria-hidden="true" />}
          active={details?.section === "paylater"}
          onOpen={show}
        >
          <DashboardCreditAvailability summary={payLater} payLater />
          <DashboardCreditLimit summary={payLater} payLater />
        </FinancialCard>
      </section>
      {details && (
        <DashboardFinancialDetails
          section={details.section}
          trigger={details.trigger}
          onClose={() => setDetails(null)}
        />
      )}
    </>
  );
}

export function Dashboard({ open }: { open: Open }) {
  const { data, month, today } = useFinance();
  const unpaid = data.bills
    .filter((b) => billSummary(data, b.id, today).remaining !== "0.00")
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const recent = data.transactions
    .filter((t) => t.occurredOn?.startsWith(month) && t.status !== "voided")
    .sort((a, b) => (b.occurredOn || "").localeCompare(a.occurredOn || ""))
    .slice(0, 4);
  return (
    <>
      <Kpis />
      <div className="dashboard-essential-grid">
        <Section title="Bills to pay" href="/bills" className="dashboard-bills">
          <div className="upcoming-list">
            {unpaid.slice(0, 3).map((b) => (
              <BillRow key={b.id} bill={b} />
            ))}
            {unpaid.length === 0 && (
              <Empty
                title="All caught up"
                description="No unpaid statements are recorded."
              />
            )}
          </div>
        </Section>
        <Section
          title="Recent transactions"
          href="/transactions"
          className="dashboard-activity"
        >
          {recent.length ? (
            <TransactionHistory
              transactions={recent}
              accounts={data.accounts}
              groupByDate={true}
              onSelectTransaction={(transaction) =>
                open({ type: "transaction", record: transaction })
              }
            />
          ) : (
            <Empty
              title="No activity this month"
              description="Add a transaction to get started."
            />
          )}
        </Section>
      </div>
      <Link href="/analytics" className="dashboard-insights text-link">
        <ChartNoAxesCombined size={14} /> Spending insights{" "}
        <ArrowUpRight size={13} />
      </Link>
    </>
  );
}

function BillRow({ bill }: { bill: Bill }) {
  const { data, today } = useFinance();
  const a = data.accounts.find((a) => a.id === bill.accountId);
  const summary = billSummary(data, bill.id, today);
  return (
    <Link href={`/bills/${bill.id}`} className="bill-row">
      <span
        className={`date-tile ${summary.status === "overdue" ? "red" : ""}`}
      >
        {bill.dueDate ? (
          <>
            <small>
              {new Date(bill.dueDate + "T00:00:00").toLocaleDateString(
                "en-GB",
                { month: "short" },
              )}
            </small>
            <strong>{bill.dueDate.slice(-2)}</strong>
          </>
        ) : (
          <Clock size={20} />
        )}
      </span>
      <div>
        <strong>{a?.name || "Statement"}</strong>
        <small>
          {bill.dueDate
            ? `Due ${formatDate(bill.dueDate)}`
            : "Due date not confirmed"}
        </small>
      </div>
      <div className="bill-row-end">
        <strong>{formatMoney(summary.remaining)}</strong>
        <Badge
          tone={
            summary.status === "overdue"
              ? "red"
              : summary.status === "partial"
                ? "amber"
                : "neutral"
          }
        >
          {summary.status}
        </Badge>
      </div>
    </Link>
  );
}
