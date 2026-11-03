"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  Clock,
  CreditCard,
  Landmark,
  Plus,
  Wallet,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { RecordEditor, type EditorState } from "./editors";
import { AccountManagement } from "./account-management";
import { formatMoney } from "@/lib/finance";
import { accountUsage } from "@/lib/usage";
import type { AccountKind } from "@/lib/types";
import styles from "./profile-accounts.module.css";

export function ProfileAccounts() {
  const { data, userId, today } = useFinance();
  const params = useSearchParams();
  const selected = data.accounts.find(
    (a) => a.userId === userId && a.id === params.get("account"),
  );
  const [editor, setEditor] = useState<EditorState | null>(null);

  const groups: {
    kind: AccountKind;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  }[] = [
    { kind: "bank", label: "Bank Accounts", icon: Landmark },
    { kind: "credit_card", label: "Credit Cards", icon: CreditCard },
    { kind: "pay_later", label: "Pay Later Accounts", icon: Clock },
    { kind: "wallet", label: "Wallets", icon: Wallet },
  ];

  return (
    <section className={styles.panel} aria-label="Financial account management">
      <div className={styles.header}>
        <h2 id="profile-accounts-heading">Financial accounts</h2>
        <button
          className={styles.addButton}
          type="button"
          onClick={() => setEditor({ type: "account" })}
        >
          <Plus size={14} aria-hidden="true" />
          <span>Add account</span>
        </button>
      </div>

      <div className={styles.groupsList}>
        {groups.map((group) => {
          const groupAccounts = data.accounts.filter(
            (a) => a.userId === userId && a.kind === group.kind,
          );
          return (
            <details
              key={group.kind}
              className={styles.accordion}
              open={
                selected?.kind === group.kind ||
                params.get("manage") === group.kind ||
                undefined
              }
            >
              <summary className={styles.summary}>
                <div className={styles.summaryLeft}>
                  <span className={styles.groupIcon} aria-hidden="true">
                    <group.icon size={16} />
                  </span>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <span className={styles.countBadge}>
                    {groupAccounts.length}
                  </span>
                </div>
                <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
              </summary>

              <div className={styles.accountsContainer}>
                {groupAccounts.length === 0 ? (
                  <p className={styles.emptyState}>No {group.label.toLowerCase()} linked</p>
                ) : (
                  groupAccounts.map((account) => {
                    const usage =
                      group.kind === "bank" || group.kind === "wallet"
                        ? null
                        : accountUsage(data, account.id, today);
                    return (
                      <div className={styles.accountRow} key={account.id}>
                        <div className={styles.accountInfo}>
                          <span className={styles.accountName}>{account.name}</span>
                          <span className={styles.accountMeta}>
                            {account.active
                              ? account.institution
                              : "Archived · history retained"}
                            {usage &&
                              ` · Outstanding/used ${usage.used == null ? "unknown" : formatMoney(usage.used)} · Available ${usage.available == null ? "unknown" : formatMoney(usage.available)}`}
                          </span>
                        </div>
                        <div className={styles.accountActions}>
                          <button
                            className={styles.actionButton}
                            type="button"
                            onClick={() =>
                              setEditor({ type: "account", record: account })
                            }
                          >
                            Edit / archive
                          </button>
                          <Link
                            className={styles.actionButton}
                            href={`/accounts/${account.id}`}
                          >
                            History
                          </Link>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </details>
          );
        })}
      </div>

      {selected && (
        <div className={styles.selectedManage}>
          <button
            className="button"
            type="button"
            onClick={() => setEditor({ type: "account", record: selected })}
          >
            Edit {selected.name}
          </button>
          <AccountManagement account={selected} onOpenEditor={setEditor} />
        </div>
      )}

      {editor && (
        <RecordEditor
          key={JSON.stringify(editor)}
          editor={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
