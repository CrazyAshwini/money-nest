"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, LogOut, UserRound } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Badge, Field, Section } from "./ui";

export function PrivateProfilePage() {
  const {
    mode,
    backend,
    profile,
    needsSetup,
    emailRequired,
    data,
    refresh,
    enterDemo,
    toast,
  } = useFinance();
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (token) {
      // Synchronize the private invitation from the URL, then remove it from the address bar.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSetupToken(token);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    if (mode === "demo") void refresh();
  }, [mode, refresh]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const updating = mode === "private" && profile;
      const password = String(form.get("password") ?? "");
      if (!updating && needsSetup && password !== form.get("confirmation"))
        throw new Error("The passwords do not match.");
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          updating
            ? { action: "update", displayName: form.get("displayName") }
            : needsSetup
              ? {
                  action: "setup",
                  token: setupToken,
                  displayName: form.get("displayName"),
                  email: form.get("email"),
                  password,
                }
              : {
                  action: "login",
                  password,
                  ...(emailRequired ? { email: form.get("email") } : {}),
                },
        ),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Your profile could not be opened.");
      sessionStorage.removeItem("finance-os:mode");
      await refresh();
      if (updating) toast("Profile saved.");
      else {
        toast(
          needsSetup ? "Profile created. You are signed in." : "Signed in.",
        );
        router.replace("/dashboard");
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!response.ok) throw new Error("Please try signing out again.");
      await refresh();
      toast("Signed out.");
      router.replace("/login");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Please try again.");
    } finally {
      setBusy(false);
      setSigningOut(false);
    }
  }

  if (mode === "private" && profile) {
    return (
      <Section title="Your profile" className="profile-panel">
        <div className="profile-identity">
          <span className="profile-avatar">
            {profile.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h2>{profile.displayName}</h2>
            <p>Private profile · saved on this computer</p>
          </div>
          <Badge tone="green">Signed in</Badge>
        </div>
        <form onSubmit={submit} className="profile-form">
          <Field label="Profile name">
            <input
              name="displayName"
              defaultValue={profile.displayName}
              maxLength={80}
              autoComplete="nickname"
              required
            />
          </Field>
          {profile.email && (
            <div className="field">
              <span>Email</span>
              <a className="text-link" href={`mailto:${profile.email}`}>
                {profile.email}
              </a>
            </div>
          )}
          <p className="profile-details">
            INR · Asia/Kolkata · {data.accounts.filter((a) => a.active).length}{" "}
            accounts · {data.transactions.length} transactions
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="profile-actions">
            <button className="button primary" type="submit" disabled={busy}>
              {busy && !signingOut ? "Saving…" : "Save profile"}
            </button>
            <button
              className="button"
              type="button"
              onClick={logout}
              disabled={busy}
            >
              <LogOut size={15} /> {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </form>
      </Section>
    );
  }

  return (
    <main className="private-access">
      <Link href="/dashboard" className="brand" aria-label="Money Nest home">
        <span className="brand-icon" aria-hidden="true">
          M
        </span>
        Money Nest
      </Link>
      <div className="private-access-card">
        <span className="login-icon">
          {needsSetup ? <UserRound size={24} /> : <LockKeyhole size={24} />}
        </span>
        <h1>{needsSetup ? "Create your profile" : "Welcome back"}</h1>
        <p>Your financial records stay private on this computer.</p>
        {backend !== "local" && (
          <p className="error" role="alert">
            A private local profile is not configured yet.
          </p>
        )}
        {needsSetup && !setupToken && (
          <p className="profile-setup-note">
            Open your private setup link to choose your name and password.
          </p>
        )}
        <form onSubmit={submit}>
          {needsSetup && (
            <Field label="Profile name">
              <input
                name="displayName"
                placeholder="Your name"
                maxLength={80}
                autoComplete="nickname"
                required
              />
            </Field>
          )}
          {(needsSetup || emailRequired) && (
            <Field label="Email">
              <input
                name="email"
                type="email"
                maxLength={254}
                autoComplete="username"
                placeholder="you@example.com"
                required
              />
            </Field>
          )}
          <Field label="Password">
            <input
              name="password"
              type="password"
              minLength={10}
              maxLength={128}
              autoComplete={needsSetup ? "new-password" : "current-password"}
              placeholder="At least 10 characters"
              required
            />
          </Field>
          {needsSetup && (
            <Field label="Confirm password">
              <input
                name="confirmation"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </Field>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={
              busy || backend !== "local" || (needsSetup && !setupToken)
            }
          >
            {busy ? "Opening…" : needsSetup ? "Create profile" : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
        <button
          className="text-link"
          type="button"
          disabled={busy}
          onClick={() => {
            sessionStorage.setItem("finance-os:mode", "demo");
            enterDemo();
            router.push("/dashboard");
          }}
        >
          Try the fictional demo
        </button>
      </div>
    </main>
  );
}
