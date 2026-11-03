"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FinancialCardCarousel } from "../financial-card-carousel";
import { VirtualAccountCard } from "../virtual-account-card";
import { AccountManagement } from "../account-management";
import { ownedAnalyticsData } from "@/lib/analytics-presentation";
import { RecentAccountTransactions } from "../recent-account-transactions";
import { resolveSelectedAccountId } from "@/lib/account-presentation";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Empty } from "../ui";
import { formatMoney } from "@/lib/finance";
import { type Account, type WorkspaceData } from "@/lib/types";
import type { Open } from "./types";

export function AccountsPage({
  id,
  onlyPayLater,
  open,
}: {
  id?: string;
  onlyPayLater?: boolean;
  open: Open;
}) {
  const { data: workspace, today, userId } = useFinance();
  const data = useMemo(
    () => ownedAnalyticsData(workspace, userId),
    [workspace, userId],
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState("all");
  const a = data.accounts.find((a) => a.id === id && a.userId === userId);
  if (id && !a)
    return (
      <>
        <Empty
          title="Account not found"
          description="It may have been archived or belongs to another workspace."
        />
        <Link href="/accounts" className="button">
          Return to accounts
        </Link>
      </>
    );
  if (a) {
    if (searchParams.get("manage") === "reports")
      return <AccountManagement account={a} onOpenEditor={open} />;
    const accounts = data.accounts.filter(
      (account) =>
        account.userId === userId &&
        account.kind === a.kind &&
        (account.active || account.id === a.id),
    );
    return (
      <div className="account-details-page">
        <Link href="/accounts" className="account-page-back">
          <ChevronLeft size={18} aria-hidden="true" /> Back
        </Link>
        <h1 className="sr-only">Account details</h1>
        <div className="account-group-panel account-detail-panel">
          <FinancialCardCarousel
            accounts={accounts}
            selectedId={a.id}
            onSelect={(nextId) =>
              router.replace(`/accounts/${encodeURIComponent(nextId)}`, {
                scroll: false,
              })
            }
            label={
              a.kind === "bank"
                ? "Bank accounts"
                : a.kind === "credit_card"
                  ? "Credit cards"
                  : a.kind === "pay_later"
                    ? "Pay Later accounts"
                    : "Wallets"
            }
            presentation="accounts"
            renderCard={(account) => (
              <VirtualAccountCard
                account={account}
                data={data}
                today={today}
                onEdit={(selected) =>
                  open({ type: "account", record: selected })
                }
              />
            )}
          />
          {data.loans.some((l) => l.repaymentAccountId === a.id) && (
            <Section
              title="Active EMI purchases"
              action={
                <Link href="/loans" className="text-link">
                  All loans & EMIs <ChevronRight size={14} />
                </Link>
              }
            >
              <div className="record-list">
                {data.loans
                  .filter((l) => l.repaymentAccountId === a.id)
                  .map((l) => (
                    <div className="record-row" key={l.id}>
                      <span className="grow">
                        <strong>{l.name}</strong>
                        <small>{l.notes || l.lender}</small>
                      </span>
                      <strong>
                        {formatMoney(l.contractualPrincipal || "0")}
                      </strong>
                      <Link href={`/loans/${l.id}`} className="button small">
                        Schedule
                      </Link>
                    </div>
                  ))}
              </div>
            </Section>
          )}
          <RecentAccountTransactions
            data={data}
            accountId={a.id}
            limit={5}
            variant="grouped"
            title="Statement history"
            onOpenTransaction={(transaction) =>
              open({ type: "transaction", record: transaction })
            }
          />
        </div>
      </div>
    );
  }
  const visibleAccounts = data.accounts.filter(
    (account) =>
      account.userId === userId &&
      (onlyPayLater
        ? account.kind === "pay_later"
        : kind === "all" || account.kind === kind),
  );
  const groups: { kind: Account["kind"]; label: string }[] = [
    { kind: "bank", label: "Bank accounts" },
    { kind: "credit_card", label: "Credit cards" },
    { kind: "pay_later", label: "Pay Later accounts" },
    { kind: "wallet", label: "Wallets" },
  ];
  const activeAccounts = visibleAccounts.filter((account) => account.active);
  const archivedAccounts = visibleAccounts.filter((account) => !account.active);
  const shownGroups = groups.filter((group) =>
    onlyPayLater
      ? group.kind === "pay_later"
      : kind === "all" || group.kind === kind,
  );
  return (
    <div className="accounts-overview">
      {!onlyPayLater && (
        <div
          className="account-kind-tabs"
          role="group"
          aria-label="Account kind"
        >
          {[
            { id: "all", label: "All" },
            { id: "bank", label: "Bank" },
            { id: "credit_card", label: "Cards" },
            { id: "pay_later", label: "Pay Later" },
            { id: "wallet", label: "Wallet" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={kind === item.id}
              className={kind === item.id ? "selected" : ""}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {shownGroups
        .filter(
          (group) =>
            kind !== "all" ||
            onlyPayLater ||
            activeAccounts.some((account) => account.kind === group.kind),
        )
        .map((group) => (
          <AccountGroup
            key={group.kind}
            label={group.label}
            open={open}
            data={data}
            today={today}
            accounts={activeAccounts.filter(
              (account) => account.kind === group.kind,
            )}
          />
        ))}
      {activeAccounts.length === 0 && kind === "all" && !onlyPayLater && (
        <Empty
          title="No active accounts"
          description="Add a bank, wallet, credit card or Pay Later provider. Archived accounts remain available below."
        />
      )}
      {archivedAccounts.length > 0 && (
        <details className="archived-accounts">
          <summary>Archived accounts ({archivedAccounts.length})</summary>
          {shownGroups
            .filter((group) =>
              archivedAccounts.some((account) => account.kind === group.kind),
            )
            .map((group) => (
              <AccountGroup
                key={group.kind}
                label={`Archived ${group.label.toLowerCase()}`}
                open={open}
                data={data}
                today={today}
                accounts={archivedAccounts.filter(
                  (account) => account.kind === group.kind,
                )}
              />
            ))}
        </details>
      )}
    </div>
  );
}

function AccountGroup({
  accounts,
  label,
  open,
  data,
  today,
}: {
  accounts: Account[];
  label: string;
  open: Open;
  data: WorkspaceData;
  today: string;
}) {
  const [selection, setSelection] = useState<string | null>(null);
  const selectedId = resolveSelectedAccountId(accounts, selection);
  return (
    <div className="account-group-panel">
      <FinancialCardCarousel
        accounts={accounts}
        selectedId={selectedId}
        onSelect={setSelection}
        label={label}
        presentation="accounts"
        renderCard={(account) => (
          <VirtualAccountCard
            account={account}
            data={data}
            today={today}
            onEdit={(selected) => open({ type: "account", record: selected })}
          />
        )}
      />
      {selectedId && (
        <RecentAccountTransactions
          data={data}
          accountId={selectedId}
          limit={4}
          variant="grouped"
          onOpenTransaction={(transaction) =>
            open({ type: "transaction", record: transaction })
          }
        />
      )}
    </div>
  );
}
