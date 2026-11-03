"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LockKeyhole, ArrowRight } from "lucide-react";
import { useFinance } from "../finance-provider";
import { PasswordField } from "../ui";
import { LoginStory, MobileAccessBrand } from "./access-story";

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
