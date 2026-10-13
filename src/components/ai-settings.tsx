"use client";

import { useEffect, useState } from "react";
import { useFinance } from "./finance-provider";
import { Badge, Section } from "./ui";
import {
  receiptUploadMaxBytes,
  type ReceiptAISettings,
} from "@/lib/receipt-scan";

export function ReceiptAISettingsPanel() {
  const { mode } = useFinance();
  const [settings, setSettings] = useState<ReceiptAISettings | null>(null);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const signedIn = mode === "private" || mode === "cloud";
  useEffect(() => {
    if (!signedIn) return;
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
        if (
          typeof result.configured !== "boolean" ||
          typeof result.model !== "string" ||
          !result.model ||
          !(
            (result.provider === "Google Gemini" &&
              result.requiresRedaction === true) ||
            (result.provider === "Vercel AI Gateway" &&
              result.requiresRedaction === false)
          )
        )
          throw new Error(
            "Receipt AI provider information could not be confirmed. Try again.",
          );
        if (!controller.signal.aborted) {
          setSettings({
            configured: result.configured,
            provider: result.provider,
            model: result.model,
            requiresRedaction: result.requiresRedaction,
            maxUploadBytes: receiptUploadMaxBytes(
              mode === "cloud",
              result.maxUploadBytes,
            ),
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
  }, [mode, signedIn, loadAttempt]);

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
      >
        {!signedIn ? (
          <p className="muted">Sign in to your profile to scan receipts.</p>
        ) : (
          <>
            <div className="settings-row">
              <div>
                <strong>{settings?.provider || "Receipt scanning"}</strong>
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
                details, then save. Upload up to{" "}
                {receiptUploadMaxBytes(
                  mode === "cloud",
                  settings.maxUploadBytes,
                ) /
                  (1024 * 1024)}{" "}
                MB in total.
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
            {settings?.provider === "Google Gemini" ? (
              <>
                <p className="muted">
                  Scans send your image to Google Gemini. Google may use uploads
                  and responses to improve its products, and human reviewers may
                  review them.
                </p>
                <p className="muted">
                  Do not upload personal, confidential, or sensitive
                  information. Remove names, addresses, phone/email,
                  bank/card/account/UPI details, personal references, and QR
                  codes/barcodes before scanning. Images are not saved by this
                  app.
                </p>
              </>
            ) : settings?.provider === "Vercel AI Gateway" ? (
              <p className="muted">
                When you scan an image, it is sent to Vercel AI Gateway and
                OpenAI for reading. Images are not saved by this app.
              </p>
            ) : null}
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
