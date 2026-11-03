"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useFinance } from "./finance-provider";
import { RecordEditor, type EditorState } from "./editors";
import { AccountManagement } from "./account-management";
import { formatMoney } from "@/lib/finance";
import { accountUsage } from "@/lib/usage";
import type { AccountKind } from "@/lib/types";
export function ProfileAccounts() {
  const { data, userId, today } = useFinance();
  const params = useSearchParams();
  const selected = data.accounts.find(
    (a) => a.userId === userId && a.id === params.get("account"),
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const groups: { kind: AccountKind; label: string }[] = [
    { kind: "bank", label: "Bank Accounts" },
    { kind: "credit_card", label: "Credit Cards" },
    { kind: "pay_later", label: "Pay Later Accounts" },
    { kind: "wallet", label: "Wallets" },
  ];
  return (
    <section className="panel" aria-label="Financial account management">
      <div className="panel-head">
        <h2>Financial accounts</h2>
        <button
          className="button"
          onClick={() => setEditor({ type: "account" })}
        >
          Add account
        </button>
      </div>
      {groups.map((group) => (
        <details
          key={group.kind}
          open={
            selected?.kind === group.kind ||
            params.get("manage") === group.kind ||
            undefined
          }
        >
          <summary>{group.label}</summary>
          <div className="record-list">
            {data.accounts
              .filter((a) => a.userId === userId && a.kind === group.kind)
              .map((account) => {
                const usage =
                  group.kind === "bank" || group.kind === "wallet"
                    ? null
                    : accountUsage(data, account.id, today);
                return (
                  <div className="record-row" key={account.id}>
                    <span>
                      {account.name}
                      <small>
                        {account.active
                          ? account.institution
                          : "Archived · history retained"}
                        {usage &&
                          ` · Outstanding/used ${usage.used == null ? "unknown" : formatMoney(usage.used)} · Available ${usage.available == null ? "unknown" : formatMoney(usage.available)}`}
                      </small>
                    </span>
                    <button
                      className="text-link"
                      onClick={() =>
                        setEditor({ type: "account", record: account })
                      }
                    >
                      Edit / archive
                    </button>
                    <Link
                      className="text-link"
                      href={`/accounts/${account.id}`}
                    >
                      History
                    </Link>
                  </div>
                );
              })}
          </div>
        </details>
      ))}
      <Link className="text-link" href="/loans">
        Loans & Borrowings
      </Link>
      {selected && (
        <>
          <button
            className="button"
            onClick={() => setEditor({ type: "account", record: selected })}
          >
            Edit {selected.name}
          </button>
          <AccountManagement account={selected} onOpenEditor={setEditor} />
        </>
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
