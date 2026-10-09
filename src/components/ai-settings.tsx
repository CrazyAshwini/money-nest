"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Badge, Section } from "./ui";
import type { ReceiptAISettings } from "@/lib/receipt-scan";

export function ReceiptAISettingsPanel() {
  const { mode } = useFinance();
  const [settings, setSettings] = useState<ReceiptAISettings | null>(null);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (mode !== "private") return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/ai/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Receipt AI availability could not be loaded.",
          );
        if (typeof result.configured !== "boolean")
          throw new Error("Receipt AI availability could not be loaded.");
        if (!controller.signal.aborted) {
          setSettings({
            configured: result.configured,
            provider:
              typeof result.provider === "string"
                ? result.provider
                : "Vercel AI Gateway",
            model: typeof result.model === "string" ? result.model : "",
          });
          setError("");
        }
      } catch (issue) {
        if (!controller.signal.aborted)
          setError(
            issue instanceof Error
              ? issue.message
              : "Receipt AI availability could not be loaded.",
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [mode, loadAttempt]);

  function retry() {
    setSettings(null);
    setError("");
    setLoadAttempt((attempt) => attempt + 1);
  }

  return (
    <div id="ai" className="receipt-ai-settings">
      <Section
        title="Receipt AI"
        subtitle="Create transactions from payment screenshots and shopping receipts."
        action={<Sparkles size={18} />}
      >
        {mode !== "private" ? (
          <p className="muted">
            Sign in to your private profile to scan receipts.
          </p>
        ) : (
          <>
            <div className="settings-row">
              <div>
                <strong>Receipt scanning</strong>
                <p>
                  Receipt scanning is provided by the app. You do not need an
                  API key.
                </p>
              </div>
              <Badge tone={settings?.configured ? "green" : "amber"}>
                {settings
                  ? settings.configured
                    ? "Ready"
                    : "Unavailable"
                  : error
                    ? "Status unavailable"
                    : "Checking…"}
              </Badge>
            </div>
            {settings?.configured ? (
              <p className="muted">
                Upload an image in Add transaction, review the extracted
                details, then save.
              </p>
            ) : settings ? (
              <p className="muted">
                Receipt scanning is unavailable. The app owner needs to enable
                receipt scanning. You can still add transactions manually.
              </p>
            ) : !error ? (
              <p className="muted" role="status">
                Checking receipt AI availability…
              </p>
            ) : null}
            <p className="muted">
              When you scan an image, it is sent to Vercel AI Gateway and OpenAI
              for reading. Images are not saved by this app.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {(settings || error) && (
              <div className="receipt-ai-actions">
                <button type="button" className="button" onClick={retry}>
                  {error ? "Retry AI settings" : "Check availability"}
                </button>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
