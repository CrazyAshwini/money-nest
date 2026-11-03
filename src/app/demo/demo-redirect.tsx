"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFinance } from "@/components/finance-provider";

export function DemoRedirect() {
  const router = useRouter();
  const { refresh, mode, backend } = useFinance();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const startedAttempt = useRef<number | null>(null);
  const displayError =
    error ||
    (backend === "local"
      ? "The demo is available in the cloud app. Your private profile stays on this computer."
      : mode === "error"
        ? "The demo workspace could not be opened. Please retry."
        : "");

  useEffect(() => {
    if (mode === "demo") {
      router.replace("/dashboard");
      return;
    }
    if (
      mode === "loading" ||
      backend === "local" ||
      startedAttempt.current === attempt
    )
      return;
    startedAttempt.current = attempt;
    const request = new AbortController();
    let active = true;
    let authSettled = false;
    async function startDemo() {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: request.signal,
          body: JSON.stringify({
            action: "login",
            email: "demo@moneynest.com",
            password: "demo1234",
          }),
        });
        authSettled = true;
        if (!res.ok) throw new Error("Could not initialize demo session.");
        if (!active) return;
        if (!(await refresh()))
          throw new Error(
            "The demo workspace could not be opened. Please retry.",
          );
        if (active) router.replace("/dashboard");
      } catch (err) {
        authSettled = true;
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to enter demo.");
      }
    }
    void startDemo();
    return () => {
      active = false;
      request.abort();
      // Development effect replay cancels an unfinished request before starting
      // it again. Completed attempts stay guarded until an explicit retry.
      if (!authSettled && startedAttempt.current === attempt)
        startedAttempt.current = null;
    };
  }, [refresh, router, attempt, mode, backend]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#081b14",
        color: "#e2ede6",
        padding: "20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          background: "#0f2d22",
          border: "1px solid #1e4738",
          borderRadius: "16px",
          padding: "32px 24px",
          maxWidth: "400px",
          width: "100%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ fontSize: "28px", marginBottom: "12px" }}>🧪</div>
        <h2 style={{ fontSize: "18px", fontWeight: 650, margin: "0 0 8px 0" }}>
          Launching Demo Workspace
        </h2>
        <p
          style={{
            fontSize: "13px",
            color: "#8ca898",
            margin: "0 0 16px 0",
            lineHeight: 1.5,
          }}
        >
          Preparing all accounts, credit cards, loans, EMIs, and transactions
          for AI testing…
        </p>
        {displayError ? (
          <>
            <p role="alert" style={{ color: "#ff8585", fontSize: "12px" }}>
              {displayError}
            </p>
            {backend !== "local" && (
              <button
                className="button primary"
                onClick={() => {
                  setError("");
                  setAttempt((current) => current + 1);
                }}
              >
                Retry demo
              </button>
            )}
            <button className="button" onClick={() => router.replace("/login")}>
              Back to sign in
            </button>
          </>
        ) : (
          <div
            style={{
              display: "inline-block",
              width: "20px",
              height: "20px",
              border: "2px solid #8ca898",
              borderTopColor: "#3dd68c",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
