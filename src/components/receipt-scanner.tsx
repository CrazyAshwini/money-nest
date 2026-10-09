"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, FileImage, ScanLine } from "lucide-react";
import { useFinance } from "./finance-provider";
import {
  findReceiptDuplicates,
  normalizeReceiptExtraction,
  receiptDraft,
  validateReceiptFile,
  type ReceiptScanResult,
} from "@/lib/receipt-scan";
import type { Transaction } from "@/lib/types";
import "./receipt-scanner.css";

export type AppliedReceipt = {
  draft: Partial<Transaction>;
  fingerprint: string;
  requiresPendingReview: boolean;
};

type AiSettings = {
  configured: boolean;
  provider: string;
  model: string;
};

export function ReceiptScanner({
  onApply,
}: {
  onApply: (receipt: AppliedReceipt) => void;
}) {
  const { mode, data, userId } = useFinance();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [checking, setChecking] = useState(false);
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [result, setResult] = useState<ReceiptScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const scanRequest = useRef<AbortController | null>(null);
  const settingsRequest = useRef<AbortController | null>(null);
  const imageUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const signedIn = mode === "private";

  useEffect(() => {
    return () => {
      generation.current += 1;
      scanRequest.current?.abort();
      settingsRequest.current?.abort();
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    };
  }, []);

  function cancelScan() {
    generation.current += 1;
    scanRequest.current?.abort();
    scanRequest.current = null;
    setBusy(false);
  }

  async function checkSettings() {
    settingsRequest.current?.abort();
    const request = new AbortController();
    settingsRequest.current = request;
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/ai/settings", {
        cache: "no-store",
        signal: request.signal,
      });
      const body = await response.json();
      if (request.signal.aborted || settingsRequest.current !== request) return;
      if (!response.ok)
        throw new Error(body.error || "AI settings could not be loaded.");
      setSettings({
        configured: body.configured === true,
        provider: "Vercel AI Gateway",
        model: typeof body.model === "string" ? body.model : "",
      });
    } catch (failure) {
      if (request.signal.aborted || settingsRequest.current !== request) return;
      setSettings(null);
      setError(
        failure instanceof Error
          ? failure.message
          : "AI settings could not be loaded.",
      );
    } finally {
      if (!request.signal.aborted && settingsRequest.current === request)
        setChecking(false);
    }
  }

  function toggle() {
    if (open) {
      cancelScan();
      settingsRequest.current?.abort();
      setChecking(false);
    } else if (signedIn) {
      void checkSettings();
    }
    setOpen(!open);
  }

  function removeImage() {
    cancelScan();
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = null;
    setImage(null);
    setResult(null);
    setApplied(false);
    setError("");
  }

  function chooseImage(file: File | undefined) {
    if (!file) return;
    removeImage();
    const invalid = validateReceiptFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    const url = URL.createObjectURL(file);
    imageUrl.current = url;
    setImage({ file, url });
  }

  async function scan() {
    if (!image || !settings?.configured || !signedIn || busy) return;
    cancelScan();
    const request = new AbortController();
    scanRequest.current = request;
    const version = generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    setApplied(false);
    const form = new FormData();
    form.set("image", image.file);
    form.set("consent", "true");
    try {
      const response = await fetch("/api/ai/receipt", {
        method: "POST",
        body: form,
        signal: request.signal,
      });
      const body = await response.json();
      if (request.signal.aborted || version !== generation.current) return;
      if (!response.ok)
        throw new Error(
          body.error || "The image could not be scanned. Try again.",
        );
      if (
        typeof body.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.fingerprint)
      )
        throw new Error("AI returned incomplete details. Try another image.");
      let extraction: ReceiptScanResult["extraction"];
      try {
        extraction = normalizeReceiptExtraction(body.extraction);
      } catch {
        throw new Error("AI returned incomplete details. Try another image.");
      }
      setResult({
        extraction,
        fingerprint: body.fingerprint,
        provider: "Vercel AI Gateway",
        model: typeof body.model === "string" ? body.model : settings.model,
      });
    } catch (failure) {
      if (request.signal.aborted || version !== generation.current) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "The image could not be scanned. Try again.",
      );
    } finally {
      if (!request.signal.aborted && version === generation.current) {
        setBusy(false);
        scanRequest.current = null;
      }
    }
  }

  const duplicates = result
    ? findReceiptDuplicates(
        result.extraction,
        data.transactions.filter(
          (transaction) => transaction.userId === userId,
        ),
        result.fingerprint,
      )
    : [];
  const foreignCurrency = Boolean(
    result?.extraction.currency && result.extraction.currency !== "INR",
  );

  function useDetails() {
    if (!result || foreignCurrency || busy) return;
    const { extraction } = result;
    onApply({
      draft: receiptDraft(extraction),
      fingerprint: result.fingerprint,
      requiresPendingReview:
        extraction.confidence === "low" ||
        extraction.documentType === "unknown" ||
        extraction.paymentStatus === "pending" ||
        extraction.paymentStatus === "failed" ||
        (extraction.documentType === "payment" &&
          extraction.paymentStatus !== "successful"),
    });
    setApplied(true);
  }

  return (
    <section className="receipt-scanner">
      <button
        type="button"
        className="receipt-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <FileImage size={16} aria-hidden="true" />
        <span>Add from a receipt</span>
        <ChevronDown
          size={15}
          className={open ? "receipt-chevron open" : "receipt-chevron"}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={panelId} className="receipt-panel">
          {!signedIn ? (
            <p className="receipt-note">
              Sign in to your private profile to scan a receipt.{" "}
              <Link href="/profile">Open profile</Link>
            </p>
          ) : (
            <>
              <label className="receipt-upload">
                <span>Payment screenshot or shopping receipt</span>
                <input
                  type="file"
                  aria-label="Payment screenshot or shopping receipt"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    chooseImage(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <small>PNG, JPEG or WebP · up to 5 MB</small>
              </label>
              {image && (
                <div className="receipt-image-row">
                  {/* A local blob URL stays in this tab and does not use an image proxy. */}
                  <img
                    src={image.url}
                    alt="Selected receipt preview"
                    className="receipt-preview"
                  />
                  <div>
                    <p className="receipt-file-name">{image.file.name}</p>
                    <button
                      type="button"
                      className="button small"
                      onClick={removeImage}
                    >
                      Remove image
                    </button>
                  </div>
                </div>
              )}
              {checking ? (
                <p className="receipt-note" role="status">
                  Checking receipt AI availability…
                </p>
              ) : settings && !settings.configured ? (
                <p className="receipt-note">
                  Receipt scanning is unavailable. The app owner needs to enable
                  receipt scanning. You can still add transactions manually.
                </p>
              ) : null}
              <p className="receipt-disclosure">
                Image sent to Vercel AI Gateway and OpenAI for extraction.
                Review before saving.
              </p>
              <div className="receipt-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void scan()}
                  disabled={!image || !settings?.configured || checking || busy}
                >
                  <ScanLine size={14} aria-hidden="true" />{" "}
                  {busy ? "Scanning…" : "Scan with AI"}
                </button>
                {busy && (
                  <button type="button" className="button" onClick={cancelScan}>
                    Cancel scan
                  </button>
                )}
                {!checking && !settings && (
                  <button
                    type="button"
                    className="button small"
                    onClick={() => void checkSettings()}
                  >
                    Retry receipt AI
                  </button>
                )}
              </div>
              {busy && (
                <p className="receipt-note" role="status">
                  Reading the image. Your transaction fields stay unchanged
                  until you use the details.
                </p>
              )}
              {result && (
                <div className="receipt-result" aria-label="AI receipt review">
                  <h3>Review extracted details</h3>
                  <dl className="receipt-details">
                    <div>
                      <dt>Amount</dt>
                      <dd>
                        {result.extraction.amount
                          ? `${result.extraction.currency || "Currency unconfirmed"} ${result.extraction.amount}`
                          : "Unconfirmed"}
                      </dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{result.extraction.occurredOn || "Unconfirmed"}</dd>
                    </div>
                    <div>
                      <dt>Merchant</dt>
                      <dd>{result.extraction.merchant || "Unconfirmed"}</dd>
                    </div>
                    <div>
                      <dt>Reference</dt>
                      <dd>
                        {result.extraction.externalReference || "Unconfirmed"}
                      </dd>
                    </div>
                    <div>
                      <dt>Payment method</dt>
                      <dd>{result.extraction.accountHint || "Unconfirmed"}</dd>
                    </div>
                    <div>
                      <dt>Payment status</dt>
                      <dd>
                        {result.extraction.paymentStatus.replaceAll("_", " ")}
                      </dd>
                    </div>
                  </dl>
                  {result.extraction.warnings.length > 0 && (
                    <div className="receipt-warning" role="status">
                      <strong>Check before saving</strong>
                      <ul>
                        {result.extraction.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {duplicates.length > 0 && (
                    <div className="receipt-warning" role="alert">
                      <strong>Possible duplicate transactions</strong>
                      <ul>
                        {duplicates.slice(0, 5).map((transaction) => (
                          <li key={transaction.id}>
                            {transaction.description} · ₹{transaction.amount} ·{" "}
                            {transaction.occurredOn || "Date unconfirmed"}
                          </li>
                        ))}
                      </ul>
                      <p>
                        Check your ledger before adding this transaction again.
                      </p>
                    </div>
                  )}
                  {foreignCurrency && (
                    <p className="receipt-warning" role="alert">
                      This image uses {result.extraction.currency}. Your ledger
                      uses INR, so these details cannot be applied. Enter a
                      verified INR amount manually.
                    </p>
                  )}
                  <p className="receipt-note">
                    Choose the payment account yourself. AI does not match or
                    access your accounts.
                  </p>
                  <button
                    type="button"
                    className="button"
                    onClick={useDetails}
                    disabled={foreignCurrency || applied}
                  >
                    {applied ? "Details applied" : "Use details"}
                  </button>
                  {applied && (
                    <p className="receipt-note" role="status">
                      Details applied below. Review and save the transaction
                      when ready.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
