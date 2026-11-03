"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  ChevronRight,
  HandCoins,
  LockKeyhole,
  LogOut,
  Pencil,
  Settings,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { BrandLogo } from "./brand-lockup";
import { Badge, Field, PasswordField } from "./ui";
import { ProfileAccounts } from "./profile-accounts";
import "./profile-theme.css";
import styles from "./private-profile.module.css";

export function PrivateProfilePage() {
  const { mode, backend, profile, needsSetup, emailRequired, refresh, toast, resetDemo } =
    useFinance();
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);

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
      const updating = (mode === "private" || mode === "cloud") && profile;
      const password = String(form.get("password") ?? "");
      if (!updating && needsSetup && password !== form.get("confirmation"))
        throw new Error("The passwords do not match.");
      const response = await fetch("/api/profile", {
        method: mode === "cloud" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "cloud"
            ? { displayName: form.get("displayName") }
            : updating
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
      if (updating) {
        toast("Profile saved.");
        setIsEditingName(false);
      } else {
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
      const response = await fetch(
        mode === "cloud" ? "/api/auth" : "/api/profile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logout" }),
        },
      );
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

  if ((mode === "private" || mode === "cloud" || mode === "demo") && profile) {
    const emailDomain = profile.email?.split("@")[1];
    const maskedEmail = mode === "demo"
      ? profile.email
      : emailDomain
        ? `${profile.email!.slice(0, 1)}•••@${emailDomain}`
        : null;

    return (
      <div className={styles.hub}>
        {/* Profile Identity Card */}
        <section className={styles.identity} aria-label="Signed-in profile">
          <span className={styles.avatar} aria-hidden="true">
            {profile.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div className={styles.identityDetails}>
            {isEditingName ? (
              <form onSubmit={submit} className={styles.nameEditForm}>
                <Field label="Profile name">
                  <input
                    name="displayName"
                    defaultValue={profile.displayName}
                    maxLength={80}
                    autoComplete="nickname"
                    required
                  />
                </Field>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className={styles.nameEditActions}>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={busy}
                  >
                    {busy && !signingOut ? "Saving…" : "Save profile"}
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setIsEditingName(false);
                      setError("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className={styles.nameRow}>
                <h2>{profile.displayName}</h2>
                <button
                  type="button"
                  className={styles.nameEditToggle}
                  onClick={() => setIsEditingName(true)}
                  aria-label="Edit profile name"
                  title="Edit profile name"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            {profile.email && (
              <a
                href={`mailto:${profile.email}`}
                className={styles.profileEmail}
                aria-label={profile.email}
              >
                {mode === "demo" ? profile.email : maskedEmail ?? profile.email}
              </a>
            )}
          </div>
          <Badge tone={mode === "demo" ? "amber" : "green"}>
            {mode === "demo" ? "Demo Account" : "Signed in"}
          </Badge>
        </section>

        {/* Demo Mode Banner (Only for demo workspace) */}
        {mode === "demo" && (
          <section className={styles.demoBanner} aria-label="Demo mode details">
            <p className={styles.demoText}>
              This is the <strong>AI Testing Demo Account</strong> with full access to accounts, credit cards, loans, EMIs, and transactions.
            </p>
            <div className={styles.demoActions}>
              <button
                className="button secondary"
                type="button"
                onClick={resetDemo}
              >
                Reset Demo Data
              </button>
              <button
                className="button"
                type="button"
                onClick={logout}
                disabled={busy}
              >
                <LogOut size={14} aria-hidden="true" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </section>
        )}

        {/* Workspace Shortcuts Card */}
        <section
          className={styles.shortcutsCard}
          aria-labelledby="profile-shortcuts-heading"
        >
          <h2 id="profile-shortcuts-heading" className={styles.sectionHeading}>
            Workspace Shortcuts
          </h2>
          <nav className={styles.shortcutsList} aria-label="Workspace navigation">
            <Link className={styles.shortcutRow} href="/notifications">
              <span className={styles.shortcutIcon} aria-hidden="true">
                <Bell size={18} />
              </span>
              <div className={styles.shortcutContent}>
                <strong>Reminders &amp; Alerts</strong>
                <span>Bill due dates &amp; payment reminders</span>
              </div>
              <ChevronRight size={17} className={styles.shortcutArrow} aria-hidden="true" />
            </Link>

            <Link className={styles.shortcutRow} href="/split-bills">
              <span className={styles.shortcutIcon} aria-hidden="true">
                <Users size={18} />
              </span>
              <div className={styles.shortcutContent}>
                <strong>Split Bills</strong>
                <span>Shared expenses, participants &amp; settlements</span>
              </div>
              <ChevronRight size={17} className={styles.shortcutArrow} aria-hidden="true" />
            </Link>

            <Link className={styles.shortcutRow} href="/loans">
              <span className={styles.shortcutIcon} aria-hidden="true">
                <HandCoins size={18} />
              </span>
              <div className={styles.shortcutContent}>
                <strong>Personal Loans</strong>
                <span>Borrowings, lendings &amp; repayments</span>
              </div>
              <ChevronRight size={17} className={styles.shortcutArrow} aria-hidden="true" />
            </Link>

            <Link className={styles.shortcutRow} href="/imports">
              <span className={styles.shortcutIcon} aria-hidden="true">
                <Upload size={18} />
              </span>
              <div className={styles.shortcutContent}>
                <strong>Import Records</strong>
                <span>Upload statements &amp; CSV files</span>
              </div>
              <ChevronRight size={17} className={styles.shortcutArrow} aria-hidden="true" />
            </Link>

            <Link className={styles.shortcutRow} href="/settings">
              <span className={styles.shortcutIcon} aria-hidden="true">
                <Settings size={18} />
              </span>
              <div className={styles.shortcutContent}>
                <strong>Workspace Settings</strong>
                <span>Data privacy, backup &amp; configuration</span>
              </div>
              <ChevronRight size={17} className={styles.shortcutArrow} aria-hidden="true" />
            </Link>
          </nav>
        </section>

        {/* Financial Accounts Hub */}
        <ProfileAccounts />

        {/* Compact Sign Out */}
        <div className={styles.signOutRow}>
          <button
            className={styles.signOutButton}
            type="button"
            onClick={logout}
            disabled={busy}
            aria-label="Sign out"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>

        {/* Minimal Centered Footer */}
        <footer className={styles.minimalFooter} aria-label="Creator branding">
          <p className={styles.footerBrand}>Made with ❤️ by Ashwini</p>
          <p className={styles.footerTagline}>MoneyNest · Personal Finance Manager</p>
        </footer>
      </div>
    );
  }

  return (
    <main className="private-access access-theme">
      <Link href="/dashboard" className="brand" aria-label="Money Nest home">
        <BrandLogo />
      </Link>
      <div className="private-access-card">
        <span className="login-icon" aria-hidden="true">
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
          <PasswordField
            label="Password"
            minLength={10}
            autoComplete={needsSetup ? "new-password" : "current-password"}
            placeholder="At least 10 characters"
          />
          {needsSetup && (
            <PasswordField
              label="Confirm password"
              name="confirmation"
              minLength={10}
              autoComplete="new-password"
            />
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
      </div>
    </main>
  );
}
