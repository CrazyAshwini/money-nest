"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFinance } from "./finance-provider";
import { Modal, Field, Section, Badge, Empty } from "./ui";
import {
  formatDate,
  formatMoney,
  latestAccountBalanceSnapshot,
  localDateISO,
  sumMoney,
} from "@/lib/finance";
import {
  personalLoanSummary,
  type PersonalLoanCommand,
} from "@/lib/personal-loans";
import type { Loan, Transaction } from "@/lib/types";

export function PersonalLoans({ id }: { id?: string }) {
  const { data, userId, today, commitPersonalLoan, toast } = useFinance();
  const loans = data.loans.filter(
    (l) => l.userId === userId && l.ledgerManaged,
  );
  const [draft, setDraft] = useState<{
    loan?: Loan;
    direction?: "lent" | "borrowed";
    reversal?: Transaction;
  } | null>(null);
  const [ids, setIds] = useState({ id: "", interestId: "", loanId: "" });
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today);
  const [included, setIncluded] = useState("");
  const snapshot = latestAccountBalanceSnapshot(data, accountId, date);
  const sameDay = snapshot && localDateISO(snapshot.asOf) === date;
  function open(value: NonNullable<typeof draft>) {
    setIds({
      id: crypto.randomUUID(),
      interestId: crypto.randomUUID(),
      loanId: value.loan?.id ?? crypto.randomUUID(),
    });
    setError("");
    setIncluded("");
    setDate(today);
    dirty.current = false;
    setAccountId(
      value.reversal?.fromAccountId ?? value.reversal?.toAccountId ?? "",
    );
    setDraft(value);
  }
  function close() {
    if (
      !saving.current &&
      (!dirty.current || window.confirm("Discard unsaved loan details?"))
    )
      setDraft(null);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving.current) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const command: PersonalLoanCommand = {
        ...ids,
        action: draft.reversal ? "reverse" : draft.loan ? "repay" : "create",
        direction: draft.direction,
        person: value("person") || undefined,
        amount: draft.reversal?.amount ?? value("amount"),
        interest: value("interest") || "0.00",
        occurredOn: date,
        accountId,
        notes: value("notes"),
        dueDate: value("dueDate") || null,
        interestTerms: value("interestTerms") || undefined,
        reversesTransactionId: draft.reversal?.id,
        balanceSnapshotId: sameDay ? snapshot.id : null,
        balanceIncluded: included ? included === "yes" : undefined,
      };
      await commitPersonalLoan(command);
      dirty.current = false;
      setDraft(null);
      toast("Loan event saved.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Loan event could not be saved.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {!id && (
        <>
          <div className="bill-values">
            <div>
              <small>To Receive</small>
              <strong>
                {formatMoney(
                  sumMoney(
                    loans
                      .filter((l) => l.kind === "lent")
                      .map(
                        (l) => personalLoanSummary(data, l, today).outstanding,
                      ),
                  ),
                )}
              </strong>
            </div>
            <div>
              <small>To Repay</small>
              <strong>
                {formatMoney(
                  sumMoney(
                    loans
                      .filter((l) => l.kind === "borrowed")
                      .map(
                        (l) => personalLoanSummary(data, l, today).outstanding,
                      ),
                  ),
                )}
              </strong>
            </div>
          </div>
          <div className="list-toolbar">
            <button
              className="button primary"
              onClick={() => open({ direction: "lent" })}
            >
              Give Loan
            </button>
            <button
              className="button"
              onClick={() => open({ direction: "borrowed" })}
            >
              Borrow Money
            </button>
          </div>
        </>
      )}
      {!loans.length && !id && (
        <Empty
          title="No personal loans yet"
          description="Track money lent or borrowed separately from gifts and shared purchases."
        />
      )}
      <div className="bills-grid">
        {loans
          .filter((l) => !id || l.id === id)
          .map((loan) => {
            const summary = personalLoanSummary(data, loan, today);
            return (
              <Section
                key={loan.id}
                title={loan.name}
                action={<Badge>{summary.status}</Badge>}
              >
                <p>
                  {loan.kind === "lent" ? "Loan given" : "Money borrowed"} ·{" "}
                  {formatDate(loan.disbursedOn)}
                </p>
                <div className="bill-values">
                  <div>
                    <small>Original principal</small>
                    <strong>{formatMoney(summary.principal)}</strong>
                  </div>
                  <div>
                    <small>Repaid</small>
                    <strong>{formatMoney(summary.repaid)}</strong>
                  </div>
                  <div>
                    <small>Outstanding principal</small>
                    <strong>{formatMoney(summary.outstanding)}</strong>
                  </div>
                  <div>
                    <small>Due date</small>
                    <strong>
                      {loan.dueDate ? formatDate(loan.dueDate) : "Not set"}
                    </strong>
                  </div>
                </div>
                {loan.notes && <p>{loan.notes}</p>}
                {loan.interestTerms && (
                  <p>Interest terms (informational): {loan.interestTerms}</p>
                )}
                <div className="panel-foot">
                  <Link
                    className="text-link"
                    href={id ? "/loans" : `/loans/${loan.id}`}
                  >
                    {id ? "All loans" : "View history"}
                  </Link>
                  {summary.status !== "Settled" && (
                    <button className="button" onClick={() => open({ loan })}>
                      Record Repayment
                    </button>
                  )}
                </div>
                {id && (
                  <div className="record-list">
                    {summary.events.map((t) => (
                      <div className="record-row" key={t.id}>
                        <span>
                          {t.description}
                          <small>
                            {formatDate(t.occurredOn)} · {t.notes}
                          </small>
                        </span>
                        <strong>{formatMoney(t.amount)}</strong>
                        {t.loanEvent === "repayment" &&
                          !summary.events.some(
                            (r) => r.reversesTransactionId === t.id,
                          ) && (
                            <button
                              className="text-link"
                              onClick={() => open({ loan, reversal: t })}
                            >
                              Reverse repayment
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            );
          })}
      </div>
      {draft && (
        <Modal
          title={
            draft.reversal
              ? "Reverse repayment"
              : draft.loan
                ? "Record Repayment"
                : draft.direction === "lent"
                  ? "Give Loan"
                  : "Borrow Money"
          }
          onClose={close}
          busy={busy}
        >
          <form
            onSubmit={submit}
            onChange={() => {
              dirty.current = true;
            }}
          >
            <div className="form-grid">
              {!draft.loan && (
                <Field label="Person">
                  <input name="person" maxLength={100} required />
                </Field>
              )}
              <Field label="Principal amount · ₹">
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={
                    draft.reversal?.amount ??
                    (draft.loan
                      ? personalLoanSummary(data, draft.loan, today).outstanding
                      : "")
                  }
                  readOnly={Boolean(draft.reversal)}
                  required
                />
              </Field>
              <Field label="Date">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setIncluded("");
                  }}
                  required
                />
              </Field>
              <Field label="Bank / wallet">
                <select
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setIncluded("");
                  }}
                  disabled={Boolean(draft.reversal)}
                  required
                >
                  <option value="">Choose account</option>
                  {data.accounts
                    .filter(
                      (a) =>
                        a.userId === userId &&
                        a.active &&
                        ["bank", "wallet"].includes(a.kind),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
              {!draft.loan && (
                <>
                  <Field label="Due date (optional)">
                    <input name="dueDate" type="date" min={date} />
                  </Field>
                  <Field label="Interest terms (informational)">
                    <input name="interestTerms" maxLength={2000} />
                  </Field>
                </>
              )}
              {draft.loan && !draft.reversal && (
                <Field label="Interest paid / received · ₹ (optional)">
                  <input name="interest" type="number" min="0" step="0.01" />
                </Field>
              )}
              {sameDay && (
                <Field
                  label="Does the reported balance include this movement?"
                  className="full"
                >
                  <select
                    value={included}
                    onChange={(e) => setIncluded(e.target.value)}
                    required
                  >
                    <option value="">Choose balance treatment</option>
                    <option value="yes">Yes — already included</option>
                    <option value="no">No — update balance</option>
                  </select>
                </Field>
              )}
              <Field label="Notes (optional)" className="full">
                <textarea
                  name="notes"
                  maxLength={2000}
                  required={Boolean(draft.reversal)}
                />
              </Field>
              <p className="form-note full">
                Principal changes cash and the agreement balance. Interest is
                recorded separately; informational terms do not accrue automatic
                interest.
                {draft.reversal &&
                  " Reversing also reverses the linked interest in the original account."}
              </p>
              {error && (
                <p className="error full" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
