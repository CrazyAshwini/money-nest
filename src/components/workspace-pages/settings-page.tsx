"use client";

import { ReceiptAISettingsPanel } from "../ai-settings";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ShieldCheck, ArrowUpRight, LogOut } from "lucide-react";
import { useFinance } from "../finance-provider";
import { Section, Badge, downloadFile } from "../ui";
import { exportTransactionsCsv } from "@/lib/imports";

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
        body: JSON.stringify({ action: mode === "demo" ? "exit-demo" : "logout" }),
      });
      if (!response.ok) throw new Error(mode === "demo" ? "Demo exit failed. Please retry." : "Sign out failed. Please retry.");
      try { sessionStorage.removeItem("finance-os:mode"); } catch { /* The server session is authoritative. */ }
      const authenticated = await refresh();
      toast(mode === "demo" ? "Exited demo." : "Signed out.");
      router.replace(mode === "demo" && authenticated ? "/dashboard" : "/login");
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
                    : "Your private cloud workspace. Only your signed-in account can access its financial records."}
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
              {mode === "demo" ? (signingOut ? "Exiting demo…" : "Exit demo") : signingOut ? "Signing out…" : "Sign out"}
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
