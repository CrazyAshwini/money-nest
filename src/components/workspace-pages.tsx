"use client";
import { ReceiptAISettingsPanel } from "./ai-settings";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import {
  Download,
  ShieldCheck,
  Plus,
  Users,
  ArrowUpRight,
  CalendarDays,
  LogOut,
  RefreshCw,
  LockKeyhole,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { Section, Empty, Badge, Field, Modal, downloadFile } from "./ui";
import { type EditorState } from "./editors";
import { exportTransactionsCsv } from "@/lib/imports";
import { formatMoney, formatDate, groupSummary, sumMoney } from "@/lib/finance";

export { ImportsPage } from "./statement-import";
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
export function SettingsPage() {
  const { data, mode, toast, resetDemo, refresh } = useFinance();
  const router = useRouter();
  const [reset, setReset] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!response.ok) throw new Error("Sign out failed. Please retry.");
      await refresh();
      toast("Signed out.");
      router.replace("/login");
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Sign out failed. Please retry.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  function exportLedger() {
    setError("");
    try {
      downloadFile(
        exportTransactionsCsv(data.transactions, data.accounts),
        "finance-os-transactions.csv",
      );
      toast("Ledger exported.");
    } catch {
      setError("The ledger download could not start. Please try again.");
    }
  }

  return (
    <>
      <div id="data">
        <Section
          title="Workspace"
          subtitle="A private place for your financial records."
        >
          <div className="settings-row">
            <div>
              <strong>Currency & timezone</strong>
              <p>Indian rupee (INR) · Asia/Kolkata</p>
            </div>
            <Badge>Default</Badge>
          </div>
          <div className="settings-row">
            <div>
              <strong>Data connection</strong>
              <p>
                {mode === "demo"
                  ? "Fictional browser-local demo. Cloud sync requires your own Supabase project."
                  : mode === "private"
                    ? "Private profile saved on this computer. Sign-in protects access to your records."
                    : "Signed-in Supabase workspace. Records are protected by owner policies."}
              </p>
            </div>
            <Badge tone={mode === "demo" ? "amber" : "green"}>
              {mode === "demo" ? "Demo" : "Connected"}
            </Badge>
          </div>
          <div className="settings-row">
            <div>
              <strong>Export your ledger</strong>
              <p>Download a formula-safe CSV with masked account labels.</p>
            </div>
            <button className="button" type="button" onClick={exportLedger}>
              <Download size={15} />
              Export CSV
            </button>
          </div>
          {(mode === "private" || mode === "cloud") && (
            <div className="settings-row">
              <div>
                <strong>Your profile</strong>
                <p>Manage your name and sign-in session.</p>
              </div>
              <Link href="/profile" className="text-link">
                Manage profile <ArrowUpRight size={15} />
              </Link>
            </div>
          )}
          <div className="settings-row">
            <div>
              <strong>Reminders</strong>
              <p>
                In-app preferences are available. Email and push delivery are
                not configured.
              </p>
            </div>
            <Link className="text-link" href="/notifications">
              Manage reminders <ArrowUpRight size={15} />
            </Link>
          </div>
          {mode === "demo" ? (
            <div className="settings-row">
              <div>
                <strong>Restore fictional demo</strong>
                <p>
                  Replaces changes made in this browser with the original sample
                  data.
                </p>
              </div>
              <button className="button" onClick={() => setReset(true)}>
                <RefreshCw size={15} />
                Reset demo
              </button>
            </div>
          ) : (
            <div className="settings-row">
              <strong>End this session</strong>
              <button
                className="button"
                type="button"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                <LogOut size={15} />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Section>
      </div>
      <ReceiptAISettingsPanel />
      <Section
        title="Audit history"
        subtitle="Changes are kept as dated records."
      >
        <div className="record-list">
          {!data.auditEvents.length && (
            <p className="inline-empty">Your saved changes will appear here.</p>
          )}
          {data.auditEvents
            .slice()
            .reverse()
            .slice(0, 30)
            .map((e) => (
              <div key={e.id} className="record-row">
                <ShieldCheck size={17} />
                <span className="grow">
                  <strong>{e.description}</strong>
                  <small>
                    {new Date(e.occurredAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </small>
                </span>
                <Badge>{e.action}</Badge>
              </div>
            ))}
        </div>
      </Section>
      {reset && (
        <Modal
          title="Restore the demo?"
          description="This replaces fictional changes in this browser. Export first if you want to keep them."
          onClose={() => setReset(false)}
        >
          <div className="form-actions">
            <button className="button" onClick={() => setReset(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                resetDemo();
                setReset(false);
              }}
            >
              Restore demo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
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
                    await save("reminders", { ...r, enabled: !r.enabled });
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
export function LoginPage() {
  const { refresh, enterDemo, toast, signupEnabled } = useFinance();
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = signup && signupEnabled;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("auth_error") === "confirmation") {
      // Synchronize the server's safe callback result, then clear it from the address.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        "This sign-in link is invalid or expired. Sign in again or request a new confirmation email.",
      );
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setSuccess("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      sessionStorage.removeItem("finance-os:mode");
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: creating ? "signup" : "login",
          email: f.get("email"),
          password: f.get("password"),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to sign in.");
      if (result.needsEmailConfirmation) {
        setSuccess(
          "Account created. Check your email to confirm your account, then sign in.",
        );
        return;
      }
      await refresh();
      toast(creating ? "Account created. You are signed in." : "Signed in.");
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-story">
        <Link className="brand" href="/dashboard" aria-label="Money Nest home">
          <span className="brand-icon" aria-hidden="true">
            M
          </span>
          Money Nest
        </Link>
        <div>
          <span className="eyebrow">MAKE ROOM FOR CLARITY</span>
          <h2>
            Know your money.
            <br />
            <span>Own your next move.</span>
          </h2>
          <p>
            Your accounts, spending, bills, and plans.
            <br />
            One thoughtful space to see it all.
          </p>
          <div className="login-orbit">
            <div className="orbit-circle" />
            <span className="orbit-card">
              <ShieldCheck size={25} />
              <strong>Personal by design.</strong>
              <small>Private to your account.</small>
            </span>
          </div>
        </div>
        <small>Built around your finances. And your peace of mind.</small>
      </div>
      <div className="login-form">
        <span className="login-icon">
          <LockKeyhole size={24} />
        </span>
        <h1>
          {creating ? "Make yourself at home" : "Welcome to your workspace"}
        </h1>
        <p>
          {creating
            ? "Create your private finance account."
            : "A clearer picture of your finances starts here."}
        </p>
        <form onSubmit={submit}>
          <Field label="Email address">
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              name="password"
              autoComplete={creating ? "new-password" : "current-password"}
              minLength={8}
              required
              placeholder="At least 8 characters"
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="form-note" role="status">
              {success}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Connecting…" : creating ? "Create account" : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
        {signupEnabled && (
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => {
              setSignup(!signup);
              setError("");
              setSuccess("");
            }}
          >
            {creating
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        )}
        <div className="login-divider">
          <span>or take a look around</span>
        </div>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => {
            sessionStorage.setItem("finance-os:mode", "demo");
            enterDemo();
            router.push("/dashboard");
            toast("Exploring the fictional demo workspace.");
          }}
        >
          Explore fictional demo <ArrowUpRight size={16} />
        </button>
        <p className="login-note">
          <ShieldCheck size={13} />
          Sign-in is limited to the Money Nest owner account. Your workspace
          syncs across your devices.
        </p>
      </div>
    </main>
  );
}
