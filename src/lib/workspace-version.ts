import { z } from "zod";
import Decimal from "decimal.js";
import type { OwnedRecord, Transaction, WorkspaceData } from "./types";
import { transactionSchema } from "./validation";

/** Omitted means create; null is only an update of a legacy unversioned private row. */
export type SaveExpectation = { expectedUpdatedAt: string | null };
export const WORKSPACE_CONFLICT_MESSAGE =
  "This record changed on another device. Reload the latest details and retry.";
const version = z.string().datetime({ offset: true });

export function mutationExpectation(
  body: Record<string, unknown>,
  required = false,
): SaveExpectation | undefined {
  if (!Object.hasOwn(body, "expectedUpdatedAt")) {
    if (required) throw new Error("The original record version is required.");
    return undefined;
  }
  if (
    body.expectedUpdatedAt !== null &&
    !version.safeParse(body.expectedUpdatedAt).success
  )
    throw new Error("The original record version is invalid.");
  return { expectedUpdatedAt: body.expectedUpdatedAt as string | null };
}

export function recordMatchesExpectation(
  row: OwnedRecord | undefined,
  expectation: SaveExpectation | undefined,
) {
  if (!expectation) return !row;
  return (
    Boolean(row) && (row?.updatedAt ?? null) === expectation.expectedUpdatedAt
  );
}

/** Millisecond precision is sufficient locally; the next version always advances. */
export function nextPrivateRecordVersion(previous?: string) {
  const previousTime = previous ? Date.parse(previous) : NaN;
  return new Date(
    Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0),
  ).toISOString();
}

/** Commerce also edits transactions under the private file lock. Stamp every changed row. */
export function stampWorkspaceChanges(
  before: WorkspaceData,
  after: WorkspaceData,
) {
  for (const collection of Object.keys(after) as (keyof WorkspaceData)[]) {
    if (collection === "auditEvents" || !Array.isArray(after[collection]))
      continue;
    const previous = new Map(
      (before[collection] ?? []).map((row) => [row.id, row]),
    );
    for (const row of after[collection]) {
      const old = previous.get(row.id);
      if (JSON.stringify(old) !== JSON.stringify(row))
        row.updatedAt = nextPrivateRecordVersion(old?.updatedAt);
    }
  }
}

const nullableTransactionFields = [
  "category",
  "subcategory",
  "platform",
  "merchant",
  "externalPayer",
  "externalReference",
  "sourceSystem",
  "sourceObjectId",
  "receiptDocumentId",
  "refundOfTransactionId",
  "notes",
  "fromBalanceSnapshotId",
  "toBalanceSnapshotId",
  // These nullable database columns are not exposed as editable transaction fields.
  "categoryId",
  "importBatchId",
] as const;

function stableJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableJson);
  if (
    typeof value === "object" &&
    value !== null &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableJson(item)]),
    );
  throw new Error("Unsupported comparison value.");
}

function receiptCreatePayload(record: Transaction) {
  const raw = { ...record } as Record<string, unknown>;
  delete raw.createdAt;
  delete raw.updatedAt;
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return null;
  // Retain unknown fields: a changed non-null value must never disappear in parsing.
  const canonical: Record<string, unknown> = {
    ...raw,
    ...parsed.data,
    amount: new Decimal(parsed.data.amount).toFixed(2),
  };
  for (const key of nullableTransactionFields) canonical[key] ??= null;
  return JSON.stringify(stableJson(canonical));
}

/** Read-only acknowledgement after a lost receipt-create response; never authorizes an update. */
export function matchesPersistedReceiptCreate(
  attempted: Transaction,
  persisted: Transaction | undefined,
  ownerId: string,
): boolean {
  if (
    !persisted ||
    attempted.userId !== ownerId ||
    persisted.userId !== ownerId ||
    attempted.id !== persisted.id ||
    attempted.sourceSystem !== "receipt_ai" ||
    persisted.sourceSystem !== "receipt_ai" ||
    !/^[a-f0-9]{64}$/.test(attempted.sourceObjectId ?? "")
  )
    return false;
  try {
    const attemptedPayload = receiptCreatePayload(attempted);
    return (
      attemptedPayload !== null &&
      attemptedPayload === receiptCreatePayload(persisted)
    );
  } catch {
    return false;
  }
}
