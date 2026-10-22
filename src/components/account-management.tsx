"use client";

import { ArrowUpRight, ChevronLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ownedAnalyticsData } from "@/lib/analytics-presentation";
import { accountDetailView } from "@/lib/account-detail-view";
import { formatDate, formatMoney, isDebtAccount } from "@/lib/finance";
import type { Account } from "@/lib/types";
import { AccountStatementDetails } from "./account-statement-details";
import type { EditorState } from "./editors";
import { useFinance } from "./finance-provider";
import { Section } from "./ui";
import "./account-management.css";

const money = (value: string | null, missing = "Not available") =>
  value === null ? missing : formatMoney(value);

const date = (value: string | null | undefined) =>
  value ? formatDate(value, { year: "numeric" }) : "Not recorded";

/** Optional account tools retain reports and audit details off the primary card view. */
export function AccountManagement({
  account,
  onOpenEditor,
}: {
  account: Account;
  onOpenEditor: (editor: EditorState) => void;
}) {
  const { data: workspace, userId, month, today } = useFinance();
  const data = useMemo(
    () => ownedAnalyticsData(workspace, userId),
    [workspace, userId],
  );
  const ownedAccount = data.accounts.find(
    (item) => item.id === account.id && item.userId === userId,
  );
  if (!ownedAccount) return null;

  const view = accountDetailView(data, ownedAccount, month, today);
  const balance = view.balance;
  const statements = data.bills
    .filter(
      (bill) => bill.userId === userId && bill.accountId === ownedAccount.id,
    )
    .sort(
      (left, right) =>
        right.statementDate.localeCompare(left.statementDate) ||
        left.id.localeCompare(right.id),
    );
  const pledgedDeposits = data.fixedDeposits.filter(
    (deposit) =>
      deposit.userId === userId && deposit.backingAccountId === ownedAccount.id,
  );

  return (
    <div className="account-management" data-account-id={ownedAccount.id}>
      <Link
        href={`/accounts/${encodeURIComponent(ownedAccount.id)}`}
        className="account-management-back"
      >
        <ChevronLeft size={18} aria-hidden="true" />
        Back to account
      </Link>
      <header className="account-management-heading">
        <h1>Statements and reports</h1>
        <p>{ownedAccount.name}</p>
      </header>
      <div
        className="account-management-actions"
        role="group"
        aria-label="Account management actions"
      >
        <button
          type="button"
          className="button"
          onClick={() =>
            onOpenEditor({ type: "snapshot", record: ownedAccount })
          }
        >
          <Plus size={15} aria-hidden="true" />
          Update reported balance
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onOpenEditor({ type: "bill" })}
        >
          <Plus size={15} aria-hidden="true" />
          Add statement
        </button>
        {isDebtAccount(ownedAccount) && (
          <button
            type="button"
            className="button"
            onClick={() =>
              onOpenEditor({ type: "transaction", kind: "bill_payment" })
            }
          >
            Record repayment
          </button>
        )}
      </div>

      <section
        className="account-management-reconciliation"
        aria-label={`${ownedAccount.name} balance reconciliation`}
      >
        <h2>Balance reconciliation</h2>
        <dl>
          <div>
            <dt>Reported balance / outstanding</dt>
            <dd>{money(balance.reported, "Not recorded")}</dd>
          </div>
          <div>
            <dt>Calculated ledger balance</dt>
            <dd>{money(balance.calculated)}</dd>
          </div>
          <div>
            <dt>Reconciliation difference</dt>
            <dd>{money(balance.difference)}</dd>
          </div>
        </dl>
        <p>
          {balance.asOf
            ? `Reconciled at the report date · ${date(balance.asOf)}.`
            : "A reported balance and complete opening history are needed for reconciliation."}
          {view.snapshot &&
            ` Source: ${view.snapshot.source.replaceAll("_", " ")}. Reported values apply to their recorded date.`}
        </p>
      </section>

      {view.usage && <AccountStatementDetails view={view} />}

      <Section
        title="Statement records"
        className="account-management-statements"
        action={
          <Link href="/bills" className="text-link">
            All statements <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        }
      >
        {statements.length ? (
          <ul>
            {statements.map((bill) => (
              <li key={bill.id}>
                <div>
                  <strong>{date(bill.statementDate)}</strong>
                  <span>
                    Recorded statement · {formatMoney(bill.statementAmount)}
                  </span>
                  <small>Payment due · {date(bill.dueDate)}</small>
                </div>
                <Link href={`/bills/${encodeURIComponent(bill.id)}`}>
                  Review statement
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="account-management-empty">
            No statements recorded for this account. A current balance does not
            establish a statement.
          </p>
        )}
      </Section>

      {pledgedDeposits.length > 0 && (
        <Section
          title="Linked deposits"
          className="account-management-deposits"
        >
          <ul>
            {pledgedDeposits.map((deposit) => (
              <li key={deposit.id}>
                <Link
                  href={`/fixed-deposits/${encodeURIComponent(deposit.id)}`}
                >
                  {deposit.name}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
