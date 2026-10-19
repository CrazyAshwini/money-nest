"use client";

import Link from "next/link";
import { ArrowUpRight, Landmark } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  accountDetailView,
  type AccountDetailView,
} from "@/lib/account-detail-view";
import { resolveSelectedAccountId } from "@/lib/account-presentation";
import { formatDate, formatMoney, monthLabel } from "@/lib/finance";
import type { WorkspaceData } from "@/lib/types";
import { FinancialCardCarousel } from "./financial-card-carousel";
import { RecentAccountTransactions } from "./recent-account-transactions";
import { VirtualAccountCard } from "./virtual-account-card";
import "./financial-account-details.css";

type AccountKind = "bank" | "credit_card" | "pay_later";

const accountLabels: Record<AccountKind, string> = {
  bank: "Bank account",
  credit_card: "Credit card",
  pay_later: "Pay Later",
};

const money = (value: string | null | undefined, missing = "Not available") =>
  value == null ? missing : formatMoney(value);

const date = (value: string | null | undefined) =>
  value ? formatDate(value, { year: "numeric" }) : "Not recorded";

function Value({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div className="fac-value">
      <dt>{label}</dt>
      <dd>
        {children}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

function BankSummary({
  view,
  month,
}: {
  view: AccountDetailView;
  month: string;
}) {
  const balance = view.balance;
  const provenance =
    balance.currentSource === "opening"
      ? "Calculated from opening balance"
      : balance.currentSource === "snapshot"
        ? balance.movementsSinceSnapshot > 0
          ? "Report + posted movements"
          : "Reported balance"
        : "Balance not reported";
  return (
    <>
      <div className="fac-primary-balance">
        <span>Current balance</span>
        <strong>{money(balance.current)}</strong>
        <small>
          {provenance}
          {balance.currentAsOf ? ` · ${date(balance.currentAsOf)}` : ""}
        </small>
      </div>
      <dl className="fac-summary-grid">
        <Value label="Recorded credits" note={monthLabel(month)}>
          {money(view.monthly.credits)}
        </Value>
        <Value label="Recorded debits" note={monthLabel(month)}>
          {money(view.monthly.debits)}
        </Value>
        <Value label="Reported balance">
          {money(view.snapshot?.reportedBalance, "Not reported")}
        </Value>
        <Value label="Reporting baseline">
          {date(balance.currentBaselineAsOf)}
        </Value>
      </dl>
      <p className="fac-note">
        {view.monthly.count} posted movement
        {view.monthly.count === 1 ? "" : "s"} recorded in {monthLabel(month)}.
        Credits and debits include account transfers. Current balance is
        separate from the selected month’s activity.
      </p>
    </>
  );
}

export function FinancialAccountDetails({
  data,
  userId,
  month,
  today,
  kind,
  onClose,
}: {
  data: WorkspaceData;
  userId: string;
  month: string;
  today: string;
  kind: AccountKind;
  onClose: () => void;
}) {
  const accounts = data.accounts.filter(
    (account) =>
      account.userId === userId && account.active && account.kind === kind,
  );
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const selectedId = resolveSelectedAccountId(accounts, requestedId);
  const account = accounts.find((item) => item.id === selectedId);
  if (!account)
    return (
      <div className="fac-details fac-empty" data-kind={kind}>
        <Landmark size={30} aria-hidden="true" />
        <h3>
          No active{" "}
          {kind === "bank"
            ? "bank accounts"
            : kind === "credit_card"
              ? "credit cards"
              : "Pay Later accounts"}
        </h3>
        <p>Add an account to see its balance and recorded activity.</p>
      </div>
    );

  return (
    <div
      className="fac-details"
      data-kind={kind}
      data-selected-account={account.id}
    >
      <FinancialCardCarousel
        accounts={accounts}
        selectedId={selectedId}
        onSelect={setRequestedId}
        label={
          kind === "bank"
            ? "Bank accounts"
            : kind === "credit_card"
              ? "Credit cards"
              : "Pay Later providers"
        }
        renderCard={(card) => (
          <VirtualAccountCard
            account={card}
            data={data}
            today={today}
            onNavigate={onClose}
            showFinancialFacts={false}
          />
        )}
      />
      {kind === "bank" && (
        <section className="fac-summary" aria-label={`${account.name} summary`}>
          <div className="fac-section-heading">
            <div>
              <h3>Account summary</h3>
              <p>
                {account.name} ·{" "}
                {account.institution || "Institution not recorded"}
              </p>
            </div>
            <span className="fac-type-label">{accountLabels[kind]}</span>
          </div>
          <BankSummary
            view={accountDetailView(data, account, month, today)}
            month={month}
          />
          <Link
            href={`/accounts/${encodeURIComponent(account.id)}`}
            className="fac-link fac-manage-link"
            onClick={onClose}
          >
            Manage account <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </section>
      )}
      <RecentAccountTransactions
        data={data}
        accountId={account.id}
        limit={5}
        asOf={today}
        onNavigate={onClose}
      />
      {kind !== "bank" && (
        <div className="fac-account-action">
          <Link
            href={`/accounts/${encodeURIComponent(account.id)}`}
            className="fac-link fac-manage-link"
            onClick={onClose}
          >
            Manage account <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
