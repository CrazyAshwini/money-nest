"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileArchive, RefreshCw } from "lucide-react";
import { useFinance } from "./finance-provider";
import { Badge, Field } from "./ui";

const MAX_FILE_BYTES = 4_000_000;
type Row = Record<string, unknown>;
type Decision = {
  sourceObjectId: string;
  action: "match" | "create" | "skip";
  recordId?: string;
  confirmCorrections?: boolean;
};
type ReviewItem = {
  sourceObjectId: string;
  collection: string;
  reason: string;
  candidateIds: string[];
  incoming: Row;
  current?: Row | null;
};
type Preview = {
  counters: Record<string, unknown>;
  checks: {
    name: string;
    passed: boolean;
    expected: unknown;
    actual: unknown;
  }[];
  reviewItems: ReviewItem[];
  warnings: unknown[];
};
type Batch = {
  id: string;
  preview: Preview;
  state?: string;
  createdAt?: string;
  fileName?: string;
  decisions?: Decision[];
};
type ApiResult = {
  error?: string;
  batchId?: string;
  preview?: Preview;
  batches?: Batch[];
  counters?: Record<string, unknown>;
  checks?: unknown;
  needsReview?: number | boolean;
};

const label = (value: string) =>
  value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function describe(row: Row) {
  return String(
    row.description || row.name || row.institution || row.id || "Record",
  );
}

function rowSummary(row: Row) {
  const amount = row.amount ?? row.statementAmount ?? row.principal;
  const date =
    row.occurredOn ?? row.asOf ?? row.statementDate ?? row.openingDate;
  return [
    describe(row),
    amount != null ? `₹${String(amount)}` : null,
    date ? String(date) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function facts(value: unknown, prefix = ""): { name: string; value: string }[] {
  if (!isRow(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const name = prefix ? `${prefix} · ${label(key)}` : label(key);
    if (isRow(entry)) return facts(entry, name);
    if (["string", "number", "boolean"].includes(typeof entry)) {
      return [
        {
          name,
          value:
            typeof entry === "boolean" ? (entry ? "Yes" : "No") : String(entry),
        },
      ];
    }
    return [];
  });
}

function warningText(value: unknown) {
  if (typeof value === "string") return value;
  if (isRow(value))
    return String(
      value.message ||
        value.reason ||
        value.code ||
        "Review the source information before merging.",
    );
  return "Review the source information before merging.";
}

function checkValue(value: unknown) {
  if (value == null) return "Not supplied";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

async function readManifest(file: File): Promise<unknown> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error("Choose a ZIP or JSON file smaller than 4 MB.");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    if (!file.name.toLowerCase().endsWith(".json"))
      throw new Error(
        "Choose a handoff ZIP or transaction manifest JSON file.",
      );
    return JSON.parse(await file.text());
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65_558);
    offset -= 1
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0)
    throw new Error(
      "This ZIP could not be read. Choose the original handoff file.",
    );
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  const directoryEnd = offset + directorySize;
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    count !== view.getUint16(end + 8, true) ||
    count === 0 ||
    count > 128 ||
    directoryEnd > end
  ) {
    throw new Error(
      "Choose a standard handoff ZIP containing transaction_manifest.json.",
    );
  }
  let totalSize = 0;
  let manifestName = "";
  let manifestSize = 0;
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > directoryEnd ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error("This ZIP has an invalid file directory.");
    const compressed = view.getUint32(offset + 20, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next =
      offset +
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (
      next > directoryEnd ||
      compressed > MAX_FILE_BYTES ||
      expanded > MAX_FILE_BYTES
    )
      throw new Error("A file inside this ZIP is too large.");
    totalSize += expanded;
    if (totalSize > 12_000_000)
      throw new Error(
        "The expanded ZIP is too large. Choose transaction_manifest.json instead.",
      );
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (name.split("/").at(-1) === "transaction_manifest.json") {
      if (
        manifestName ||
        name.includes("\\") ||
        name.split("/").includes("..") ||
        (view.getUint16(offset + 8, true) & 1) !== 0 ||
        ![0, 8].includes(view.getUint16(offset + 10, true))
      ) {
        throw new Error(
          "Choose a ZIP with one unencrypted transaction_manifest.json.",
        );
      }
      const localOffset = view.getUint32(offset + 42, true);
      if (
        localOffset + 30 > offset ||
        view.getUint32(localOffset, true) !== 0x04034b50
      )
        throw new Error("This ZIP has an invalid manifest entry.");
      const contentOffset =
        localOffset +
        30 +
        view.getUint16(localOffset + 26, true) +
        view.getUint16(localOffset + 28, true);
      if (
        contentOffset + compressed > offset ||
        (view.getUint16(offset + 10, true) === 0 && compressed !== expanded)
      )
        throw new Error("This ZIP has an invalid manifest size.");
      manifestName = name;
      manifestSize = expanded;
    }
    offset = next;
  }
  if (!manifestName || !manifestSize || offset !== directoryEnd)
    throw new Error("This ZIP must contain transaction_manifest.json.");
  // Bound central-directory sizes before allocating and extract only the manifest.
  const { strFromU8, unzipSync } = await import("fflate");
  const result = unzipSync(bytes, {
    filter: (entry) =>
      entry.name === manifestName && entry.originalSize === manifestSize,
  });
  const manifest = result[manifestName];
  if (
    !manifest ||
    manifest.length !== manifestSize ||
    manifest.length > MAX_FILE_BYTES
  )
    throw new Error("The transaction manifest could not be read.");
  return JSON.parse(strFromU8(manifest));
}

