"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Camera, ImagePlus, ScanLine, X } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Modal } from "./ui";
import { UploadedImagePreview } from "./uploaded-image-preview";
import {
  receiptUploadMaxBytes,
  MAX_RECEIPT_IMAGES,
  validateReceiptFile,
  type ReceiptAISettings,
} from "@/lib/receipt-scan";
import { orderModuleRoute } from "@/lib/commerce";
import { orderScanResultSchema, type OrderScanResult } from "@/lib/scan-orders";
import "./receipt-scanner.css";
import "./order-scanner.css";

type DraftImage = { file: File; url: string };

export function OrderScanner({
  onExtract,
  intent = "orders",
}: {
  onExtract: (result: OrderScanResult) => void;
  intent?: "orders" | "refunds";
}) {
  const { mode } = useFinance();
  const panelId = useId();
  const signedIn = mode === "private" || mode === "cloud";
  const refundScan = intent === "refunds";
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ReceiptAISettings | null>(null);
  const maxUploadBytes = receiptUploadMaxBytes(
    mode === "cloud",
    settings?.maxUploadBytes,
  );
  const maxUploadMB = maxUploadBytes / (1024 * 1024);
  const [checking, setChecking] = useState(false);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [preview, setPreview] = useState<{
    photoId: string;
    opener: HTMLButtonElement;
  } | null>(null);
  const [result, setResult] = useState<OrderScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [redacted, setRedacted] = useState(false);
  const [error, setError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const scanRequest = useRef<AbortController | null>(null);
  const settingsRequest = useRef<AbortController | null>(null);
  const imageFiles = useRef<DraftImage[]>([]);
  const uploadInputs = useRef<Array<HTMLInputElement | null>>([]);
  const cameraInputs = useRef<Array<HTMLInputElement | null>>([]);
  const resultPanel = useRef<HTMLDivElement | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    return () => {
      generation.current += 1;
      scanRequest.current?.abort();
      settingsRequest.current?.abort();
      for (const image of imageFiles.current) URL.revokeObjectURL(image.url);
    };
  }, []);

  useEffect(() => {
    if (open && result) resultPanel.current?.scrollIntoView({ block: "start" });
  }, [open, result]);

  function cancelScan() {
    generation.current += 1;
    scanRequest.current?.abort();
    scanRequest.current = null;
    setBusy(false);
  }

  function closeScanner() {
    // Keep the upload draft when Escape arrives during the viewer's layer setup.
    if (preview) {
      setPreview(null);
      return;
    }
    cancelScan();
    settingsRequest.current?.abort();
    setChecking(false);
    setOpen(false);
  }

  async function checkSettings() {
    const previousProvider = settings?.provider;
    const previousModel = settings?.model;
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
        throw new Error(body.error || "AI availability could not be checked.");
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
          "AI provider information could not be confirmed. Try again.",
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
      if (body.provider !== previousProvider || body.model !== previousModel)
        setResult(null);
    } catch (failure) {
      if (request.signal.aborted || settingsRequest.current !== request) return;
      setSettings(null);
      setSettingsError(
        failure instanceof Error
          ? failure.message
          : "AI availability could not be checked.",
      );
    } finally {
      if (!request.signal.aborted && settingsRequest.current === request)
        setChecking(false);
    }
  }

  function openScanner() {
    if (signedIn) void checkSettings();
    setOpen(true);
  }

  function resetReview() {
    cancelScan();
    setResult(null);
    setRedacted(false);
    setError("");
  }

  function updateImages(next: DraftImage[]) {
    for (const image of imageFiles.current)
      if (!next.includes(image)) URL.revokeObjectURL(image.url);
    imageFiles.current = next;
    setImages(next);
  }

  function chooseImages(files: File[], index: number) {
    if (!files.length) return;
    resetReview();
    setPreview(null);
    const current = imageFiles.current;
    const nextFiles = [
      ...current.slice(0, index).map((image) => image.file),
      ...files,
      ...current.slice(index + files.length).map((image) => image.file),
    ];
    const invalid = nextFiles
      .map((file) => validateReceiptFile(file, maxUploadBytes))
      .find(Boolean);
    if (
      invalid ||
      nextFiles.length > MAX_RECEIPT_IMAGES ||
      nextFiles.reduce((total, file) => total + file.size, 0) > maxUploadBytes
    ) {
      updateImages([]);
      setError(
        invalid ||
          (nextFiles.length > MAX_RECEIPT_IMAGES
            ? `Choose up to ${MAX_RECEIPT_IMAGES} screenshots.`
            : `Use screenshots no larger than ${maxUploadMB} MB in total.`),
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

  function removeImage(index: number) {
    setPreview(null);
    resetReview();
    updateImages(
      imageFiles.current.filter((_, position) => position !== index),
    );
  }

  async function scan() {
    if (
      !signedIn ||
      !images.length ||
      !settings?.configured ||
      checking ||
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
      const response = await fetch("/api/ai/orders", {
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
              : "AI settings changed. Refresh availability and try again.",
          );
          return;
        }
        throw new Error(
          body.error || "These screenshots could not be scanned. Try again.",
        );
      }
      if (
        body.provider !== settings.provider ||
        body.model !== settings.model
      ) {
        setSettings(null);
        setRedacted(false);
        setSettingsError(
          "AI settings changed. Refresh availability and try again.",
        );
        return;
      }
      const parsed = orderScanResultSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.extraction.orders.some((order) =>
          order.sourceImageIndices.some(
            (imageIndex) => imageIndex >= images.length,
          ),
        )
      )
        throw new Error(
          "AI returned incomplete order details. Try another screenshot.",
        );
      setResult(parsed.data);
    } catch (failure) {
      if (request.signal.aborted || version !== generation.current) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "These screenshots could not be scanned. Try again.",
      );
    } finally {
      if (!request.signal.aborted && version === generation.current) {
        setBusy(false);
        scanRequest.current = null;
      }
    }
  }

  function reviewOrders() {
    if (!result || busy || !result.extraction.orders.length) return;
    onExtract(result);
    closeScanner();
  }

  const photoSlots = Math.min(images.length + 1, MAX_RECEIPT_IMAGES);
  const moduleRoute = result
    ? orderModuleRoute(result.extraction.sourceType)
    : null;
  const moduleLabel =
    moduleRoute === "/imports"
      ? "statement imports"
      : moduleRoute === "/accounts"
        ? "accounts"
        : moduleRoute === "/fixed-deposits"
          ? "fixed deposits"
          : "loans";

  return (
    <>
      <button
        type="button"
        className="button primary"
        onClick={openScanner}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ScanLine size={16} aria-hidden="true" />
        {refundScan ? "Scan cancellation or refund" : "Scan order history"}
      </button>
      {open && (
        <Modal
          title={refundScan ? "Scan refund" : "Scan orders"}
          description={
            refundScan
              ? "Read cancellation or refund details. Confirm received credits separately."
              : "Upload order lists or purchase screenshots, then review every draft."
          }
          onClose={closeScanner}
          className="receipt-modal order-scan-modal"
          overlayClassName="receipt-modal-overlay order-scan-overlay"
        >
          <div id={panelId} className="receipt-panel">
            {!signedIn ? (
              <p className="receipt-note">
                Sign in to your profile to scan order history.{" "}
                <Link href="/profile">Open profile</Link>
              </p>
            ) : (
              <>
                <p className="order-scan-intro">
                  {refundScan
                    ? "Upload the cancellation or refund screenshot. An initiated refund stays pending until a bank or provider credit is confirmed."
                    : "Include overlapping screens in their original order. The review will check for repeated orders before saving."}
                </p>
                <div className="receipt-photo-list">
                  {Array.from({ length: photoSlots }, (_, index) => {
                    const image = images[index];
                    return (
                      <div className="receipt-photo-slot" key={index}>
                        <h3>
                          Screenshot {index + 1}
                          {index > 0 && !image && <small>Optional</small>}
                        </h3>
                        {image && (
                          <div className="receipt-image-row">
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
                                alt={`Selected order screenshot ${index + 1}`}
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
                                <X size={13} aria-hidden="true" /> Remove
                                screenshot {index + 1}
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
                                : `Camera for screenshot ${index + 1}`
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
                                : `Upload screenshot ${index + 1}`
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
                              ? refundScan
                                ? "Cancellation or refund screenshots"
                                : "Order history screenshots"
                              : `Order screenshot ${index + 1}`
                          }
                          accept="image/png,image/jpeg,image/webp"
                          multiple
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
                              ? "Take an order screenshot photo"
                              : `Take order screenshot photo ${index + 1}`
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
                  PNG, JPEG or WebP · up to {MAX_RECEIPT_IMAGES} screenshots ·{" "}
                  {maxUploadMB} MB total
                </p>
                {checking ? (
                  <p className="receipt-note" role="status">
                    Checking order AI availability…
                  </p>
                ) : settings && !settings.configured ? (
                  <p className="receipt-note">
                    Order scanning is unavailable. The app owner needs to enable
                    AI scanning. You can still add orders manually.
                  </p>
                ) : null}
                {settings?.provider === "Google Gemini" ? (
                  <div className="receipt-warning">
                    <p id={`${panelId}-gemini-terms`}>
                      Scanning sends the selected screenshots to Google Gemini.
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
                          checked={redacted}
                          disabled={busy}
                          aria-describedby={`${panelId}-gemini-terms ${panelId}-redaction-guidance`}
                          onChange={(event) =>
                            setRedacted(event.target.checked)
                          }
                        />
                        <span>
                          I removed personal, banking and other sensitive
                          information from every selected screenshot
                          <small>
                            Confirm this for all {images.length} selected{" "}
                            {images.length === 1 ? "image" : "images"}.
                          </small>
                        </span>
                      </label>
                    )}
                  </div>
                ) : settings?.provider === "Vercel AI Gateway" ? (
                  <p className="receipt-disclosure">
                    Images sent to Vercel AI Gateway and OpenAI for extraction.
                    Review before saving.
                  </p>
                ) : (
                  <p className="receipt-disclosure">
                    The cloud destination will be shown when AI availability is
                    confirmed.
                  </p>
                )}
                {!checking && !settings && (
                  <div className="receipt-retry-actions">
                    <button
                      type="button"
                      className="receipt-text-button"
                      onClick={() => void checkSettings()}
                    >
                      Refresh AI availability
                    </button>
                  </div>
                )}
                {busy && (
                  <p className="receipt-note" role="status">
                    Reading order screenshots. Nothing is saved until you review
                    the drafts.
                  </p>
                )}
                {result && (
                  <div
                    ref={resultPanel}
                    className="receipt-result order-scan-summary"
                    aria-label="Order scan result"
                  >
                    <h3>
                      {result.extraction.orders.length
                        ? `${result.extraction.orders.length} ${refundScan ? (result.extraction.orders.length === 1 ? "record" : "records") : result.extraction.orders.length === 1 ? "order" : "orders"} ready to review`
                        : refundScan
                          ? "No cancellation or refund records found"
                          : "No purchase orders found"}
                    </h3>
                    {moduleRoute ? (
                      <p>
                        This appears to be a financial document.{" "}
                        <Link href={moduleRoute}>Open {moduleLabel}</Link> to
                        record it in the appropriate place.
                      </p>
                    ) : result.extraction.sourceType ===
                      "design_reference_only" ? (
                      <p>
                        This appears to be a design reference. It will not
                        create an order or a transaction.
                      </p>
                    ) : !result.extraction.orders.length ? (
                      <p>
                        Try an order list, order detail or paid purchase
                        screenshot. Unclear screenshots cannot create purchases.
                      </p>
                    ) : (
                      <p>
                        Check dates, amounts, payment accounts and possible
                        duplicates in the next step. Cancellations and pending
                        refunds remain history until credits are confirmed.
                      </p>
                    )}
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
                  onClick={reviewOrders}
                  disabled={busy || !result.extraction.orders.length}
                >
                  {refundScan ? "Review refund" : "Review orders"}
                </button>
              ) : (
                <button
                  type="button"
                  className="receipt-pill receipt-primary"
                  aria-label={
                    busy
                      ? "Scanning orders…"
                      : refundScan
                        ? "Scan refund with AI"
                        : "Scan orders with AI"
                  }
                  onClick={() => void scan()}
                  disabled={
                    !images.length ||
                    !settings?.configured ||
                    checking ||
                    busy ||
                    Boolean(settings?.requiresRedaction && !redacted)
                  }
                >
                  <ScanLine size={16} aria-hidden="true" />{" "}
                  {busy ? "Scanning…" : "Start scan"}
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
