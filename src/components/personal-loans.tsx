"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowLeft,
  RotateCcw,
  Plus,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { Modal, Field, Empty } from "./ui";
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
import "./loans-workspace.css";

export function PersonalLoans({ id }: { id?: string }) {
  const { data, userId, today, commitPersonalLoan, toast } = useFinance();
  const datalistId = useId();
  const loans = data.loans.filter(
    (l) => l.userId === userId && l.ledgerManaged,
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "lent" | "borrowed" | "settled">("all");

  const knownPeople = Array.from(
    new Set(
      [
        ...data.shares
          .filter((s) => s.userId === userId && !s.isOwner)
          .map((s) => s.participant.trim()),
        ...data.settlements
          .filter((s) => s.userId === userId)
          .map((s) => s.counterparty.trim()),
        ...data.loans
          .filter((l) => l.userId === userId)
          .map((l) => l.lender.trim()),
        ...data.transactions
          .filter((t) => t.userId === userId && t.externalPayer)
          .map((t) => t.externalPayer!.trim()),
      ].filter(Boolean),
    ),
  ).sort();

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
  const [personInput, setPersonInput] = useState("");
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
    setPersonInput("");
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

  // Summary Metrics
  const lentLoans = loans.filter((l) => l.kind === "lent");
  const borrowedLoans = loans.filter((l) => l.kind === "borrowed");
  const totalLentOutstanding = sumMoney(
    lentLoans.map((l) => personalLoanSummary(data, l, today).outstanding),
  );
  const totalBorrowedOutstanding = sumMoney(
    borrowedLoans.map((l) => personalLoanSummary(data, l, today).outstanding),
  );
  const activeBorrowersCount = lentLoans.filter(
    (l) => personalLoanSummary(data, l, today).status !== "Settled",
  ).length;
  const activeLendersCount = borrowedLoans.filter(
    (l) => personalLoanSummary(data, l, today).status !== "Settled",
  ).length;

  // Filtered loans list
  const filteredLoans = loans
    .filter((l) => !id || l.id === id)
    .filter((l) => {
      const summary = personalLoanSummary(data, l, today);
      if (filterMode === "lent") return l.kind === "lent";
      if (filterMode === "borrowed") return l.kind === "borrowed";
      if (filterMode === "settled") return summary.status === "Settled";
      return true;
    })
    .filter((l) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        l.name.toLowerCase().includes(q) ||
        l.lender.toLowerCase().includes(q) ||
        (l.notes && l.notes.toLowerCase().includes(q))
      );
    });

  // Single Loan Detail View
  if (id) {
    const loan = loans.find((l) => l.id === id);
    if (!loan) {
      return (
        <Empty
          title="Personal loan not found"
          description="This loan agreement is not available in your workspace."
        />
      );
    }
    const summary = personalLoanSummary(data, loan, today);
    const isLent = loan.kind === "lent";
    const percentRepaid = Number(summary.principal) > 0
      ? Math.min(100, Math.round((Number(summary.repaid) / Number(summary.principal)) * 100))
      : 0;

    return (
      <div className="loans-workspace">
        <Link className="loan-detail-back" href="/loans">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to all loans</span>
        </Link>

        <div className={`loan-detail-hero ${isLent ? "lent" : "borrowed"}`}>
          <div className="loan-detail-header-row">
            <div className="loan-person-info">
              <div className="loan-avatar" aria-hidden="true">
                {loan.lender.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="loan-person-name" style={{ fontSize: "22px" }}>
                  {loan.name}
                </h1>
                <span className={`loan-direction-tag ${isLent ? "lent" : "borrowed"}`}>
                  {isLent ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                  {isLent ? "Money Lent (You will receive)" : "Money Borrowed (You will repay)"} · Disbursed on {formatDate(loan.disbursedOn)}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className={`loan-status-badge ${summary.status.toLowerCase()}`}>
                {summary.status === "Settled" ? (
                  <CheckCircle2 size={13} />
                ) : summary.status === "Overdue" ? (
                  <AlertCircle size={13} />
                ) : (
                  <Clock size={13} />
                )}
                {summary.status}
              </span>
              {summary.status !== "Settled" && (
                <button
                  type="button"
                  className="loan-repay-btn"
                  onClick={() => open({ loan })}
                >
                  <Plus size={15} aria-hidden="true" />
                  <span>Record Repayment</span>
                </button>
              )}
            </div>
          </div>

          <div className="loan-progress-wrap">
            <div className="loan-progress-labels">
              <span>{formatMoney(summary.repaid)} repaid of {formatMoney(summary.principal)}</span>
              <span>{percentRepaid}%</span>
            </div>
            <div className="loan-progress-bar">
              <div
                className="loan-progress-fill"
                style={{
                  width: `${percentRepaid}%`,
                  background: isLent ? "#0f8a65" : "#d97706",
                }}
              />
            </div>
          </div>

          <div className="loan-metrics" style={{ margin: 0 }}>
            <div className="loan-metric-col">
              <small>Original Principal</small>
              <strong>{formatMoney(summary.principal)}</strong>
            </div>
            <div className="loan-metric-col">
              <small>Total Repaid</small>
              <strong>{formatMoney(summary.repaid)}</strong>
            </div>
            <div className="loan-metric-col">
              <small>Outstanding</small>
              <strong className={isLent ? "highlight-lent" : "highlight-borrowed"}>
                {formatMoney(summary.outstanding)}
              </strong>
            </div>
          </div>

          {loan.notes && (
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--muted)" }}>
              {loan.notes}
            </p>
          )}
          {loan.interestTerms && (
            <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
              Interest terms: {loan.interestTerms}
            </p>
          )}
        </div>

        <div style={{ marginTop: "8px" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 700, margin: "0 0 12px 0", letterSpacing: "-0.01em" }}>
            Ledger History
          </h2>
          <div className="loan-timeline">
            {summary.events.map((t) => {
              const isDisbursement = t.loanEvent === "disbursement";
              const isRepayment = t.loanEvent === "repayment";
              const canReverse =
                isRepayment &&
                !summary.events.some((r) => r.reversesTransactionId === t.id);

              return (
                <div className="loan-timeline-event" key={t.id}>
                  <div
                    className={`loan-timeline-icon ${isDisbursement ? "disbursement" : isRepayment ? "repayment" : "reversal"}`}
                    aria-hidden="true"
                  >
                    {isDisbursement ? (
                      <ArrowUpRight size={18} />
                    ) : isRepayment ? (
                      <ArrowDownLeft size={18} />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                  </div>

                  <div className="loan-timeline-content">
                    <strong>{t.description}</strong>
                    <small>
                      {formatDate(t.occurredOn)}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </small>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span className="loan-timeline-amount">
                      {isDisbursement ? "-" : "+"}
                      {formatMoney(t.amount)}
                    </span>
                    {canReverse && (
                      <button
                        type="button"
                        className="text-link"
                        style={{ fontSize: "12.5px" }}
                        onClick={() => open({ loan, reversal: t })}
                      >
                        Reverse repayment
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Repayment Modal */}
        {renderModal()}
      </div>
    );
  }

  // Main Personal Loans View (List)
  return (
    <div className="loans-workspace">
      {/* Hero Metrics Cards */}
      <div className="loans-hero-grid">
        <div className="loans-hero-card lent">
          <div>
            <div className="loans-hero-header">
              <div className="loans-hero-label-wrap">
                <span className="loans-hero-icon" aria-hidden="true">
                  <ArrowUpRight size={18} />
                </span>
                <span className="loans-hero-label">To Receive (Money Lent)</span>
              </div>
            </div>
            <div className="loans-hero-amount">
              {formatMoney(totalLentOutstanding)}
            </div>
            <div className="loans-hero-subtitle">
              {activeBorrowersCount > 0
                ? `${activeBorrowersCount} active borrower${activeBorrowersCount > 1 ? "s" : ""}`
                : "All lent money settled"}
            </div>
          </div>
          <div className="loans-hero-footer">
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>Lent to someone</span>
            <button
              type="button"
              className="loans-hero-btn primary"
              onClick={() => open({ direction: "lent" })}
            >
              <Plus size={15} aria-hidden="true" />
              <span>Give Loan</span>
            </button>
          </div>
        </div>

        <div className="loans-hero-card borrowed">
          <div>
            <div className="loans-hero-header">
              <div className="loans-hero-label-wrap">
                <span className="loans-hero-icon" aria-hidden="true">
                  <ArrowDownLeft size={18} />
                </span>
                <span className="loans-hero-label">To Repay (Money Borrowed)</span>
              </div>
            </div>
            <div className="loans-hero-amount">
              {formatMoney(totalBorrowedOutstanding)}
            </div>
            <div className="loans-hero-subtitle">
              {activeLendersCount > 0
                ? `${activeLendersCount} active lender${activeLendersCount > 1 ? "s" : ""}`
                : "No outstanding debts"}
            </div>
          </div>
          <div className="loans-hero-footer">
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>Borrowed from someone</span>
            <button
              type="button"
              className="loans-hero-btn secondary"
              onClick={() => open({ direction: "borrowed" })}
            >
              <Plus size={15} aria-hidden="true" />
              <span>Borrow Money</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      {loans.length > 0 && (
        <div className="loans-filter-row">
          <div className="loans-search-wrap">
            <Search size={16} className="loans-search-icon" aria-hidden="true" />
            <input
              type="search"
              className="loans-search-input"
              placeholder="Search by person name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search loans by person"
            />
          </div>

          <div className="loans-filter-chips" role="group" aria-label="Filter loans by direction">
            <button
              type="button"
              className={`loans-chip ${filterMode === "all" ? "active" : ""}`}
              onClick={() => setFilterMode("all")}
            >
              All ({loans.length})
            </button>
            <button
              type="button"
              className={`loans-chip ${filterMode === "lent" ? "active" : ""}`}
              onClick={() => setFilterMode("lent")}
            >
              To Receive ({lentLoans.length})
            </button>
            <button
              type="button"
              className={`loans-chip ${filterMode === "borrowed" ? "active" : ""}`}
              onClick={() => setFilterMode("borrowed")}
            >
              To Repay ({borrowedLoans.length})
            </button>
            <button
              type="button"
              className={`loans-chip ${filterMode === "settled" ? "active" : ""}`}
              onClick={() => setFilterMode("settled")}
            >
              Settled
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loans.length && (
        <Empty
          title="No personal loans yet"
          description="Track money you have lent to or borrowed from friends, family, and colleagues separately from regular expenses."
        />
      )}

      {loans.length > 0 && filteredLoans.length === 0 && (
        <Empty
          title="No matching agreements"
          description="Try adjusting your search query or switching the filter filter chip."
        />
      )}

      {/* Loan Cards Grid */}
      <div className="loans-grid">
        {filteredLoans.map((loan) => {
          const summary = personalLoanSummary(data, loan, today);
          const isLent = loan.kind === "lent";
          const percentRepaid = Number(summary.principal) > 0
            ? Math.min(100, Math.round((Number(summary.repaid) / Number(summary.principal)) * 100))
            : 0;

          return (
            <div key={loan.id} className={`loan-card ${isLent ? "lent" : "borrowed"}`}>
              <div>
                <div className="loan-card-top">
                  <div className="loan-person-info">
                    <div className="loan-avatar" aria-hidden="true">
                      {loan.lender.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="loan-person-text">
                      <h3 className="loan-person-name">{loan.name}</h3>
                      <span className={`loan-direction-tag ${isLent ? "lent" : "borrowed"}`}>
                        {isLent ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
                        <span>{isLent ? "Money Lent" : "Money Borrowed"}</span>
                      </span>
                    </div>
                  </div>

                  <span className={`loan-status-badge ${summary.status.toLowerCase()}`}>
                    {summary.status === "Settled" ? (
                      <CheckCircle2 size={12} />
                    ) : summary.status === "Overdue" ? (
                      <AlertCircle size={12} />
                    ) : (
                      <Clock size={12} />
                    )}
                    {summary.status}
                  </span>
                </div>

                {/* Repayment Progress */}
                <div className="loan-progress-wrap">
                  <div className="loan-progress-labels">
                    <span>
                      {formatMoney(summary.repaid)} repaid of {formatMoney(summary.principal)}
                    </span>
                    <span>{percentRepaid}%</span>
                  </div>
                  <div className="loan-progress-bar">
                    <div
                      className="loan-progress-fill"
                      style={{ width: `${percentRepaid}%` }}
                    />
                  </div>
                </div>

                {/* Key Metrics */}
                <div className="loan-metrics">
                  <div className="loan-metric-col">
                    <small>Outstanding</small>
                    <strong className={isLent ? "highlight-lent" : "highlight-borrowed"}>
                      {formatMoney(summary.outstanding)}
                    </strong>
                  </div>
                  <div className="loan-metric-col">
                    <small>Due Date</small>
                    <strong className={summary.status === "Overdue" ? "overdue-text" : ""}>
                      {loan.dueDate ? formatDate(loan.dueDate) : "Not set"}
                    </strong>
                  </div>
                  <div className="loan-metric-col">
                    <small>Given On</small>
                    <strong>{formatDate(loan.disbursedOn)}</strong>
                  </div>
                </div>

                {loan.notes && <p className="loan-notes-text">{loan.notes}</p>}
              </div>

              {/* Card Actions */}
              <div className="loan-card-foot">
                <Link className="loan-history-link" href={`/loans/${loan.id}`}>
                  <span>View history</span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>

                {summary.status !== "Settled" && (
                  <button
                    type="button"
                    className="loan-repay-btn"
                    onClick={() => open({ loan })}
                  >
                    <span>Record Repayment</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Dialog */}
      {renderModal()}
    </div>
  );

  function renderModal() {
    if (!draft) return null;
    return (
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
                <input
                  name="person"
                  maxLength={100}
                  list={datalistId}
                  value={personInput}
                  onChange={(e) => setPersonInput(e.target.value)}
                  placeholder="e.g. Ramesh, Priya, Rahul"
                  required
                />
                <datalist id={datalistId}>
                  {knownPeople.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                {knownPeople.length > 0 && (
                  <div className="loan-contact-chips">
                    <span style={{ fontSize: "11px", color: "var(--muted)", marginRight: "2px" }}>
                      Quick select:
                    </span>
                    {knownPeople.slice(0, 6).map((person) => (
                      <button
                        type="button"
                        key={person}
                        className="loan-contact-chip"
                        onClick={() => {
                          setPersonInput(person);
                          dirty.current = true;
                        }}
                      >
                        {person}
                      </button>
                    ))}
                  </div>
                )}
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
                name="accountId"
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
                      {a.name} ({a.kind === "bank" ? "Bank" : "Wallet"})
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
                  <input
                    name="interestTerms"
                    maxLength={2000}
                    placeholder="e.g. 0% interest, return by end of month"
                  />
                </Field>
              </>
            )}

            {draft.loan && !draft.reversal && (
              <Field label="Interest paid / received · ₹ (optional)">
                <input
                  name="interest"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
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
                  <option value="yes">Yes — already included in balance</option>
                  <option value="no">No — update balance</option>
                </select>
              </Field>
            )}

            <Field label="Notes (optional)" className="full">
              <textarea
                name="notes"
                maxLength={2000}
                placeholder="Reference UTR, purpose, or reminder notes..."
                required={Boolean(draft.reversal)}
              />
            </Field>

            <p className="form-note full">
              {draft.direction === "lent"
                ? "Lending money debits your selected bank account and adds an outstanding receivable under To Receive."
                : draft.direction === "borrowed"
                  ? "Borrowing money credits your bank account and adds an outstanding payable under To Repay."
                  : draft.reversal
                    ? "Reversing this repayment restores the outstanding balance and reverses any linked interest."
                    : "Recording a repayment updates cash and reduces the remaining loan balance."}
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
    );
  }
}
