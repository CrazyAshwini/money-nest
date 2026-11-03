"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, AlertCircle } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Empty, Badge } from "../ui";
import { formatDate } from "@/lib/finance";

export function NotificationsPage() {
  const { data, save, toast, today } = useFinance();
  const [savingReminderIds, setSavingReminderIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  return (
    <>
      <div className="info-banner">
        <AlertCircle size={18} />
        These are in-app reminders. Email and push delivery require a provider
        and explicit opt-in.
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Section
        title="Reminder preferences"
        subtitle={`Asia/Kolkata · ${formatDate(today)}`}
      >
        <div className="record-list">
          {data.reminders.map((r) => (
            <div className="record-row" key={r.id}>
              <span className="txn-icon">
                <CalendarDays size={19} />
              </span>
              <span className="grow">
                <strong>{r.title}</strong>
                <small>
                  {new Date(r.triggerAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  · {r.channel.replaceAll("_", " ")}
                </small>
              </span>
              <Badge>{r.state}</Badge>
              <button
                aria-label={`Toggle ${r.title}`}
                role="switch"
                aria-checked={r.enabled}
                aria-busy={savingReminderIds.includes(r.id)}
                className={`toggle ${r.enabled ? "on" : ""}`}
                disabled={
                  r.channel !== "in_app" || savingReminderIds.includes(r.id)
                }
                onClick={async () => {
                  if (savingReminderIds.includes(r.id)) return;
                  setSavingReminderIds((current) => [...current, r.id]);
                  setError("");
                  try {
                    await save(
                      "reminders",
                      { ...r, enabled: !r.enabled },
                      { expectedUpdatedAt: r.updatedAt ?? null },
                    );
                    toast(
                      r.enabled
                        ? "Reminder disabled."
                        : "In-app reminder enabled.",
                    );
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "The reminder could not be saved. Please try again.",
                    );
                  } finally {
                    setSavingReminderIds((current) =>
                      current.filter((id) => id !== r.id),
                    );
                  }
                }}
              >
                <span />
              </button>
            </div>
          ))}
          {!data.reminders.length && (
            <Empty
              title="Nothing scheduled"
              description="Reminders will appear here once they are added to bills or installments."
            />
          )}
        </div>
      </Section>
      <Section title="Needs your attention">
        <div className="record-list">
          {data.transactions
            .filter((t) => t.status === "pending_review")
            .map((t) => (
              <Link className="record-row" key={t.id} href="/transactions">
                <span className="grow">
                  <strong>{t.description}</strong>
                  <small>
                    {!t.occurredOn
                      ? "Purchase date missing"
                      : !t.fromAccountId && !t.toAccountId
                        ? "Account not confirmed"
                        : "Review source, category or repayment details"}
                  </small>
                </span>
                <Badge tone="amber">Needs review</Badge>
                <ArrowUpRight size={15} />
              </Link>
            ))}
        </div>
      </Section>
    </>
  );
}
