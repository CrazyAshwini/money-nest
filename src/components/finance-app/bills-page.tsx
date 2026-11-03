"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, ArrowUpRight } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Badge, Empty } from "../ui";
import { formatMoney, formatDate, billSummary } from "@/lib/finance";
import type { Open } from "./types";
import { DetailHeading } from "./detail-heading";

export function BillsPage({ id, open }: { id?: string; open: Open }) {
  const { data, today } = useFinance();
  const [status, setStatus] = useState("all");
  const bill = data.bills.find((b) => b.id === id);
  if (id && !bill)
    return (
      <>
        <Empty
          title="Statement not found"
          description="Return to Bills & payments to see your statements."
        />
        <Link href="/bills" className="button">
          Return to bills & payments
        </Link>
      </>
    );
  if (bill) {
    const a = data.accounts.find((a) => a.id === bill.accountId);
    const s = billSummary(data, bill.id, today);
    return (
      <>
        <DetailHeading
          title={a?.name || "Statement"}
          subtitle={`${formatDate(bill.periodStart)} — ${formatDate(bill.periodEnd)}`}
          back="/bills"
          action={
            <>
              <button
                className="button"
                onClick={() => open({ type: "bill", record: bill })}
              >
                Edit statement
              </button>
              <button
                className="button primary"
                onClick={() => open({ type: "allocation", bill })}
              >
                <Plus size={15} />
                Allocate payment
              </button>
            </>
          }
        />
        <Section
          title="Statement overview"
          action={
            <Badge
              tone={
                s.status === "paid"
                  ? "green"
                  : s.status === "overdue"
                    ? "red"
                    : "amber"
              }
            >
              {s.status}
            </Badge>
          }
        >
          <div className="bill-detail-grid">
            <div>
              <span>Statement amount</span>
              <strong>{formatMoney(s.statement)}</strong>
            </div>
            <div>
              <span>Already paid · verified</span>
              <strong className="green-text">{formatMoney(s.paid)}</strong>
            </div>
            <div>
              <span>Remaining bill</span>
              <strong>{formatMoney(s.remaining)}</strong>
            </div>
            <div>
              <span>Payment due date</span>
              <strong>
                {bill.dueDate ? formatDate(bill.dueDate) : "Not confirmed"}
              </strong>
            </div>
          </div>
          <div className="formula">
            Remaining = statement − verified payment allocations − statement
            credits ({formatMoney(s.credits)})
            {s.provisional !== "0.00" && (
              <> · {formatMoney(s.provisional)} remains provisional</>
            )}
          </div>
        </Section>
        <Section title="Payment allocations">
          <div className="record-list">
            {data.allocations
              .filter((x) => x.billId === bill.id)
              .map((x) => (
                <div className="record-row" key={x.id}>
                  <span>
                    <strong>
                      {
                        data.transactions.find((t) => t.id === x.transactionId)
                          ?.description
                      }
                    </strong>
                    <small>
                      Original ledger payment ·{" "}
                      {x.verified
                        ? "Confirmed by receiving statement"
                        : "Provisional match"}
                    </small>
                  </span>
                  <Badge tone={x.verified ? "green" : "amber"}>
                    {x.verified ? "Verified" : "Provisional"}
                  </Badge>
                  <strong>{formatMoney(x.amount)}</strong>
                </div>
              ))}
            {!data.allocations.some((x) => x.billId === bill.id) && (
              <Empty
                title="No payments applied"
                description="Match an existing bank payment to this statement."
              />
            )}
          </div>
        </Section>
      </>
    );
  }
  const bills = data.bills.filter(
    (b) => status === "all" || billSummary(data, b.id, today).status === status,
  );
  return (
    <>
      <div className="list-toolbar">
        <div className="tabs">
          {["all", "unpaid", "partial", "paid", "overdue"].map((s) => (
            <button
              key={s}
              className={status === s ? "selected" : ""}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button className="button" onClick={() => open({ type: "bill" })}>
          <Plus size={15} />
          Add statement
        </button>
      </div>
      <div className="bills-grid">
        {bills.map((b) => {
          const s = billSummary(data, b.id, today);
          const a = data.accounts.find((a) => a.id === b.accountId);
          return (
            <Section
              key={b.id}
              title={a?.name || "Statement"}
              action={
                <Badge
                  tone={
                    s.status === "paid"
                      ? "green"
                      : s.status === "overdue"
                        ? "red"
                        : "amber"
                  }
                >
                  {s.status}
                </Badge>
              }
            >
              <p className="muted statement-period">
                Statement · {formatDate(b.statementDate)}
              </p>
              <div className="bill-values">
                <div>
                  <small>Statement amount</small>
                  <strong>{formatMoney(s.statement)}</strong>
                </div>
                <div>
                  <small>Already paid</small>
                  <strong>{formatMoney(s.paid)}</strong>
                </div>
                <div>
                  <small>Remaining bill</small>
                  <strong>{formatMoney(s.remaining)}</strong>
                </div>
                <div>
                  <small>Payment due</small>
                  <strong className="due-date">
                    {b.dueDate ? formatDate(b.dueDate) : "Unconfirmed"}
                  </strong>
                </div>
              </div>
              <Link href={`/bills/${b.id}`} className="panel-foot">
                View statement & payments <ArrowUpRight size={15} />
              </Link>
            </Section>
          );
        })}
      </div>
      {!bills.length && (
        <Empty
          title="No statements in this view"
          description="Add an actual issued statement to begin tracking payments."
          onAdd={() => open({ type: "bill" })}
        />
      )}
    </>
  );
}
