"use client";

import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Badge, Empty } from "../ui";
import { formatMoney, formatDate, emiSummary, sumMoney } from "@/lib/finance";
import type { Open } from "./types";
import { DetailHeading } from "./detail-heading";
import { kindLabel, formatOptional } from "./helpers";

export function LoansPage({
  id,
  calendar,
  open,
}: {
  id?: string;
  calendar?: boolean;
  open: Open;
}) {
  const { data, today } = useFinance();
  const loan = data.loans.find((l) => l.id === id);
  if (id && !loan)
    return (
      <>
        <Empty
          title="Loan not found"
          description="This loan is not available in your workspace."
        />
        <Link href="/loans" className="button">
          Return to loans
        </Link>
      </>
    );
  const loans = id ? data.loans.filter((l) => l.id === id) : data.loans;
  return (
    <>
      {loan && (
        <DetailHeading
          title={loan.name}
          subtitle={`${loan.lender} · ${loan.kind}`}
          back="/loans"
          action={
            <>
              <button
                className="button"
                onClick={() => open({ type: "loan", record: loan })}
              >
                Edit loan
              </button>
              <button
                className="button primary"
                onClick={() => open({ type: "emi", loan })}
              >
                <Plus size={15} />
                Add installment
              </button>
            </>
          }
        />
      )}
      <div className="list-toolbar">
        <div className="tabs">
          <Link href="/loans" className={!calendar ? "selected" : ""}>
            Loans
          </Link>
          <Link href="/emi-calendar" className={calendar ? "selected" : ""}>
            EMI calendar
          </Link>
        </div>
        <button className="button" onClick={() => open({ type: "loan" })}>
          <Plus size={15} />
          Add loan
        </button>
      </div>
      {!calendar && (
        <div className="bills-grid">
          {loans.map((l) => (
            <Section key={l.id} title={l.name} action={<Badge>{l.kind}</Badge>}>
              <div className="bill-values">
                <div>
                  <small>Original principal</small>
                  <strong>{formatOptional(l.contractualPrincipal)}</strong>
                </div>
                <div>
                  <small>Net disbursed</small>
                  <strong>{formatOptional(l.netDisbursed)}</strong>
                </div>
                <div>
                  <small>Reported outstanding</small>
                  <strong>{formatOptional(l.reportedOutstanding)}</strong>
                </div>
                <div>
                  <small>Scheduled repayments</small>
                  <strong>
                    {formatMoney(
                      sumMoney(
                        data.emis
                          .filter((e) => e.loanId === l.id)
                          .map((e) => e.amount),
                      ),
                    )}
                  </strong>
                </div>
              </div>
              <div className="panel-foot">
                <Link href={`/loans/${l.id}`} className="text-link">
                  View schedule <ChevronRight size={14} />
                </Link>
                <button
                  className="text-link"
                  onClick={() => open({ type: "loan", record: l })}
                >
                  Edit
                </button>
              </div>
            </Section>
          ))}
        </div>
      )}
      <Section
        title={calendar ? "Upcoming installments" : "Repayment schedule"}
        subtitle="Payments are confirmed only through linked ledger allocations."
      >
        <div className="record-list">
          {data.emis
            .filter((e) => !id || e.loanId === id)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            .map((e) => {
              const s = emiSummary(data, e.id, today);
              return (
                <div className="record-row" key={e.id}>
                  <span className="date-tile">
                    <small>
                      {new Date(e.dueDate + "T00:00:00").toLocaleDateString(
                        "en-GB",
                        { month: "short" },
                      )}
                    </small>
                    <strong>{e.dueDate.slice(-2)}</strong>
                  </span>
                  <span className="grow">
                    <strong>
                      {data.loans.find((l) => l.id === e.loanId)?.name} · #
                      {e.number}
                    </strong>
                    <small>
                      {formatDate(e.dueDate)} · {formatMoney(s.paid)} paid
                    </small>
                  </span>
                  <Badge
                    tone={
                      s.status === "paid"
                        ? "green"
                        : s.status === "overdue"
                          ? "red"
                          : "neutral"
                    }
                  >
                    {kindLabel(s.status)}
                  </Badge>
                  <strong>{formatMoney(s.remaining)}</strong>
                  <button
                    className="button small"
                    onClick={() => open({ type: "allocation", emi: e })}
                  >
                    Match payment
                  </button>
                </div>
              );
            })}
          {!data.emis.length && (
            <Empty
              title="No installments recorded"
              description="Open a loan to add its confirmed repayment schedule."
            />
          )}
        </div>
      </Section>
    </>
  );
}
