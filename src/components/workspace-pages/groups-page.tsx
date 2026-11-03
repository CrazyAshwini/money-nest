"use client";

import { useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { Plus, Users, ArrowUpRight } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Empty, Badge, Field, Modal } from "../ui";
import { type EditorState } from "../editors";
import { formatMoney, formatDate, groupSummary, sumMoney } from "@/lib/finance";

export function GroupsPage({
  id,
  open,
}: {
  id?: string;
  open: (e: EditorState) => void;
}) {
  const { data, userId, save, toast } = useFinance();
  const [dialog, setDialog] = useState<"share" | "settlement" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const group = data.groups.find((g) => g.id === id);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!group || busy) return;
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      const participant = String(f.get("participant") || "").trim();
      const value = String(f.get("amount") || "");
      if (!/^\d+(\.\d{1,2})?$/.test(value) || new Decimal(value).lte(0))
        throw new Error("Enter a positive amount with at most two decimals.");
      const amount = new Decimal(value).toFixed(2);
      const base = { id: crypto.randomUUID(), userId };
      if (dialog === "share") {
        const total = sumMoney(
          data.shares
            .filter((s) => s.groupId === group.id)
            .map((s) => s.amount),
        );
        if (new Decimal(total).plus(amount).gt(group.totalCost))
          throw new Error("Shares cannot exceed the actual group expense.");
        await save("shares", {
          ...base,
          groupId: group.id,
          participant,
          amount,
          isOwner: f.get("isOwner") === "on",
        });
      } else {
        const t = data.transactions.find(
          (t) => t.id === String(f.get("transactionId")),
        );
        if (
          !t ||
          t.status !== "posted" ||
          !["transfer", "refund"].includes(t.kind)
        )
          throw new Error("Choose an existing posted transfer or refund.");
        const used = sumMoney(
          data.settlements
            .filter((s) => s.transactionId === t.id)
            .map((s) => s.amount),
        );
        if (new Decimal(used).plus(amount).gt(t.amount))
          throw new Error(
            "Settlements cannot exceed the linked bank movement.",
          );
        const direction = String(f.get("direction")) as "incoming" | "outgoing";
        if (
          (direction === "incoming" && !t.toAccountId) ||
          (direction === "outgoing" && !t.fromAccountId)
        )
          throw new Error("Payment direction does not match this transaction.");
        await save("settlements", {
          ...base,
          groupId: group.id,
          transactionId: t.id,
          counterparty: participant,
          direction,
          amount,
        });
      }
      setDialog(null);
      toast("Shared expense updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  if (id && !group)
    return (
      <>
        <Link href="/split-bills" className="text-link">
          ← All shared expenses
        </Link>
        <Empty
          title="Group not found"
          description="This shared expense is no longer available."
        />
      </>
    );
  if (group) {
    const s = groupSummary(data, group.id);
    return (
      <>
        <Link href="/split-bills" className="text-link">
          ← All shared expenses
        </Link>
        <div className="detail-heading">
          <div>
            <h2>{group.title}</h2>
            <p>
              {formatDate(group.occurredOn)} · {group.merchant} · Paid by{" "}
              {group.paidBy}
            </p>
            {s.isContributionPool && (
              <Badge tone="blue">Contribution pool</Badge>
            )}
          </div>
          <div className="page-actions">
            <button
              className="button"
              onClick={() => {
                setError("");
                setDialog("share");
              }}
            >
              <Plus size={15} />
              Add person / share
            </button>
            <button
              className="button primary"
              onClick={() => {
                setError("");
                setDialog("settlement");
              }}
            >
              Match contribution
            </button>
          </div>
        </div>
        <div className="three-stats">
          <div className="stat">
            <span>
              {s.isContributionPool ? "Known payments" : "Total purchase"}
            </span>
            <strong>{formatMoney(s.total)}</strong>
            <small>
              {s.isContributionPool
                ? "Payments recorded in the source"
                : "Original expense, counted once"}
            </small>
          </div>
          <div className="stat">
            <span>Your share</span>
            <strong>
              {s.ownerShareKnown ? formatMoney(s.ownerShare) : "Unknown"}
            </strong>
            <small>
              {s.isContributionPool
                ? "Confirm your personal cost before splitting"
                : `${formatMoney(s.unallocated)} not yet split`}
            </small>
          </div>
          <div className="stat">
            <span>
              {s.isContributionPool
                ? "Pool remaining"
                : "Unmatched contributions"}
            </span>
            <strong>
              {formatMoney(s.poolRemaining ?? s.unmatchedContributions)}
            </strong>
            <small>
              {s.isContributionPool
                ? `${formatMoney(s.incoming)} received · ${formatMoney(s.outgoing)} returned`
                : "Kept separate from income"}
            </small>
          </div>
        </div>
        {s.isContributionPool && (
          <p className="form-note">
            Contributions are kept separate from income. The remaining pool is
            unallocated money, and does not establish your personal cost or a
            profit.
          </p>
        )}
        <Section title="People & shares">
          <div className="record-list">
            {!data.shares.some((x) => x.groupId === group.id) && (
              <p className="inline-empty">
                Personal shares have not been confirmed.
              </p>
            )}
            {data.shares
              .filter((x) => x.groupId === group.id)
              .map((x) => (
                <div key={x.id} className="record-row">
                  <span className="avatar">{x.participant[0]}</span>
                  <strong className="grow">
                    {x.participant}
                    {x.isOwner ? " (you)" : ""}
                  </strong>
                  <strong>{formatMoney(x.amount)}</strong>
                </div>
              ))}
          </div>
        </Section>
        <Section title="Matched contributions & payouts">
          <div className="record-list">
            {data.settlements
              .filter((x) => x.groupId === group.id)
              .map((x) => (
                <div key={x.id} className="record-row">
                  <span className="grow">
                    <strong>{x.counterparty}</strong>
                    <small>
                      {
                        data.transactions.find((t) => t.id === x.transactionId)
                          ?.description
                      }
                    </small>
                  </span>
                  <Badge>{x.direction}</Badge>
                  <strong>{formatMoney(x.amount)}</strong>
                </div>
              ))}
          </div>
        </Section>
        {dialog && (
          <Modal
            title={
              dialog === "share"
                ? "Add a participant share"
                : "Match a real contribution"
            }
            onClose={() => setDialog(null)}
            busy={busy}
          >
            <form className="editor-form" onSubmit={submit}>
              <div className="form-grid">
                <Field label="Participant">
                  {" "}
                  <input name="participant" required />
                </Field>
                <Field label="Amount · ₹">
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </Field>
                {dialog === "share" ? (
                  <Field label="Ownership">
                    <span className="check-row">
                      <input type="checkbox" name="isOwner" />
                      This is my share
                    </span>
                  </Field>
                ) : (
                  <>
                    <Field label="Existing ledger movement" className="full">
                      <select name="transactionId" required>
                        <option value="">Choose a transaction</option>
                        {data.transactions
                          .filter(
                            (t) =>
                              t.status === "posted" &&
                              (t.kind === "transfer" || t.kind === "refund"),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.description} · ₹{t.amount}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Direction">
                      <select name="direction">
                        <option value="incoming">Received by me</option>
                        <option value="outgoing">Paid by me</option>
                      </select>
                    </Field>
                  </>
                )}
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setDialog(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={busy}>
                  {busy
                    ? "Saving…"
                    : dialog === "share"
                      ? "Save share"
                      : "Save match"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </>
    );
  }
  return (
    <>
      <div className="list-toolbar">
        <p className="muted">Shared memories. Clear balances.</p>
        <button className="button" onClick={() => open({ type: "group" })}>
          <Plus size={16} />
          Create shared expense
        </button>
      </div>
      <div className="bills-grid">
        {data.groups.map((g) => {
          const s = groupSummary(data, g.id);
          return (
            <Section key={g.id} title={g.title} action={<Users size={18} />}>
              <p className="muted">
                {g.merchant} · {formatDate(g.occurredOn)}
              </p>
              {s.isContributionPool && (
                <Badge tone="blue">Contribution pool</Badge>
              )}
              <div className="bill-values">
                <div>
                  <small>
                    {s.isContributionPool ? "Known payments" : "Total expense"}
                  </small>
                  <strong>{formatMoney(s.total)}</strong>
                </div>
                <div>
                  <small>Your share</small>
                  <strong>
                    {s.ownerShareKnown ? formatMoney(s.ownerShare) : "Unknown"}
                  </strong>
                </div>
                <div>
                  <small>Contributions received</small>
                  <strong>{formatMoney(s.incoming)}</strong>
                </div>
                <div>
                  <small>
                    {s.isContributionPool
                      ? "Pool remaining"
                      : "Unallocated shares"}
                  </small>
                  <strong>
                    {formatMoney(s.poolRemaining ?? s.unallocated)}
                  </strong>
                </div>
              </div>
              <Link href={`/split-bills/${g.id}`} className="panel-foot">
                View people & settlements <ArrowUpRight size={15} />
              </Link>
            </Section>
          );
        })}
      </div>
      {!data.groups.length && (
        <Empty
          title="Share the experience"
          description="Link an existing purchase, split the cost, and match real contributions."
          onAdd={() => open({ type: "group" })}
        />
      )}
    </>
  );
}
