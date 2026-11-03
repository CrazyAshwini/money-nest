"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, LockKeyhole, ArrowRight, Eye, EyeOff, MailCheck, Check } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Field } from "../ui";
import { LoginStory, MobileAccessBrand } from "./access-story";

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
  const searchParams = useSearchParams();
  const authError = searchParams.get("auth_error");
  const demoRequested = searchParams.get("demo");
  const [stage, setStage] = useState<AccessStage>(() =>
    authError === "recovery" ? "reset" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  // Pending registration details and codes stay in memory, never in a URL or storage.
  const [pendingEmail, setPendingEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState(() =>
    authError === "recovery"
      ? "This password-reset link has expired. Request another one."
      : authError === "confirmation"
        ? "This confirmation link is invalid or expired. Sign in again or request a new code from your signup screen."
        : "",
  );
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
    if (authError === "confirmation" || authError === "recovery") {
      // Initial state already reflects the callback; only clean the address here.
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, [authError]);

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
      const trimmedEmail = email.trim().toLowerCase();
      if (
        trimmedEmail === "demo@moneynest.com" ||
        trimmedEmail === "demo@moneynest.local" ||
        trimmedEmail === "agent@moneynest.com"
      ) {
        await loginDemo();
        return;
      }

      const result = await requestAuth({
        action: recovering ? "reset" : creating ? "signup" : "login",
        email: email.trim(),
        ...(!recovering ? { password } : {}),
      });
      if (recovering) {
        setSuccess(
          "If this email has an account, a reset link is on its way. Check your inbox and spam folder.",
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

  async function loginDemo() {
    if (working) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          email: "demo@moneynest.com",
          password: "demo1234",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not sign in to demo account.");
      await openWorkspace("Welcome to the Demo Account!");
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Could not sign in to demo account.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (demoRequested === "true" || demoRequested === "1")
      router.replace("/demo");
  }, [demoRequested, router]);

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
            "We’ll email a secure link if this address has an account."
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
