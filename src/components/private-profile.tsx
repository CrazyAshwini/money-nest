"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Building2,
  ChevronRight,
  Database,
  LockKeyhole,
  LogOut,
  Settings,
  Upload,
  UserRound,
} from "lucide-react";
import { useFinance } from "./finance-provider";
import { BrandLogo } from "./brand-lockup";
import { Badge, Field, PasswordField } from "./ui";
import { NAV_ITEMS } from "./workspace-navigation";
import "./profile-theme.css";
import styles from "./private-profile.module.css";

export function PrivateProfilePage() {
  const { mode, backend, profile, needsSetup, emailRequired, refresh, toast } =
    useFinance();
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

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

  async function exportForCloud() {
    setTransferBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/export", {
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Your profile could not be exported.");
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "money-nest-transfer.json";
      anchor.click();
      URL.revokeObjectURL(url);
      toast(
        "Transfer file downloaded. Keep it private and upload it to your cloud profile.",
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Please try again.");
    } finally {
      setTransferBusy(false);
    }
  }

  if ((mode === "private" || mode === "cloud") && profile) {
    const emailDomain = profile.email?.split("@")[1];
    const maskedEmail = emailDomain
      ? `${profile.email!.slice(0, 1)}•••@${emailDomain}`
      : null;

    return (
      <div className={styles.hub}>
        <section className={styles.identity} aria-label="Signed-in profile">
          <span className={styles.avatar} aria-hidden="true">
            {profile.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div className={styles.identityDetails}>
            <h2>{profile.displayName}</h2>
            {maskedEmail && <p>{maskedEmail}</p>}
          </div>
          <Badge tone="green">Signed in</Badge>
        </section>
        <div className={styles.settingsGrid}>
          <section
            className={styles.card}
            aria-labelledby="profile-account-heading"
          >
            <h2 id="profile-account-heading">Account</h2>
            <form onSubmit={submit} className={styles.form}>
              <h3>Personal information</h3>
              <Field label="Profile name">
                <input
                  name="displayName"
                  defaultValue={profile.displayName}
                  maxLength={80}
                  autoComplete="nickname"
                  required
                />
              </Field>
              <p className={styles.region}>Indian rupee (INR) · Asia/Kolkata</p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className={styles.sessionActions}>
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
                  onClick={logout}
                  disabled={busy}
                >
                  <LogOut size={15} aria-hidden="true" />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </form>
            <Link className={styles.settingLink} href="/accounts">
              <Building2 size={19} aria-hidden="true" />
              <span>Linked accounts</span>
              <ChevronRight size={17} aria-hidden="true" />
            </Link>
          </section>
          <div className={styles.groups}>
            <section
              className={styles.card}
              aria-labelledby="profile-preferences-heading"
            >
              <h2 id="profile-preferences-heading">Preferences</h2>
              <Link className={styles.settingLink} href="/notifications">
                <Bell size={19} aria-hidden="true" />
                <span>Reminders</span>
                <ChevronRight size={17} aria-hidden="true" />
              </Link>
            </section>
            <section
              className={styles.card}
              aria-labelledby="profile-data-heading"
            >
              <h2 id="profile-data-heading">Data &amp; support</h2>
              <nav aria-label="Profile settings">
                <Link className={styles.settingLink} href="/settings#data">
                  <Database size={19} aria-hidden="true" />
                  <span>Data &amp; privacy</span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
                <Link className={styles.settingLink} href="/imports">
                  <Upload size={19} aria-hidden="true" />
                  <span>Import records</span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
                <Link className={styles.settingLink} href="/settings">
                  <Settings size={19} aria-hidden="true" />
                  <span>Workspace settings</span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              </nav>
            </section>
          </div>
        </div>
        {mode === "private" && (
          <section
            className={`${styles.card} ${styles.transfer}`}
            aria-labelledby="profile-transfer-heading"
          >
            <div>
              <h2 id="profile-transfer-heading">
                Use this profile on your phone
              </h2>
              <p>
                Download a private copy of your records, then sign in to the
                cloud profile and import it.
              </p>
            </div>
            <button
              className="button"
              type="button"
              onClick={exportForCloud}
              disabled={transferBusy}
            >
              {transferBusy ? "Preparing…" : "Download transfer file"}
            </button>
          </section>
        )}
        <nav
          className={`profile-workspace-navigation ${styles.card} ${styles.financeNavigation}`}
          aria-labelledby="profile-workspace-heading"
        >
          <h2 id="profile-workspace-heading">Explore Money Nest</h2>
          <div className={styles.financeLinks}>
            {NAV_ITEMS.filter(
              (item) => item.href !== "/orders" || mode === "private",
            ).map((item) => (
              <Link key={item.href} href={item.href}>
                <item.icon size={17} aria-hidden="true" />
                <span>{item.href === "/dashboard" ? "Home" : item.title}</span>
                <ChevronRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </nav>
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
