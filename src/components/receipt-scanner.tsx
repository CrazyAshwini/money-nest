"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { Camera, ImagePlus, ScanLine, Upload, X } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Modal } from "./ui";
import { UploadedImagePreview } from "./uploaded-image-preview";
import {
  receiptUploadMaxBytes,
  MAX_RECEIPT_IMAGES,
  MAX_RECEIPT_TRANSACTIONS,
  findReceiptDuplicates,
  normalizeReceiptExtraction,
  receiptDraft,
  validateReceiptFile,
  type ReceiptExtraction,
  type ReceiptAISettings,
  type ReceiptScanResult,
} from "@/lib/receipt-scan";
import type { Transaction } from "@/lib/types";
import "./receipt-scanner.css";

export type AppliedReceipt = {
  draft: Partial<Transaction>;
  fingerprint: string;
  requiresPendingReview: boolean;
  canConfirmPayment?: boolean;
  paymentStatus?: ReceiptExtraction["paymentStatus"];
  confidence?: ReceiptExtraction["confidence"];
  documentType?: ReceiptExtraction["documentType"];
  accountHint?: string | null;
};

export function ReceiptScanner({
  onApply,
  onApplyBatch,
  compact = false,
  disabled = false,
}: {
  onApply: (receipt: AppliedReceipt) => void;
  onApplyBatch?: (receipts: AppliedReceipt[]) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { mode, data, userId } = useFinance();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const [settings, setSettings] = useState<ReceiptAISettings | null>(null);
  const [checking, setChecking] = useState(false);
  const [images, setImages] = useState<Array<{ file: File; url: string }>>([]);
  const [longBill, setLongBill] = useState(false);
  const [preview, setPreview] = useState<{
    photoId: string;
    opener: HTMLButtonElement;
  } | null>(null);
  const [result, setResult] = useState<ReceiptScanResult | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [applied, setApplied] = useState(false);
  const [redacted, setRedacted] = useState(false);
  const scanRequest = useRef<AbortController | null>(null);
  const settingsRequest = useRef<AbortController | null>(null);
  const imageFiles = useRef<Array<{ file: File; url: string }>>([]);
  const uploadInputs = useRef<Array<HTMLInputElement | null>>([]);
  const cameraInputs = useRef<Array<HTMLInputElement | null>>([]);
  const reviewPanel = useRef<HTMLDivElement | null>(null);
  const generation = useRef(0);
  const signedIn = mode === "private" || mode === "cloud";
  const maxUploadBytes = receiptUploadMaxBytes(
    mode === "cloud",
    settings?.maxUploadBytes,
  );
  const maxUploadMB = maxUploadBytes / (1024 * 1024);

  useEffect(() => {
    return () => {
      generation.current += 1;
      scanRequest.current?.abort();
      settingsRequest.current?.abort();
      for (const image of imageFiles.current) URL.revokeObjectURL(image.url);
    };
  }, []);

  useEffect(() => {
    if (open && result && !applied)
      reviewPanel.current?.scrollIntoView({ block: "start" });
  }, [open, result, applied]);

  function cancelScan() {
    generation.current += 1;
    scanRequest.current?.abort();
    scanRequest.current = null;
    setBusy(false);
  }

  async function checkSettings() {
    const previousProvider = settings?.provider;
    settingsRequest.current?.abort();
    const request = new AbortController();
    settingsRequest.current = request;
    setChecking(true);
    setSettings(null);
    setRedacted(false);
    setSettingsError("");
    try {
      const response = await fetch("/api/ai/settings", {
        cache: "no-store",
        signal: request.signal,
      });
      const body = await response.json();
      if (request.signal.aborted || settingsRequest.current !== request) return;
      if (!response.ok)
        throw new Error(body.error || "AI settings could not be loaded.");
      if (
        typeof body.configured !== "boolean" ||
        typeof body.model !== "string" ||
        !body.model ||
        !(
          (body.provider === "Google Gemini" &&
            body.requiresRedaction === true) ||
          (body.provider === "Vercel AI Gateway" &&
            body.requiresRedaction === false)
        )
      )
        throw new Error(
          "Receipt AI provider information could not be confirmed. Try again.",
        );
      setSettings({
        configured: body.configured,
        provider: body.provider,
        model: body.model,
        requiresRedaction: body.requiresRedaction,
        maxUploadBytes: receiptUploadMaxBytes(
          mode === "cloud",
          body.maxUploadBytes,
        ),
      });
      if (body.provider !== previousProvider) {
        setResult(null);
        setApplied(false);
      }
    } catch (failure) {
      if (request.signal.aborted || settingsRequest.current !== request) return;
      setSettings(null);
      setSettingsError(
        failure instanceof Error
          ? failure.message
          : "AI settings could not be loaded.",
      );
    } finally {
      if (!request.signal.aborted && settingsRequest.current === request)
        setChecking(false);
    }
  }

  function openScanner(event: MouseEvent<HTMLButtonElement>) {
    setOpener(event.currentTarget);
    if (signedIn) void checkSettings();
    setOpen(true);
  }

  function closeScanner() {
    // A quick Escape can reach the parent before Radix registers the viewer's
    // dismissable layer. Keep the scan draft and dismiss only its preview.
    if (preview) {
      setPreview(null);
      return;
    }
    cancelScan();
    settingsRequest.current?.abort();
    setChecking(false);
    setPreview(null);
    setOpen(false);
  }

  function resetReview() {
    cancelScan();
    setResult(null);
    setActiveIndex(0);
    setSelectedIndices([]);
    setApplied(false);
    setRedacted(false);
    setError("");
  }

  function updateImages(next: Array<{ file: File; url: string }>) {
    for (const image of imageFiles.current)
      if (!next.includes(image)) URL.revokeObjectURL(image.url);
    imageFiles.current = next;
    setImages(next);
  }

  function removeImage(index: number) {
    setPreview(null);
    resetReview();
    updateImages(
      imageFiles.current.filter((_, position) => position !== index),
    );
  }

  function chooseImages(files: File[], index: number) {
    if (!files.length) return;
    resetReview();
    const current = imageFiles.current;
    const nextFiles = longBill
      ? [
          ...current.slice(0, index).map((image) => image.file),
          ...files,
          ...current.slice(index + files.length).map((image) => image.file),
        ]
      : files;
    const invalid = nextFiles
      .map((file) => validateReceiptFile(file, maxUploadBytes))
      .find(Boolean);
    if (
      invalid ||
      nextFiles.length > (longBill ? MAX_RECEIPT_IMAGES : 1) ||
      nextFiles.reduce((total, file) => total + file.size, 0) > maxUploadBytes
    ) {
      updateImages([]);
      setError(
        invalid ||
          (nextFiles.length > (longBill ? MAX_RECEIPT_IMAGES : 1)
            ? longBill
              ? `Use up to ${MAX_RECEIPT_IMAGES} photos for one receipt.`
              : "Choose one photo, or enable multiple photos for a long bill."
            : `Use photos no larger than ${maxUploadMB} MB in total.`),
      );
      return;
    }
    updateImages(
      nextFiles.map(
        (file) =>
          current.find((image) => image.file === file) || {
            file,
            url: URL.createObjectURL(file),
          },
      ),
    );
  }

  function setMultiplePhotos(checked: boolean) {
    resetReview();
    setLongBill(checked);
    if (!checked) updateImages(imageFiles.current.slice(0, 1));
  }

  async function scan() {
    if (
      !images.length ||
      !settings?.configured ||
      !signedIn ||
      busy ||
      (settings.requiresRedaction && !redacted)
    )
      return;
    cancelScan();
    const request = new AbortController();
    scanRequest.current = request;
    const version = generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    setApplied(false);
    const form = new FormData();
    for (const image of images) form.append("image", image.file);
    form.set("consent", "true");
    form.set(
      "provider",
      settings.provider === "Google Gemini" ? "gemini" : "gateway",
    );
    form.set("model", settings.model);
    if (settings.requiresRedaction) form.set("redacted", "true");
    try {
      const response = await fetch("/api/ai/receipt", {
        method: "POST",
        body: form,
        signal: request.signal,
      });
      const body = await response.json();
      if (request.signal.aborted || version !== generation.current) return;
      if (!response.ok) {
        if (body.code === "provider_changed") {
          setSettings(null);
          setRedacted(false);
          setSettingsError(
            typeof body.error === "string"
              ? body.error
              : "Receipt AI settings changed. Refresh availability and try again.",
          );
          return;
        }
        throw new Error(
          body.error || "The image could not be scanned. Try again.",
        );
      }
      if (body.provider !== settings.provider) {
        setSettings(null);
        setRedacted(false);
        setSettingsError(
          "Receipt AI provider changed. Check availability and try again.",
        );
        return;
      }
      if (
        typeof body.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.fingerprint)
      )
        throw new Error("AI returned incomplete details. Try another image.");
      let extractions: ReceiptScanResult["extraction"][];
      let fingerprints: string[];
      try {
        const candidates =
          body.extractions === undefined ? [body.extraction] : body.extractions;
        if (
          !Array.isArray(candidates) ||
          !candidates.length ||
          candidates.length > MAX_RECEIPT_TRANSACTIONS
        )
          throw new Error("Invalid transaction list.");
        extractions = candidates.map(normalizeReceiptExtraction);
        fingerprints =
          body.fingerprints === undefined && extractions.length === 1
            ? [body.fingerprint]
            : body.fingerprints;
        if (
          !Array.isArray(fingerprints) ||
          fingerprints.length !== extractions.length ||
          fingerprints.some(
            (fingerprint) =>
              typeof fingerprint !== "string" ||
              !/^[a-f0-9]{64}$/.test(fingerprint),
          ) ||
          new Set(fingerprints).size !== fingerprints.length
        )
          throw new Error("Invalid transaction references.");
      } catch {
        throw new Error("AI returned incomplete details. Try another image.");
      }
      setResult({
        extraction: extractions[0],
        fingerprint: fingerprints[0],
        extractions,
        fingerprints,
        provider: body.provider,
        model: typeof body.model === "string" ? body.model : settings.model,
      });
      setActiveIndex(0);
      setSelectedIndices(
        extractions.flatMap((extraction, index) =>
          (!extraction.currency || extraction.currency === "INR") &&
          !findReceiptDuplicates(
            extraction,
            data.transactions.filter(
              (transaction) => transaction.userId === userId,
            ),
            fingerprints[index],
          ).length
            ? [index]
            : [],
        ),
      );
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

  const currentExtraction =
    result?.extractions?.[activeIndex] ?? result?.extraction;
  const currentFingerprint =
    result?.fingerprints?.[activeIndex] ?? result?.fingerprint;
  const multipleTransactions = Boolean(
    result?.extractions && result.extractions.length > 1,
  );
  const duplicates = currentExtraction
    ? findReceiptDuplicates(
        currentExtraction,
        data.transactions.filter(
          (transaction) => transaction.userId === userId,
        ),
        currentFingerprint,
      )
    : [];
  const foreignCurrency = Boolean(
    currentExtraction?.currency && currentExtraction.currency !== "INR",
  );

  function useDetails() {
    if (!result || busy) return;
    const indices = multipleTransactions ? selectedIndices : [activeIndex];
    const receipts = indices.flatMap((index) => {
      const extraction = result.extractions?.[index] ?? result.extraction;
      if (extraction.currency && extraction.currency !== "INR") return [];
      const requiresPendingReview =
        extraction.confidence === "low" ||
        extraction.documentType === "unknown" ||
        extraction.paymentStatus !== "successful";
      return [
        {
          draft: receiptDraft(extraction),
          fingerprint: result.fingerprints?.[index] ?? result.fingerprint,
          requiresPendingReview,
          canConfirmPayment: requiresPendingReview,
          paymentStatus: extraction.paymentStatus,
          confidence: extraction.confidence,
          documentType: extraction.documentType,
          accountHint: extraction.accountHint,
        },
      ];
    });
    if (!receipts.length) return;
    if (receipts.length > 1 && onApplyBatch) onApplyBatch(receipts);
    else onApply(receipts[0]);
    setApplied(true);
    closeScanner();
  }

  const photoSlots = longBill
    ? Math.min(images.length + 1, MAX_RECEIPT_IMAGES)
    : 1;

  return (
    <>
      {compact ? (
        <button
          type="button"
          className="receipt-compact-trigger"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={openScanner}
        >
          <Camera size={18} aria-hidden="true" />
          <span>Scan receipt</span>
        </button>
      ) : (
        <section className="receipt-scanner" aria-label="Receipt autofill">
          <div className="receipt-card-heading">
            <span className="receipt-camera-icon">
              <Camera size={21} aria-hidden="true" />
            </span>
            <div>
              <h3>Auto-Fill from Receipt</h3>
              <p>Take a photo or upload an image to fill in the details.</p>
            </div>
          </div>
          <div className="receipt-card-actions">
            <button
              type="button"
              className="receipt-pill receipt-camera-button"
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={openScanner}
            >
              <Camera size={19} aria-hidden="true" /> Take Photo
            </button>
            <button
              type="button"
              className="receipt-pill"
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={openScanner}
            >
              <Upload size={19} aria-hidden="true" /> Upload Image
            </button>
          </div>
        </section>
      )}
      {open && (
        <Modal
          title="Scan receipt"
          description="Take a photo or select an image from your device."
          onClose={closeScanner}
          className="receipt-modal"
          overlayClassName="receipt-modal-overlay"
          returnFocusTo={opener}
        >
          <div id={panelId} className="receipt-panel">
            {!signedIn ? (
              <p className="receipt-note">
                Sign in to your profile to scan a receipt.{" "}
                <Link href="/profile">Open profile</Link>
              </p>
            ) : (
              <>
                <label className="receipt-long-bill">
                  <input
                    type="checkbox"
                    checked={longBill}
                    disabled={busy}
                    onChange={(event) =>
                      setMultiplePhotos(event.target.checked)
                    }
                  />
                  <span>This receipt spans multiple photos (long bill)</span>
                </label>
                <div className="receipt-photo-list">
                  {Array.from({ length: photoSlots }, (_, index) => {
                    const image = images[index];
                    return (
                      <div className="receipt-photo-slot" key={index}>
                        <h3>
                          Photo {index + 1}
                          {index === 0 ? " (Primary)" : ""}
                          {index > 0 && !image && <small>Optional</small>}
                        </h3>
                        {image && (
                          <div className="receipt-image-row">
                            {/* Blob previews stay in this tab; no image proxy or upload. */}
                            <button
                              type="button"
                              className="receipt-preview-button"
                              aria-label={`Preview uploaded photo ${index + 1}: ${image.file.name}`}
                              aria-haspopup="dialog"
                              onClick={(event) =>
                                setPreview({
                                  photoId: image.url,
                                  opener: event.currentTarget,
                                })
                              }
                            >
                              <img
                                src={image.url}
                                alt={
                                  index === 0
                                    ? "Selected receipt preview"
                                    : `Receipt photo ${index + 1} preview`
                                }
                                className="receipt-preview"
                              />
                              <span>View</span>
                            </button>
                            <div>
                              <p className="receipt-file-name">
                                {image.file.name}
                              </p>
                              <button
                                type="button"
                                className="receipt-text-button receipt-preview-text"
                                aria-label={`Preview image ${index + 1}`}
                                aria-haspopup="dialog"
                                onClick={(event) =>
                                  setPreview({
                                    photoId: image.url,
                                    opener: event.currentTarget,
                                  })
                                }
                              >
                                Preview image
                              </button>
                              <button
                                type="button"
                                className="receipt-remove"
                                onClick={() => removeImage(index)}
                              >
                                <X size={13} aria-hidden="true" />
                                {index === 0
                                  ? "Remove image"
                                  : `Remove photo ${index + 1}`}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="receipt-photo-actions">
                          <button
                            type="button"
                            className="receipt-pill receipt-camera-button"
                            aria-label={
                              index === 0
                                ? "Camera"
                                : `Camera for photo ${index + 1}`
                            }
                            onClick={() => cameraInputs.current[index]?.click()}
                          >
                            <Camera size={18} aria-hidden="true" /> Camera
                          </button>
                          <button
                            type="button"
                            className="receipt-pill"
                            aria-label={
                              index === 0
                                ? "Upload"
                                : `Upload photo ${index + 1}`
                            }
                            onClick={() => uploadInputs.current[index]?.click()}
                          >
                            <ImagePlus size={18} aria-hidden="true" /> Upload
                          </button>
                        </div>
                        <input
                          ref={(input) => {
                            uploadInputs.current[index] = input;
                          }}
                          className="receipt-file-input"
                          type="file"
                          aria-label={
                            index === 0
                              ? "Payment screenshot or shopping receipt"
                              : `Receipt photo ${index + 1}`
                          }
                          accept="image/png,image/jpeg,image/webp"
                          multiple={longBill}
                          tabIndex={-1}
                          onChange={(event) => {
                            chooseImages(
                              Array.from(event.target.files || []),
                              index,
                            );
                            event.target.value = "";
                          }}
                        />
                        <input
                          ref={(input) => {
                            cameraInputs.current[index] = input;
                          }}
                          className="receipt-file-input"
                          type="file"
                          aria-label={
                            index === 0
                              ? "Take a receipt photo"
                              : `Take receipt photo ${index + 1}`
                          }
                          accept="image/png,image/jpeg,image/webp"
                          capture="environment"
                          tabIndex={-1}
                          onChange={(event) => {
                            chooseImages(
                              Array.from(event.target.files || []),
                              index,
                            );
                            event.target.value = "";
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="receipt-file-hint">
                  PNG, JPEG or WebP ·{" "}
                  {longBill ? `up to ${MAX_RECEIPT_IMAGES} photos, ` : ""}
                  {maxUploadMB} MB total
                  {longBill && (
                    <span>
                      Keep photos in receipt order. They form one transaction.
                    </span>
                  )}
                </p>
                {checking ? (
                  <p className="receipt-note" role="status">
                    Checking receipt AI availability…
                  </p>
                ) : settings && !settings.configured ? (
                  <p className="receipt-note">
                    Receipt scanning is unavailable. The app owner needs to
                    enable receipt scanning. You can still add transactions
                    manually.
                  </p>
                ) : null}
                {settings?.provider === "Google Gemini" ? (
                  <div className="receipt-warning">
                    <p id={`${panelId}-gemini-terms`}>
                      Scanning sends the selected photos to Google Gemini.
                      Google may use uploads and responses to improve its
                      products, and human reviewers may review them.
                    </p>
                    <p id={`${panelId}-redaction-guidance`}>
                      Do not upload personal, confidential, or sensitive
                      information. Remove names, addresses, phone/email,
                      bank/card/account/UPI details, personal references, and QR
                      codes/barcodes before scanning.
                    </p>
                    {images.length > 0 && (
                      <label className="receipt-review-check">
                        <input
                          type="checkbox"
                          aria-describedby={`${panelId}-gemini-terms ${panelId}-redaction-guidance`}
                          checked={redacted}
                          disabled={busy}
                          onChange={(event) =>
                            setRedacted(event.target.checked)
                          }
                        />
                        <span>
                          I removed personal, banking and other sensitive
                          information from this image
                          {longBill && (
                            <small>Confirm this for every photo.</small>
                          )}
                        </span>
                      </label>
                    )}
                  </div>
                ) : settings?.provider === "Vercel AI Gateway" ? (
                  <p className="receipt-disclosure">
                    Image sent to Vercel AI Gateway and OpenAI for extraction.
                    Review before saving.
                  </p>
                ) : (
                  <p className="receipt-disclosure">
                    The cloud destination will be shown when receipt AI
                    availability is confirmed.
                  </p>
                )}
                <div className="receipt-retry-actions">
                  {!checking && !settings && (
                    <button
                      type="button"
                      className="receipt-text-button"
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
                {result && currentExtraction && (
                  <div
                    ref={reviewPanel}
                    className="receipt-result"
                    aria-label="AI receipt review"
                  >
                    <h3>Review extracted details</h3>
                    {multipleTransactions && (
                      <div className="receipt-candidates">
                        <p className="receipt-note">
                          {result.extractions!.length} transactions found.
                          Select the ones to review and save.
                        </p>
                        {result.extractions!.map((extraction, index) => {
                          const foreign = Boolean(
                            extraction.currency &&
                            extraction.currency !== "INR",
                          );
                          const duplicate =
                            findReceiptDuplicates(
                              extraction,
                              data.transactions.filter(
                                (transaction) => transaction.userId === userId,
                              ),
                              result.fingerprints?.[index],
                            ).length > 0;
                          return (
                            <div
                              className="receipt-candidate"
                              key={result.fingerprints?.[index] ?? index}
                            >
                              <label className="receipt-review-check">
                                <input
                                  type="checkbox"
                                  aria-label={`Select transaction ${index + 1}`}
                                  checked={selectedIndices.includes(index)}
                                  disabled={foreign || busy}
                                  onChange={(event) => {
                                    setActiveIndex(index);
                                    setSelectedIndices((current) =>
                                      event.target.checked
                                        ? onApplyBatch
                                          ? [...current, index].sort(
                                              (a, b) => a - b,
                                            )
                                          : [index]
                                        : current.filter(
                                            (position) => position !== index,
                                          ),
                                    );
                                  }}
                                />
                                <span>
                                  <strong>
                                    {extraction.currency ||
                                      "Currency unconfirmed"}{" "}
                                    {extraction.amount || "Amount unconfirmed"}
                                  </strong>
                                  <small>
                                    {extraction.description ||
                                      extraction.merchant ||
                                      `Transaction ${index + 1}`}{" "}
                                    ·{" "}
                                    {extraction.occurredOn ||
                                      "Date unconfirmed"}
                                  </small>
                                  {duplicate && (
                                    <small>
                                      Possible duplicate — not selected
                                      automatically.
                                    </small>
                                  )}
                                  {foreign && (
                                    <small>
                                      Convert to a verified INR amount manually.
                                    </small>
                                  )}
                                </span>
                              </label>
                              <button
                                type="button"
                                className="receipt-text-button"
                                aria-label={`Review transaction ${index + 1}`}
                                aria-pressed={activeIndex === index}
                                onClick={() => setActiveIndex(index)}
                              >
                                Review
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <dl className="receipt-details">
                      <div>
                        <dt>Amount</dt>
                        <dd>
                          {currentExtraction.amount
                            ? `${currentExtraction.currency || "Currency unconfirmed"} ${currentExtraction.amount}`
                            : "Unconfirmed"}
                        </dd>
                      </div>
                      <div>
                        <dt>Date</dt>
                        <dd>{currentExtraction.occurredOn || "Unconfirmed"}</dd>
                      </div>
                      <div>
                        <dt>Seller</dt>
                        <dd>{currentExtraction.merchant || "Unconfirmed"}</dd>
                      </div>
                      <div>
                        <dt>Platform</dt>
                        <dd>{currentExtraction.platform || "Unconfirmed"}</dd>
                      </div>
                      <div>
                        <dt>Reference</dt>
                        <dd>
                          {currentExtraction.externalReference || "Unconfirmed"}
                        </dd>
                      </div>
                      <div>
                        <dt>Payment method</dt>
                        <dd>
                          {currentExtraction.accountHint || "Unconfirmed"}
                        </dd>
                      </div>
                      <div>
                        <dt>Payment status</dt>
                        <dd>
                          {currentExtraction.paymentStatus.replaceAll("_", " ")}
                        </dd>
                      </div>
                    </dl>
                    {currentExtraction.warnings.length > 0 && (
                      <div className="receipt-warning" role="status">
                        <strong>Check before saving</strong>
                        <ul>
                          {currentExtraction.warnings.map((warning, index) => (
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
                              {transaction.description} · ₹{transaction.amount}{" "}
                              · {transaction.occurredOn || "Date unconfirmed"}
                            </li>
                          ))}
                        </ul>
                        <p>
                          Check your ledger before adding this transaction
                          again.
                        </p>
                      </div>
                    )}
                    {foreignCurrency && (
                      <p className="receipt-warning" role="alert">
                        This image uses {currentExtraction.currency}. Your
                        ledger uses INR, so these details cannot be applied.
                        Enter a verified INR amount manually.
                      </p>
                    )}
                    <p className="receipt-note">
                      Choose the payment account yourself. AI does not match or
                      access your accounts.
                    </p>
                    <button
                      type="button"
                      className="receipt-text-button"
                      onClick={() => void scan()}
                      disabled={
                        !settings?.configured ||
                        checking ||
                        busy ||
                        Boolean(settings?.requiresRedaction && !redacted)
                      }
                    >
                      Scan again
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
            {settingsError && (
              <p className="error" role="alert">
                {settingsError}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="receipt-footer">
            <button
              type="button"
              className="receipt-pill"
              onClick={busy ? cancelScan : closeScanner}
            >
              {busy ? "Cancel scan" : "Cancel"}
            </button>
            {signedIn &&
              (result ? (
                <button
                  type="button"
                  className="receipt-pill receipt-primary"
                  onClick={useDetails}
                  disabled={
                    (multipleTransactions
                      ? !selectedIndices.length
                      : foreignCurrency) ||
                    applied ||
                    busy
                  }
                >
                  {applied
                    ? "Details applied"
                    : multipleTransactions
                      ? "Use selected details"
                      : "Use details"}
                </button>
              ) : (
                <button
                  type="button"
                  className="receipt-pill receipt-primary"
                  aria-label={busy ? "Scanning…" : "Scan with AI"}
                  onClick={() => void scan()}
                  disabled={
                    !images.length ||
                    !settings?.configured ||
                    checking ||
                    busy ||
                    Boolean(settings?.requiresRedaction && !redacted)
                  }
                >
                  <ScanLine size={16} aria-hidden="true" />
                  {busy ? "Scanning…" : "Start Scan"}
                </button>
              ))}
          </div>
          {preview && images.length > 0 && (
            <UploadedImagePreview
              key={preview.photoId}
              photos={images.map((image) => ({
                id: image.url,
                name: image.file.name,
                url: image.url,
              }))}
              initialPhotoId={preview.photoId}
              returnFocusTo={preview.opener}
              onClose={() => setPreview(null)}
            />
          )}
        </Modal>
      )}
    </>
  );
}
