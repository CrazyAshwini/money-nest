"use client";

import Link from "next/link";
import { Plus, ArrowUpRight, ChevronRight } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Badge, Empty } from "../ui";
import { formatMoney, formatDate } from "@/lib/finance";
import type { Open } from "./types";
import { DetailHeading } from "./detail-heading";
import { formatOptional } from "./helpers";

export function DepositsPage({ id, open }: { id?: string; open: Open }) {
  const { data } = useFinance();
  const fd = data.fixedDeposits.find((f) => f.id === id);
  if (id && !fd)
    return (
      <>
        <Empty
          title="Deposit not found"
          description="This deposit is not available in your workspace."
        />
        <Link href="/fixed-deposits" className="button">
          Return to fixed deposits
        </Link>
      </>
    );
  const rows = id
    ? data.fixedDeposits.filter((f) => f.id === id)
    : data.fixedDeposits;
  return (
    <>
      {fd && (
        <DetailHeading
          title={fd.name}
          subtitle={fd.institution}
          back="/fixed-deposits"
          action={
            <button
              className="button"
              onClick={() => open({ type: "fd", record: fd })}
            >
              Edit deposit
            </button>
          }
        />
      )}
      <div className="list-toolbar">
        <p className="muted">
          Pledged deposits are assets, and are excluded from available bank
          cash.
        </p>
        <button className="button" onClick={() => open({ type: "fd" })}>
          <Plus size={15} />
          Add deposit
        </button>
      </div>
      <div className="bills-grid">
        {rows.map((f) => (
          <Section
            key={f.id}
            title={f.name}
            action={
              <Badge
                tone={
                  f.pledged == null ? "neutral" : f.pledged ? "blue" : "green"
                }
              >
                {f.pledged == null
                  ? "Pledge unconfirmed"
                  : f.pledged
                    ? "Pledged"
                    : "Standalone"}
              </Badge>
            }
          >
            <p className="muted">
              {f.institution} · ••{f.maskedSuffix}
            </p>
            {(!f.openingDate || !f.maturityDate) && (
              <p className="muted">
                Contract dates remain unconfirmed until the deposit advice is
                available.
              </p>
            )}
            <div className="bill-values">
              <div>
                <small>Principal</small>
                <strong>{formatMoney(f.principal)}</strong>
              </div>
              <div>
                <small>Stated maturity value</small>
                <strong>{formatOptional(f.maturityAmount)}</strong>
              </div>
              <div>
                <small>Annual rate</small>
                <strong>
                  {f.annualRate ? `${f.annualRate}%` : "Unconfirmed"}
                </strong>
              </div>
              <div>
                <small>Opened on</small>
                <strong>{formatDate(f.openingDate)}</strong>
              </div>
              <div>
                <small>Matures on</small>
                <strong className="due-date">
                  {formatDate(f.maturityDate)}
                </strong>
              </div>
            </div>
            {f.backingAccountId && (
              <Link
                href={`/accounts/${f.backingAccountId}`}
                className="info-banner"
              >
                Backs{" "}
                {data.accounts.find((a) => a.id === f.backingAccountId)?.name}
                <ArrowUpRight size={14} />
              </Link>
            )}
            <div className="panel-foot">
              <Link className="text-link" href={`/fixed-deposits/${f.id}`}>
                View deposit <ChevronRight size={14} />
              </Link>
              <button
                className="text-link"
                onClick={() => open({ type: "fd", record: f })}
              >
                Edit
              </button>
            </div>
          </Section>
        ))}
      </div>
      {!rows.length && (
        <Empty
          title="A place for future plans"
          description="Add a fixed deposit and its actual maturity details."
          onAdd={() => open({ type: "fd" })}
        />
      )}
    </>
  );
}
