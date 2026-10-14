"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, LogOut, UserRound } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Badge, Field, PasswordField, Section } from "./ui";
import { HandoffImportPanel } from "./handoff-import-panel";

export function PrivateProfilePage() {
  const {
    mode,
    backend,
    profile,
    needsSetup,
    emailRequired,
    data,
    refresh,
    toast,
  } = useFinance();
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [transferInfo, setTransferInfo] = useState("");
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

  async function importToCloud() {
    if (!transferFile || transferBusy) return;
    setTransferBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await transferFile.text(),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Your transfer could not be imported.");
      setTransferFile(null);
      setTransferInfo("");
      await refresh();
      toast("Your profile is now available in the cloud.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Please try again.");
    } finally {
      setTransferBusy(false);
    }
  }

  function selectTransferFile(file: File | undefined) {
    setTransferFile(null);
    setTransferInfo("");
    setError("");
    if (!file) return;
    if (file.size > 4_000_000) {
      setError("Transfer file must be smaller than 4 MB.");
      return;
    }
    void file.text().then((text) => {
      try {
        const bundle = JSON.parse(text);
        if (
          bundle?.format !== "money-nest-private-export" ||
          bundle?.version !== 1 ||
          typeof bundle?.profile?.email !== "string"
        )
          throw new Error();
        setTransferFile(file);
        setTransferInfo(bundle.profile.email);
      } catch {
        setError("Choose a valid Money Nest transfer file.");
      }
    });
  }

  if ((mode === "private" || mode === "cloud") && profile) {
    return (
      <Section title="Your profile" className="profile-panel">
        <div className="profile-identity">
          <span className="profile-avatar">
            {profile.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h2>{profile.displayName}</h2>
            <p>
              {mode === "cloud"
                ? "Cloud profile · available on your devices"
                : "Private profile · saved on this computer"}
            </p>
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
          {mode === "private" && (
            <div className="info-banner profile-transfer">
              <div>
                <strong>Use this profile on your phone</strong>
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
            </div>
          )}
          {mode === "cloud" &&
            Object.values(data).every((rows) => rows.length === 0) && (
              <div className="info-banner profile-transfer">
                <div>
                  <strong>Bring your existing records to the cloud</strong>
                  <p>
                    Choose the transfer file from your computer. It must use the
                    same email as this account; your local copy stays on that
                    computer.
                  </p>
                </div>
                <Field label="Money Nest transfer file">
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) =>
                      selectTransferFile(event.currentTarget.files?.[0])
                    }
                  />
                </Field>
                {transferInfo && (
                  <>
                    <p>
                      Ready to import the local profile for{" "}
                      <strong>{transferInfo}</strong>.
                    </p>
                    <button
                      className="button primary"
                      type="button"
                      onClick={importToCloud}
                      disabled={transferBusy}
                    >
                      {transferBusy ? "Importing…" : "Import records to cloud"}
                    </button>
                  </>
                )}
              </div>
            )}
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
        {mode === "cloud" && <HandoffImportPanel />}
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
