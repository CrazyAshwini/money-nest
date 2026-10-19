"use client";

import { ArrowUpRight, Info } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import {
  analyticsCategoryColor,
  analyticsTransactionsHref,
  dailySpendingDetail,
  ownedAnalyticsData,
  type SpendingMode,
} from "@/lib/analytics-presentation";
import {
  compareMoney,
  dailySpending,
  formatDate,
  formatMoney,
  monthlySummary,
  monthLabel,
  spendingByCategory,
} from "@/lib/finance";
import type { Transaction } from "@/lib/types";
import SpendingChart from "./charts";
import { DailySpendingDialog } from "./daily-spending-dialog";
import { useFinance } from "./finance-provider";
import "./analytics-workspace.css";

export function AnalyticsWorkspace({
  mode,
  onOpenTransaction,
}: {
  mode: SpendingMode;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const { data: workspace, month, userId } = useFinance();
  const data = useMemo(
    () => ownedAnalyticsData(workspace, userId),
    [workspace, userId],
  );
  const summary = useMemo(() => monthlySummary(data, month), [data, month]);
  const grossDays = useMemo(() => dailySpending(data, month), [data, month]);
  const days = useMemo(
    () =>
      mode === "net" ? dailySpending(data, month, { net: true }) : grossDays,
    [data, month, mode, grossDays],
  );
  const chartPoints = useMemo(
    () =>
      days.map((day) => ({
        date: day.date,
        label: String(day.day),
        amount: Number(day.amount),
        amountText: day.amount,
      })),
    [days],
  );
  const categories = useMemo(
    () => spendingByCategory(data, month),
    [data, month],
  );
  const [selection, setSelection] = useState<{
    date: string;
    trigger: HTMLElement | SVGSVGElement | null;
  } | null>(null);
  const selectedDate = selection?.date ?? null;
  const selectedDay = useMemo(
    () =>
      selectedDate?.startsWith(`${month}-`)
        ? dailySpendingDetail(data, month, selectedDate)
        : null,
    [data, month, selectedDate],
  );
  const activeDays = grossDays.filter(
    (day) => compareMoney(day.amount, "0.00") > 0,
  );
  const largestDay = activeDays.reduce<(typeof activeDays)[number] | null>(
    (largest, day) =>
      !largest || compareMoney(day.amount, largest.amount) > 0 ? day : largest,
    null,
  );
  const unlinkedRefunds = data.transactions.filter(
    (transaction) =>
      transaction.kind === "refund" &&
      transaction.status === "posted" &&
      transaction.occurredOn?.startsWith(`${month}-`) &&
      (!transaction.refundOfTransactionId ||
        !data.transactions.some(
          (original) =>
            original.id === transaction.refundOfTransactionId &&
            original.kind === "expense" &&
            original.status === "posted" &&
            original.occurredOn,
        )),
  );
  const categoryGradient = categories
    .map((category, index) => {
      const start = categories
        .slice(0, index)
        .reduce((position, item) => position + item.percentage, 0);
      return `${analyticsCategoryColor(category.category)} ${start}% ${start + category.percentage}%`;
    })
    .join(", ");
  return (
    <div className="analytics-workspace">
      <section
        className="analytics-overview"
        aria-label="Monthly spending summary"
      >
        <div className="analytics-summary-value is-primary">
          <span>Net spending</span>
          <strong>{formatMoney(summary.net)}</strong>
          <small>{monthLabel(month)}</small>
        </div>
        <div className="analytics-summary-value">
          <span>Gross expenses</span>
          <strong>{formatMoney(summary.gross)}</strong>
          <small>
            {summary.expenseCount} posted expense
            {summary.expenseCount === 1 ? "" : "s"}
          </small>
        </div>
        <div className="analytics-summary-value">
          <span>Matched refunds</span>
          <strong>{formatMoney(summary.refunds)}</strong>
          <small>Applied to net spending</small>
        </div>
      </section>

      <div className="analytics-chart-grid">
        <section
          className="analytics-panel analytics-daily-panel"
          aria-labelledby="analytics-daily-title"
        >
          <header className="analytics-panel-heading">
            <div>
              <h2 id="analytics-daily-title">Monthly spending</h2>
              <p>
                {mode === "net"
                  ? "Net after matched refunds"
                  : "Posted expenses"}{" "}
                · {monthLabel(month)}
              </p>
            </div>
            <strong>
              {formatMoney(mode === "net" ? summary.net : summary.gross)}
            </strong>
          </header>
          <SpendingChart
            key={`${userId}:${month}:${mode}`}
            points={chartPoints}
            tooltipHidden={Boolean(selectedDay)}
            onSelectDate={(date, trigger) => setSelection({ date, trigger })}
          />
          <p className="analytics-chart-hint">
            Select a day to see its transactions.
          </p>
          {summary.expenseCount === 0 && (
            <p className="analytics-empty">
              No posted expenses this month. Select a date to explore its saved
              activity.
            </p>
          )}
        </section>

        <section
          className="analytics-panel analytics-category-panel"
          aria-labelledby="analytics-category-title"
        >
          <header className="analytics-panel-heading">
            <div>
              <h2 id="analytics-category-title">Spending by category</h2>
              <p>
                Gross expenses · {categories.length} categor
                {categories.length === 1 ? "y" : "ies"}
              </p>
            </div>
          </header>
          {categories.length ? (
            <div className="analytics-category-visual">
              <div
                className="analytics-category-donut"
                role="img"
                aria-label={`Gross spending by category: ${categories.map((category) => `${category.category} ${formatMoney(category.amount)}`).join(", ")}`}
                style={{ background: `conic-gradient(${categoryGradient})` }}
              >
                <div>
                  <small>Gross expenses</small>
                  <strong>{formatMoney(summary.gross, { decimals: 0 })}</strong>
                </div>
              </div>
              <ul className="analytics-category-legend">
                {categories.slice(0, 4).map((category) => (
                  <li key={category.category}>
                    <Link
                      href={analyticsTransactionsHref({
                        category: category.category,
                        month,
                      })}
                    >
                      <i
                        aria-hidden="true"
                        style={{
                          background: analyticsCategoryColor(category.category),
                        }}
                      />
                      <span>{category.category}</span>
                      <strong>{category.percentage.toFixed(0)}%</strong>
                    </Link>
                  </li>
                ))}
                {categories.length > 4 && (
                  <li className="analytics-category-more">
                    <a href="#analytics-category-breakdown">
                      {categories.length - 4} more in breakdown
                    </a>
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <div className="analytics-category-empty">
              <span
                className="analytics-category-donut is-empty"
                aria-hidden="true"
              >
                <span />
              </span>
              <p>No spending to categorize yet.</p>
            </div>
          )}
          <p className="analytics-chart-hint">
            Category totals use gross expenses in both spending modes.
          </p>
        </section>
      </div>

      {(compareMoney(summary.unexplainedRefunds, "0.00") > 0 ||
        unlinkedRefunds.length > 0) && (
        <div className="analytics-refund-warning" role="note">
          <Info size={16} aria-hidden="true" />
          <p>
            {compareMoney(summary.unexplainedRefunds, "0.00") > 0 && (
              <>
                {formatMoney(summary.unexplainedRefunds)} in matched
                reimbursements exceeds the original purchases and does not
                reduce net spending further.{" "}
              </>
            )}
            {unlinkedRefunds.length > 0 && (
              <>
                {unlinkedRefunds.length} posted refund
                {unlinkedRefunds.length === 1 ? " is" : "s are"} not linked to a
                qualifying purchase and excluded from net spending.{" "}
              </>
            )}
            Full receipts remain saved in{" "}
            <Link href="/transactions?kind=refund&period=all">the ledger</Link>.
          </p>
        </div>
      )}

      <div className="analytics-detail-grid">
        <section
          className="analytics-panel analytics-category-breakdown"
          id="analytics-category-breakdown"
          aria-labelledby="analytics-breakdown-title"
        >
          <header className="analytics-panel-heading">
            <div>
              <h2 id="analytics-breakdown-title">Category breakdown</h2>
              <p>Select a category to view its posted expenses.</p>
            </div>
          </header>
          {categories.length ? (
            <ul>
              {categories.map((category) => (
                <li key={category.category}>
                  <Link
                    href={analyticsTransactionsHref({
                      category: category.category,
                      month,
                    })}
                    style={
                      {
                        "--analytics-category-color": analyticsCategoryColor(
                          category.category,
                        ),
                      } as CSSProperties
                    }
                  >
                    <i aria-hidden="true" />
                    <span className="analytics-category-name">
                      <strong>{category.category}</strong>
                      <small>
                        {category.count} expense
                        {category.count === 1 ? "" : "s"} ·{" "}
                        {category.percentage.toFixed(1)}%
                      </small>
                    </span>
                    <span className="analytics-category-amount">
                      {formatMoney(category.amount)}
                    </span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analytics-empty">
              No posted expenses for {monthLabel(month)}.
            </p>
          )}
        </section>

        <section
          className="analytics-panel analytics-insights"
          aria-labelledby="analytics-insights-title"
        >
          <header className="analytics-panel-heading">
            <div>
              <h2 id="analytics-insights-title">Transaction insights</h2>
              <p>From your saved posted expenses.</p>
            </div>
          </header>
          <dl>
            <div>
              <dt>Days with spending</dt>
              <dd>
                {activeDays.length}
                <small>of {grossDays.length} days</small>
              </dd>
            </div>
            <div>
              <dt>Largest spending day</dt>
              <dd>
                {largestDay ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      setSelection({
                        date: largestDay.date,
                        trigger: event.currentTarget,
                      });
                    }}
                  >
                    {formatMoney(largestDay.amount)}
                    <small>{formatDate(largestDay.date)}</small>
                  </button>
                ) : (
                  <span>No posted expenses</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Leading category</dt>
              <dd>
                {categories[0] ? (
                  <Link
                    href={analyticsTransactionsHref({
                      category: categories[0].category,
                      month,
                    })}
                  >
                    {categories[0].category}
                    <small>
                      {categories[0].percentage.toFixed(0)}% of gross expenses
                    </small>
                  </Link>
                ) : (
                  <span>Not available yet</span>
                )}
              </dd>
            </div>
          </dl>
          <details className="analytics-calculation-info">
            <summary>
              <Info size={14} aria-hidden="true" /> How spending is calculated
            </summary>
            <p>
              Gross spending includes dated, posted expenses. Net spending
              subtracts refunds explicitly linked to posted purchases, capped at
              each purchase’s remaining amount. Daily net values follow the
              existing date-based calculation and may be negative when matched
              refunds exceed purchases on that date. Transfers and repayments
              are excluded. Refunds without a qualifying match remain in the
              ledger.
            </p>
          </details>
        </section>
      </div>
      {selectedDay && (
        <DailySpendingDialog
          key={selectedDay.date}
          detail={selectedDay}
          mode={mode}
          data={data}
          trigger={selection?.trigger ?? null}
          onClose={() => setSelection(null)}
          onOpenTransaction={onOpenTransaction}
        />
      )}
    </div>
  );
}