async function api(
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ApiResult> {
  const response = await fetch("/api/imports/handoff", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal,
  });
  const result: ApiResult = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "The handoff could not be processed. Please try again.",
    );
  return result;
}

export function HandoffImportPanel() {
  const { data, refresh, toast } = useFinance();
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState<"loading" | "preview" | "commit" | null>(
    "loading",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [decisionsChanged, setDecisionsChanged] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void api(undefined, controller.signal)
      .then((result) => {
        setBatches(result.batches || []);
        const saved = result.batches?.find(
          (batch) => batch.state !== "complete",
        );
        if (saved) {
          setBatchId(saved.id);
          setPreview(saved.preview);
          setDecisionsChanged(saved.state === "partial");
          setDecisions(
            Object.fromEntries(
              (saved.decisions || []).map((decision) => [
                decision.sourceObjectId,
                decision,
              ]),
            ),
          );
        }
      })
      .catch((issue: unknown) => {
        if (!controller.signal.aborted)
          setError(
            issue instanceof Error
              ? issue.message
              : "Saved reviews could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(null);
      });
    return () => controller.abort();
  }, []);

  function choose(decision: Decision | null, sourceObjectId: string) {
    setDecisions((current) => {
      const next = { ...current };
      if (decision) next[sourceObjectId] = decision;
      else delete next[sourceObjectId];
      return next;
    });
    setConfirmed(false);
    setDecisionsChanged(true);
  }

  async function buildPreview(useSaved = false, savedId = batchId) {
    if (busy || (!file && !useSaved)) return;
    setBusy("preview");
    setError("");
    setSuccess("");
    setConfirmed(false);
    try {
      const result = await api(
        useSaved
          ? {
              action: "preview",
              batchId: savedId,
              decisions: Object.values(decisions),
            }
          : { action: "preview", manifest: await readManifest(file!) },
      );
      if (!result.batchId || !result.preview)
        throw new Error("The merge preview is incomplete. Please try again.");
      setBatchId(result.batchId);
      setPreview(result.preview);
      if (!useSaved) setDecisions({});
      setDecisionsChanged(false);
      const saved = await api();
      setBatches(saved.batches || []);
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : "Choose a valid handoff file.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!batchId || !confirmed || busy || decisionsChanged) return;
    setBusy("commit");
    setError("");
    setSuccess("");
    try {
      const result = await api({
        action: "commit",
        batchId,
        decisions: Object.values(decisions),
      });
      await refresh();
      const saved = await api();
      setBatches(saved.batches || []);
      const updated = saved.batches?.find((batch) => batch.id === batchId);
      if (updated?.preview) setPreview(updated.preview);
      else if (result.preview) setPreview(result.preview);
      setConfirmed(false);
      setDecisionsChanged(!!result.needsReview);
      if (!result.needsReview) setBatchId("");
      const message = result.needsReview
        ? "Confirmed records merged. The remaining records are saved for review."
        : "Records merged successfully. Existing matches were kept without duplicates.";
      setSuccess(message);
      toast(message);
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "The records could not be merged.",
      );
    } finally {
      setBusy(null);
    }
  }

  function resume(batch: Batch) {
    setBatchId(batch.id);
    setPreview(batch.preview);
    setDecisions(
      Object.fromEntries(
        (batch.decisions || []).map((decision) => [
          decision.sourceObjectId,
          decision,
        ]),
      ),
    );
    setConfirmed(false);
    setDecisionsChanged(batch.state === "partial");
    setError("");
    setSuccess("");
    setFile(null);
  }

  return (
    <div
      className="profile-transfer"
      style={{
        display: "grid",
        gap: 16,
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid var(--border)",
        minWidth: 0,
      }}
    >
      <div>
        <h3 style={{ marginBottom: 6 }}>Merge a handoff</h3>
        <p className="profile-details">
          Add records from a handoff ZIP or transaction manifest. Preview
          matches and conflicts before merging.
        </p>
      </div>
      <Field label="Handoff ZIP or JSON · up to 4 MB">
        <input
          type="file"
          accept="application/zip,application/json,.zip,.json"
          disabled={!!busy}
          style={{ maxWidth: "100%" }}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] || null);
            setError("");
            setConfirmed(false);
          }}
        />
      </Field>
      <div>
        <button
          type="button"
          className="button"
          onClick={() => void buildPreview()}
          disabled={!file || !!busy}
        >
          <FileArchive size={16} />{" "}
          {busy === "preview" ? "Preparing preview…" : "Preview merge"}
        </button>
      </div>
      {batches.length > 0 && (
        <details>
          <summary
            style={{ cursor: "pointer", color: "var(--muted)", fontSize: 13 }}
          >
            Saved handoff reviews ({batches.length})
          </summary>
          <div style={{ display: "grid", gap: 8, paddingTop: 10 }}>
            {batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                className="button"
                disabled={!!busy}
                onClick={() => resume(batch)}
                style={{
                  justifyContent: "space-between",
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                }}
              >
                <span>
                  {batch.fileName || "Handoff"}
                  {batch.createdAt
                    ? ` · ${new Date(batch.createdAt).toLocaleDateString("en-IN")}`
                    : ""}
                </span>
                <Badge>
                  {batch.state ? label(batch.state) : "Saved review"}
                </Badge>
              </button>
            ))}
          </div>
        </details>
      )}
      {preview && (
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <div className="statement-summary" aria-label="Merge preview counts">
            {facts(preview.counters).map((entry) => (
              <span key={entry.name}>
                <strong>{entry.value}</strong> {entry.name}
              </span>
            ))}
          </div>
          <p className="statement-review-hint">
            Existing matches are kept once. Unconfirmed records and conflicting
            financial values stay unchanged until you choose how to handle them.
          </p>
          {!!preview.warnings?.length && (
            <div
              className="info-banner"
              style={{ display: "grid", gap: 6, marginBottom: 0 }}
            >
              {preview.warnings.map((warning, index) => (
                <p key={index}>{warningText(warning)}</p>
              ))}
            </div>
          )}
          {preview.checks?.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 13 }}>
                Source checks and financial conflicts
              </summary>
              <dl
                style={{
                  display: "grid",
                  gap: 6,
                  fontSize: 12,
                  paddingTop: 10,
                  overflowWrap: "anywhere",
                }}
              >
                {preview.checks.map((entry) => (
                  <div
                    key={entry.name}
                    style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                  >
                    <dt style={{ color: "var(--muted)" }}>{entry.name}</dt>
                    <dd>
                      <Badge tone={entry.passed ? "green" : "amber"}>
                        {entry.passed ? "Passed" : "Needs review"}
                      </Badge>{" "}
                      Expected {checkValue(entry.expected)} · Found{" "}
                      {checkValue(entry.actual)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {preview.reviewItems?.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              <h4>{preview.reviewItems.length} records need a decision</h4>
              {preview.reviewItems.map((item) => {
                const decision = decisions[item.sourceObjectId];
                const collection =
                  data[item.collection as keyof typeof data] || [];
                const candidates = item.candidateIds
                  .map((id) => collection.find((row) => row.id === id))
                  .filter((row): row is (typeof collection)[number] => !!row);
                return (
                  <details
                    key={item.sourceObjectId}
                    className="statement-candidate"
                    style={{ padding: 12 }}
                  >
                    <summary
                      style={{
                        cursor: "pointer",
                        overflowWrap: "anywhere",
                        fontSize: 13,
                      }}
                    >
                      {rowSummary(item.incoming)}{" "}
                      {decision && (
                        <Badge
                          tone={
                            decision.action === "skip" ? "neutral" : "green"
                          }
                        >
                          {label(decision.action)}
                        </Badge>
                      )}
                    </summary>
                    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                      <p className="statement-row-note">
                        {label(item.collection)} · {label(item.reason)}
                      </p>
                      {item.current && (
                        <p className="statement-row-note">
                          <strong>Current record:</strong>{" "}
                          {rowSummary(item.current)}
                        </p>
                      )}
                      {candidates.length > 0 && (
                        <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <strong>Possible existing matches</strong>
                          {candidates.map((row) => (
                            <p key={row.id}>
                              {rowSummary(row as unknown as Row)}
                            </p>
                          ))}
                        </div>
                      )}
                      <Field label={`Decision for ${describe(item.incoming)}`}>
                        <select
                          value={decision?.action || ""}
                          disabled={!!busy}
                          onChange={(event) => {
                            const action = event.currentTarget.value as
                              Decision["action"] | "";
                            choose(
                              action
                                ? {
                                    sourceObjectId: item.sourceObjectId,
                                    action,
                                    ...(action === "match" &&
                                    item.candidateIds.length === 1
                                      ? { recordId: item.candidateIds[0] }
                                      : {}),
                                  }
                                : null,
                              item.sourceObjectId,
                            );
                          }}
                        >
                          <option value="">Leave unconfirmed</option>
                          {item.candidateIds.length > 0 && (
                            <option value="match">
                              Match an existing record
                            </option>
                          )}
                          <option value="create">Create a new record</option>
                          <option value="skip">Skip this source record</option>
                        </select>
                      </Field>
                      {decision?.action === "match" && (
                        <>
                          <Field label="Existing record">
                            <select
                              value={decision.recordId || ""}
                              disabled={!!busy}
                              required
                              onChange={(event) =>
                                choose(
                                  {
                                    ...decision,
                                    recordId:
                                      event.currentTarget.value || undefined,
                                  },
                                  item.sourceObjectId,
                                )
                              }
                            >
                              <option value="">Choose a match</option>
                              {item.candidateIds.map((id) => {
                                const row = candidates.find(
                                  (candidate) => candidate.id === id,
                                );
                                return (
                                  <option key={id} value={id}>
                                    {row
                                      ? rowSummary(row as unknown as Row)
                                      : id}
                                  </option>
                                );
                              })}
                            </select>
                          </Field>
                          <div
                            style={{ display: "grid", gap: 6, fontSize: 12 }}
                          >
                            {(
                              [
                                "amount",
                                "occurredOn",
                                "kind",
                                "fromAccountId",
                                "toAccountId",
                              ] as const
                            )
                              .filter((key) => item.incoming[key] != null)
                              .map((key) => {
                                const current =
                                  item.current ||
                                  (candidates.find(
                                    (candidate) =>
                                      candidate.id === decision.recordId,
                                  ) as unknown as Row | undefined);
                                const valueLabel = (value: unknown) =>
                                  key.endsWith("AccountId")
                                    ? data.accounts.find(
                                        (account) => account.id === value,
                                      )?.name || checkValue(value)
                                    : checkValue(value);
                                return (
                                  <p key={key}>
                                    <strong>{label(key)}:</strong>{" "}
                                    {current
                                      ? `${valueLabel(current[key])} → `
                                      : ""}
                                    {valueLabel(item.incoming[key])}
                                  </p>
                                );
                              })}
                          </div>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 10,
                              fontSize: 13,
                              lineHeight: 1.5,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={!!decision.confirmCorrections}
                              disabled={!!busy}
                              style={{ marginTop: 3, flexShrink: 0 }}
                              onChange={(event) =>
                                choose(
                                  {
                                    ...decision,
                                    confirmCorrections:
                                      event.currentTarget.checked,
                                  },
                                  item.sourceObjectId,
                                )
                              }
                            />
                            Use the handoff’s corrected
                            amount/date/type/accounts. This replaces the
                            selected record’s conflicting financial values.
                          </label>
                        </>
                      )}
                    </div>
                  </details>
                );
              })}
              <div>
                <button
                  type="button"
                  className="button"
                  disabled={
                    !!busy ||
                    Object.values(decisions).some(
                      (decision) =>
                        decision.action === "match" && !decision.recordId,
                    )
                  }
                  onClick={() => void buildPreview(true)}
                >
                  <RefreshCw size={15} /> Update preview and save decisions
                </button>
              </div>
            </div>
          )}
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!!busy || !batchId || decisionsChanged}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              style={{ marginTop: 3, flexShrink: 0 }}
            />
            I reviewed the preview and want to merge the confirmed records.
            Unconfirmed financial conflicts will stay unchanged.
          </label>
          {decisionsChanged && (
            <p className="statement-review-hint" role="status">
              Update the preview to save your decisions before confirming the
              merge.
            </p>
          )}
          <div>
            <button
              type="button"
              className="button primary"
              disabled={
                !confirmed ||
                !!busy ||
                !batchId ||
                decisionsChanged ||
                Object.values(decisions).some(
                  (decision) =>
                    decision.action === "match" && !decision.recordId,
                )
              }
              onClick={() => void commit()}
            >
              <CheckCircle2 size={16} />{" "}
              {busy === "commit" ? "Merging…" : "Confirm safe merge"}
            </button>
          </div>
        </div>
      )}
      {busy === "loading" && (
        <p className="statement-review-hint" role="status">
          Loading saved handoff reviews…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="info-banner" role="status" style={{ marginBottom: 0 }}>
          {success}
        </p>
      )}
    </div>
  );
}
