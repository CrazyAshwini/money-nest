"use client";
import { ReceiptAISettingsPanel } from "./ai-settings";
import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
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
  LockKeyhole,
  ArrowRight,
  AlertCircle,
  Eye,
  EyeOff,
  MailCheck,
  Check,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { BrandLockup } from "./brand-lockup";
import {
  Section,
  Empty,
  Badge,
  Field,
  PasswordField,
  Modal,
  downloadFile,
} from "./ui";
import { type EditorState } from "./editors";
import { exportTransactionsCsv } from "@/lib/imports";
import { formatMoney, formatDate, groupSummary, sumMoney } from "@/lib/finance";
import "./profile-theme.css";
import "./signup-auth.css";

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
  const { data, mode, toast, refresh } = useFinance();
  const router = useRouter();
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
function LoginStory() {
  return (
    <div className="login-story">
      <Link className="brand" href="/dashboard" aria-label="Money Nest home">
        <BrandLockup />
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
          <Image
            src="/brand/panda-money-bag.svg"
            width={180}
            height={180}
            alt=""
            aria-hidden="true"
            className="access-panda"
            unoptimized
          />
          <span className="orbit-card">
            <ShieldCheck size={25} aria-hidden="true" />
            <strong>Personal by design.</strong>
            <small>Private to your account.</small>
          </span>
        </div>
      </div>
      <small>Built around your finances. And your peace of mind.</small>
    </div>
  );
}

function MobileAccessBrand() {
  return (
    <Link
      href="/dashboard"
      className="brand access-mobile-brand"
      aria-label="Money Nest home"
    >
      <BrandLockup />
    </Link>
  );
}

type AccessStage = "login" | "signup" | "reset" | "verify" | "verified";

class AccessRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function AccessPasswordField({
  label,
  name,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid = false,
  onBlur,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  describedBy?: string;
  invalid?: boolean;
  onBlur?: () => void;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          minLength={8}
          maxLength={128}
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <EyeOff size={18} aria-hidden="true" />
          ) : (
            <Eye size={18} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

function maskedSignupEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local?.slice(0, 1) || ""}•••@${domain || ""}`;
}

export function LoginPage() {
  const { refresh, toast, signupEnabled } = useFinance();
  const router = useRouter();
  const [stage, setStage] = useState<AccessStage>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  // Pending registration details and codes stay in memory, never in a URL or storage.
  const [pendingEmail, setPendingEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const passwordHintId = useId();
  const confirmationHintId = useId();
  const codeHintId = useId();
  const codeInputId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef<AccessStage>("login");
  const creating = stage === "signup" && signupEnabled;
  const recovering = stage === "reset";
  const verifying = stage === "verify";
  const verified = stage === "verified";
  const passwordMismatch =
    creating && confirmationTouched && password !== confirmation;
  const working = busy || resending;

  useEffect(() => {
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    if (authError === "confirmation" || authError === "recovery") {
      // Synchronize the server's safe callback result, then clear it from the address.
      if (authError === "recovery") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStage("reset");
        setError("This password-reset link has expired. Request another one.");
      } else {
        setError(
          "This confirmation link is invalid or expired. Sign in again or request a new code from your signup screen.",
        );
      }
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  useEffect(() => {
    if (previousStage.current !== stage) {
      headingRef.current?.focus();
      previousStage.current = stage;
    }
  }, [stage]);

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      setRetrySeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  function applyRetryAfter(seconds: unknown) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
      return;
    const duration = Math.ceil(seconds);
    setRetryAt(Date.now() + duration * 1000);
    setRetrySeconds(duration);
  }

  function changeStage(next: AccessStage) {
    setStage(next);
    setPassword("");
    setConfirmation("");
    setConfirmationTouched(false);
    setToken("");
    setError("");
    setSuccess("");
    if (next !== "verify") setPendingEmail("");
  }

  async function requestAuth(body: Record<string, string>) {
    let response: Response;
    try {
      response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        "We couldn’t connect. Check your connection and try again.",
      );
    }
    let result: {
      ok?: boolean;
      authenticated?: boolean;
      error?: string;
      code?: string;
      retryAfter?: number;
      needsEmailConfirmation?: boolean;
    };
    try {
      result = await response.json();
      if (!result || typeof result !== "object") throw new Error();
    } catch {
      throw new Error("We couldn’t complete that request. Please try again.");
    }
    const headerRetry = response.headers.get("Retry-After");
    applyRetryAfter(
      result.retryAfter ??
        (headerRetry && /^\d+$/.test(headerRetry)
          ? Number(headerRetry)
          : undefined),
    );
    if (!response.ok) {
      if (verifying && result.code?.includes("expired")) {
        throw new Error(
          "That code is invalid or has expired. Check your latest email or resend a code.",
        );
      }
      throw new AccessRequestError(
        result.error || "We couldn’t complete that request. Please try again.",
        result.code,
      );
    }
    if (result.ok !== true) {
      throw new AccessRequestError(
        "We couldn’t confirm that request. Please sign in to continue.",
        "invalid_response",
      );
    }
    return result;
  }

  async function openWorkspace(message: string) {
    if (!(await refresh())) {
      throw new Error(
        "Your authenticated workspace could not be opened. Please sign in to try again.",
      );
    }
    toast(message);
    router.replace("/dashboard");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || verified) return;
    setError("");
    setSuccess("");
    if (creating && password !== confirmation) {
      setConfirmationTouched(true);
      const field = event.currentTarget.elements.namedItem("confirmation");
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }
    if (verifying && !/^\d{6}$/.test(token)) {
      setError("Enter the six numbers from your email.");
      return;
    }
    setBusy(true);
    try {
      try {
        sessionStorage.removeItem("finance-os:mode");
      } catch {
        // Authentication still works when browser storage is unavailable.
      }
      if (verifying) {
        const result = await requestAuth({
          action: "verify-signup-otp",
          email: pendingEmail,
          token,
        });
        if (result.authenticated !== true) {
          throw new AccessRequestError(
            "Email verification did not establish an authenticated session.",
            "session_unavailable",
          );
        }
        setToken("");
        setStage("verified");
        setSuccess("Opening your workspace…");
        // Show the verified server result before the provider loads the workspace.
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        try {
          await openWorkspace("Email verified. Welcome to MoneyNest.");
        } catch (issue) {
          changeStage("login");
          setSuccess("Your email is verified. Sign in to continue.");
          throw issue;
        }
        return;
      }
      const result = await requestAuth({
        action: recovering ? "reset" : creating ? "signup" : "login",
        email: email.trim(),
        ...(!recovering ? { password } : {}),
      });
      if (recovering) {
        setSuccess(
          "If this email can access the owner account, a reset link is on its way. Check your inbox and spam folder.",
        );
        return;
      }
      setPassword("");
      setConfirmation("");
      if (creating && result.needsEmailConfirmation) {
        setPendingEmail(email.trim().toLowerCase());
        setEmail("");
        setToken("");
        setStage("verify");
        return;
      }
      await openWorkspace(
        creating ? "Account created. You are signed in." : "Signed in.",
      );
    } catch (issue) {
      if (
        verifying &&
        issue instanceof AccessRequestError &&
        (issue.code === "session_unavailable" ||
          issue.code === "invalid_response")
      ) {
        const signupEmail = pendingEmail;
        changeStage("login");
        setEmail(signupEmail);
        setError(
          "Email verification did not establish an authenticated session. Sign in to continue, or start signup again to request a new code.",
        );
      } else {
        setError(issue instanceof Error ? issue.message : "Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (working || retrySeconds > 0 || !pendingEmail) return;
    setResending(true);
    setError("");
    setSuccess("");
    try {
      await requestAuth({ action: "resend-signup-otp", email: pendingEmail });
      setToken("");
      setSuccess(
        "If this address is eligible, a new code is on its way. Use the latest email and check your spam folder.",
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Please try again.");
    } finally {
      setResending(false);
    }
  }

  function updateToken(value: string) {
    const normalized = value.replace(/[\s-]/g, "");
    if (/^\d{0,6}$/.test(normalized)) {
      setToken(normalized);
      setError("");
      setSuccess("");
    } else {
      setError("Use only the six numbers from your email.");
    }
  }

  const countdown = `${String(Math.floor(retrySeconds / 60)).padStart(2, "0")}:${String(retrySeconds % 60).padStart(2, "0")}`;

  return (
    <main className="login access-theme signup-access">
      <LoginStory />
      <div
        className={`login-form ${verifying || verified ? "verification-card" : ""}`}
      >
        <MobileAccessBrand />
        <span
          className={`login-icon ${verified ? "is-verified" : ""}`}
          aria-hidden="true"
        >
          {verified ? (
            <Check size={25} />
          ) : verifying ? (
            <MailCheck size={25} />
          ) : (
            <LockKeyhole size={24} />
          )}
        </span>
        {(creating || verifying) && (
          <span className="access-step">Step {verifying ? "2" : "1"} of 2</span>
        )}
        <h1 ref={headingRef} tabIndex={-1}>
          {verified
            ? "Email verified"
            : verifying
              ? "Verify your email"
              : recovering
                ? "Reset your cloud password"
                : creating
                  ? "Create your MoneyNest account"
                  : "Welcome to your workspace"}
        </h1>
        <p>
          {verified ? (
            "Your email confirmation is complete."
          ) : verifying ? (
            <>
              Enter the 6-digit code we sent to{" "}
              <strong className="verification-email">
                {maskedSignupEmail(pendingEmail)}
              </strong>
              .
            </>
          ) : recovering ? (
            "We’ll email a secure link if this address belongs to the owner account."
          ) : creating ? (
            "Keep your accounts, spending and bills together."
          ) : (
            "A clearer picture of your finances starts here."
          )}
        </p>
        {verified ? (
          <p className="form-note" role="status">
            {success}
          </p>
        ) : (
          <form key={stage} onSubmit={submit} aria-busy={working}>
            {verifying ? (
              <div className="field otp-field">
                <label htmlFor={codeInputId}>Verification code</label>
                <div className={`otp-control ${error ? "has-error" : ""}`}>
                  <div className="otp-slots" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, index) => (
                      <span
                        key={index}
                        className={index === token.length ? "is-current" : ""}
                      >
                        {token[index] || ""}
                      </span>
                    ))}
                  </div>
                  <input
                    id={codeInputId}
                    name="token"
                    aria-describedby={codeHintId}
                    aria-invalid={Boolean(error) || undefined}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={token}
                    maxLength={11}
                    minLength={6}
                    pattern="[0-9]{6}"
                    spellCheck={false}
                    onChange={(event) => updateToken(event.target.value)}
                    onPaste={(event) => {
                      event.preventDefault();
                      updateToken(event.clipboardData.getData("text"));
                    }}
                    required
                  />
                </div>
                <small id={codeHintId} className="access-field-hint">
                  You can paste the whole code. Use the most recent email.
                </small>
              </div>
            ) : (
              <>
                <Field label="Email address">
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={254}
                    required
                  />
                </Field>
                {!recovering && (
                  <>
                    <AccessPasswordField
                      label="Password"
                      name="password"
                      value={password}
                      onChange={setPassword}
                      autoComplete={
                        creating ? "new-password" : "current-password"
                      }
                      describedBy={creating ? passwordHintId : undefined}
                    />
                    {creating && (
                      <>
                        <p
                          id={passwordHintId}
                          className="access-field-hint password-hint"
                        >
                          Use at least 8 characters.
                        </p>
                        <AccessPasswordField
                          label="Confirm password"
                          name="confirmation"
                          value={confirmation}
                          onChange={setConfirmation}
                          onBlur={() => setConfirmationTouched(true)}
                          autoComplete="new-password"
                          invalid={passwordMismatch}
                          describedBy={
                            passwordMismatch ? confirmationHintId : undefined
                          }
                        />
                        {passwordMismatch && (
                          <p
                            id={confirmationHintId}
                            className="access-field-error"
                            role="alert"
                          >
                            The passwords do not match.
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
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
            <button
              className="button primary"
              disabled={working || (verifying && token.length !== 6)}
            >
              {busy
                ? verifying
                  ? "Verifying…"
                  : recovering
                    ? "Sending…"
                    : "Connecting…"
                : verifying
                  ? "Verify email"
                  : recovering
                    ? "Send reset link"
                    : creating
                      ? "Create account"
                      : "Sign in"}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
        )}
        {verifying && (
          <>
            <button
              className="text-link resend-code"
              type="button"
              disabled={working || retrySeconds > 0}
              onClick={() => void resend()}
            >
              {resending
                ? "Sending code…"
                : retrySeconds > 0
                  ? `Resend code in ${countdown}`
                  : "Resend code"}
            </button>
            <div className="verification-actions">
              <button
                className="text-link"
                type="button"
                disabled={working}
                onClick={() => {
                  const previousEmail = pendingEmail;
                  changeStage(signupEnabled ? "signup" : "login");
                  setEmail(previousEmail);
                }}
              >
                Change email
              </button>
              <button
                className="text-link"
                type="button"
                disabled={working}
                onClick={() => changeStage("login")}
              >
                Back to sign in
              </button>
            </div>
          </>
        )}
        {!recovering && !creating && !verifying && !verified && (
          <button
            className="text-link"
            type="button"
            disabled={working}
            onClick={() => changeStage("reset")}
          >
            Forgot your password?
          </button>
        )}
        {recovering && (
          <button
            className="text-link"
            type="button"
            disabled={working}
            onClick={() => changeStage("login")}
          >
            Back to sign in
          </button>
        )}
        {!recovering && !verifying && !verified && signupEnabled && (
          <button
            className="text-link access-switch"
            type="button"
            disabled={working}
            onClick={() => changeStage(creating ? "login" : "signup")}
          >
            {creating
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        )}
        {!recovering && !verified && (
          <p className="login-note">
            <ShieldCheck size={15} aria-hidden="true" />
            Access is limited to your authorized MoneyNest account.
          </p>
        )}
        {!recovering && !creating && !verifying && !verified && (
          <p className="login-help">
            Your computer-only profile password is separate from your cloud
            password.
            {signupEnabled &&
              " For a new cloud account, choose “New here? Create an account” and confirm your email."}
          </p>
        )}
      </div>
    </main>
  );
}

export function PasswordRecoveryPage() {
  const { refresh, toast } = useFinance();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirmation")) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-password",
          password: form.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ||
            "Your password could not be updated. Request a new reset link.",
        );
      await refresh();
      toast("Cloud password updated.");
      router.replace("/dashboard");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login access-theme">
      <LoginStory />
      <div className="login-form">
        <MobileAccessBrand />
        <span className="login-icon" aria-hidden="true">
          <LockKeyhole size={24} />
        </span>
        <h1>Choose a new cloud password</h1>
        <p>This changes your cloud sign-in only, not your local profile.</p>
        <form onSubmit={submit}>
          <PasswordField
            label="New password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
          <PasswordField
            label="Confirm new password"
            name="confirmation"
            autoComplete="new-password"
            placeholder="Enter it again"
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
            <ArrowRight size={16} />
          </button>
        </form>
        <Link href="/login" className="text-link">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
