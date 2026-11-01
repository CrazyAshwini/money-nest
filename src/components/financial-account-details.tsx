"use client";

import Link from "next/link";
import { ArrowUpRight, Landmark } from "lucide-react";
import { useState } from "react";
import { resolveSelectedAccountId } from "@/lib/account-presentation";
import type { WorkspaceData } from "@/lib/types";
import { FinancialCardCarousel } from "./financial-card-carousel";
import { RecentAccountTransactions } from "./recent-account-transactions";
import { VirtualAccountCard } from "./virtual-account-card";
import "./financial-account-details.css";

type AccountKind = "bank" | "credit_card" | "pay_later";

export function FinancialAccountDetails({
  data,
  userId,
  today,
  kind,
  onClose,
}: {
  data: WorkspaceData;
  userId: string;
  month?: string;
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
          />
        )}
      />
      <RecentAccountTransactions
        data={data}
        accountId={account.id}
        limit={5}
        asOf={today}
        onNavigate={onClose}
      />
      <div className="fac-account-action">
        <Link
          href={`/accounts/${encodeURIComponent(account.id)}`}
          className="fac-link fac-manage-link"
          onClick={onClose}
        >
          Manage account <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
