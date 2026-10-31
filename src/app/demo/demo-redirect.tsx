"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFinance } from "@/components/finance-provider";

export function DemoRedirect() {
  const router = useRouter();
  const { refresh, toast } = useFinance();
  const [error, setError] = useState("");

  useEffect(() => {
    async function startDemo() {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "login",
            email: "demo@moneynest.com",
            password: "demo1234",
          }),
        });
        if (!res.ok) throw new Error("Could not initialize demo session.");
        await refresh();
        toast("Welcome to the Money Nest Demo Account!");
        router.replace("/dashboard");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to enter demo.");
        setTimeout(() => router.replace("/login?demo=1"), 1200);
      }
    }
    void startDemo();
  }, [refresh, router, toast]);

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
          Preparing all accounts, credit cards, loans, EMIs, and transactions for AI testing…
        </p>
        {error ? (
          <p style={{ color: "#ff8585", fontSize: "12px" }}>{error}</p>
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
