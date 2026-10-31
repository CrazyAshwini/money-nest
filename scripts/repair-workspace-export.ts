/** Offline review only: this script never reads a profile store or connects to a database. */
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { z } from "zod";
import {
  assertCommerceTransactionEdit,
  commerceDataSchema,
} from "../src/lib/commerce";
import type { OwnedRecord, Transaction, WorkspaceData } from "../src/lib/types";
import {
  validateWorkspaceRecord,
  workspaceRecordSchemas,
} from "../src/lib/validation";

const collections = [
  "accounts", "snapshots", "transactions", "bills", "allocations",
  "fixedDeposits", "loans", "emis", "emiAllocations", "groups", "shares",
  "settlements", "reminders",
] as const;
const repairId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const row = z.record(z.string(), z.unknown());
const manifestSchema = z.object({
  format: z.literal("money-nest-workspace-repair"),
  version: z.literal(1),
  ownerId: z.uuid(),
  repairId,
  inputSha256: sha256,
  changes: z.array(z.object({
    collection: z.enum(collections),
    id: z.uuid(),
    before: row.nullable(),
    after: row.nullable(),
  }).strict()).min(1).max(10000),
}).strict();
const historySchema = z.array(z.object({
  repairId,
  inputSha256: sha256,
  changeCount: z.number().int().positive(),
}).passthrough());

type JsonObject = Record<string, unknown>;
type RepairSummary = {
  repairId: string;
  inputSha256: string;
  outputSha256: string;
  created: number;
  updated: number;
  deleted: number;
};

export function exportSha256(input: string | Uint8Array) {
  return createHash("sha256").update(input).digest("hex");
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(input: string | Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(input).toString("utf8"), (key, value: unknown) => {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error("Unsupported object key in the input or manifest.");
      return value;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unsupported object key in the input or manifest.")
      throw error;
    // Native JSON parse errors may include fragments of private record contents.
    throw new Error("The export and manifest must contain valid JSON.");
  }
}

function assertOwnedRows(value: unknown, ownerId: string): void {
  if (Array.isArray(value)) {
    for (const child of value) assertOwnedRows(child, ownerId);
  } else if (object(value)) {
    if (Object.hasOwn(value, "userId") && value.userId !== ownerId)
      throw new Error("A record belongs to another owner.");
    for (const child of Object.values(value)) assertOwnedRows(child, ownerId);
  }
}

function checkedWorkspace(value: unknown, ownerId: string): WorkspaceData {
  if (!object(value)) throw new Error("The export needs a workspace object.");
  for (const collection of Object.keys(workspaceRecordSchemas) as (keyof WorkspaceData)[]) {
    const rows = value[collection];
    if (!Array.isArray(rows) || rows.some((entry) =>
      !object(entry) || !z.uuid().safeParse(entry.id).success || entry.userId !== ownerId,
    )) throw new Error("Every workspace collection needs uniquely identified, owned rows.");
    if (new Set(rows.map((entry) => entry.id)).size !== rows.length)
      throw new Error("Duplicate record IDs in the export.");
  }
  assertOwnedRows(value, ownerId);
  return value as unknown as WorkspaceData;
}

/** All comparisons use the supplied bytes and full rows; no domain values are inferred. */
export function prepareWorkspaceExportRepair(
  input: string | Uint8Array,
  manifestInput: string | Uint8Array,
): { output: string; summary: RepairSummary } {
  const parsedManifest = manifestSchema.safeParse(parseJson(manifestInput));
  if (!parsedManifest.success) throw new Error("Choose a valid workspace repair manifest.");
  const manifest = parsedManifest.data;
  const inputHash = exportSha256(input);
  if (manifest.inputSha256 !== inputHash)
    throw new Error("The export SHA-256 does not match the reviewed input.");
  const envelope = parseJson(input);
  if (!object(envelope) || envelope.format !== "money-nest-private-export" ||
      envelope.version !== 1 || !object(envelope.profile) ||
      envelope.profile.id !== manifest.ownerId)
    throw new Error("Choose a Money Nest export belonging to the manifest owner.");
  const workspace = checkedWorkspace(envelope.workspace, manifest.ownerId);
  const commerceResult = commerceDataSchema.safeParse(envelope.commerce);
  if (!commerceResult.success) throw new Error("The export contains invalid order history.");
  assertOwnedRows(envelope.commerce, manifest.ownerId);
  const historyResult = historySchema.safeParse(envelope.repairHistory ?? []);
  if (!historyResult.success) throw new Error("The export contains invalid repair history.");
  const history = historyResult.data;
  if (new Set(history.map((entry) => entry.repairId)).size !== history.length)
    throw new Error("Duplicate repair IDs in export history.");
  if (history.some((entry) => entry.repairId === manifest.repairId))
    throw new Error("This repair ID was already prepared for the export.");

  const seen = new Set<string>();
  const summary = {
    repairId: manifest.repairId, inputSha256: inputHash,
    outputSha256: "", created: 0, updated: 0, deleted: 0,
  };
  for (const change of manifest.changes) {
    const key = `${change.collection}:${change.id}`;
    if (seen.has(key)) throw new Error("A repair may change each record only once.");
    seen.add(key);
    const rows = workspace[change.collection] as OwnedRecord[];
    const index = rows.findIndex((entry) => entry.id === change.id);
    const previous = index < 0 ? null : rows[index];
    if (!isDeepStrictEqual(previous, change.before))
      throw new Error("A full before-value does not match the exported record.");
    if (change.before === null && change.after === null)
      throw new Error("A repair change must create, replace, or delete a record.");
    if (change.after !== null &&
        (change.after.id !== change.id || change.after.userId !== manifest.ownerId))
      throw new Error("Replacement records must retain the declared ID and owner.");
    if (isDeepStrictEqual(previous, change.after))
      throw new Error("A repair change must alter its declared record.");
    assertOwnedRows(change.after, manifest.ownerId);

    if (change.collection === "transactions" && previous) {
      const transactionId = previous.id;
      const linked = commerceResult.data.orders.some((order) => order.payments.some(
        (payment) => payment.transactionId === transactionId,
      )) || commerceResult.data.refunds.some((refund) =>
        refund.originalTransactionId === transactionId ||
        refund.creditMatches.some((credit) => credit.transactionId === transactionId),
      );
      if (linked && change.after === null)
        throw new Error("An order or refund still links this transaction.");
      if (change.after) assertCommerceTransactionEdit(
        commerceResult.data, previous as Transaction, change.after as unknown as Transaction,
      );
    }
    if (change.after === null) {
      rows.splice(index, 1);
      summary.deleted++;
    } else if (index < 0) {
      rows.push(change.after as unknown as OwnedRecord);
      summary.created++;
    } else {
      rows[index] = change.after as unknown as OwnedRecord;
      summary.updated++;
    }
  }

  // Validate the entire final graph, so deleting a parent cannot leave broken links.
  for (const collection of Object.keys(workspaceRecordSchemas) as (keyof WorkspaceData)[])
    for (const entry of workspace[collection])
      validateWorkspaceRecord(workspace, collection, entry, manifest.ownerId);
  const transactionIds = new Set(workspace.transactions.map((entry) => entry.id));
  const accountIds = new Set(workspace.accounts.map((entry) => entry.id));
  const orderIds = new Set(commerceResult.data.orders.map((entry) => entry.id));
  for (const order of commerceResult.data.orders)
    if (order.payments.some((payment) => !transactionIds.has(payment.transactionId)))
      throw new Error("A linked commerce transaction was not found.");
  for (const refund of commerceResult.data.refunds) {
    if (refund.destinationAccountId && !accountIds.has(refund.destinationAccountId))
      throw new Error("A linked commerce account was not found.");
    if ((refund.orderId && !orderIds.has(refund.orderId)) ||
        (refund.originalTransactionId && !transactionIds.has(refund.originalTransactionId)) ||
        refund.creditMatches.some((credit) => !transactionIds.has(credit.transactionId)))
      throw new Error("A linked commerce order or transaction was not found.");
  }
  // Optional recorded EMI agreements are preserved, including their references.
  const recordedAgreements = (envelope.workspace as JsonObject).emiAgreements;
  if (recordedAgreements !== undefined) {
    if (!Array.isArray(recordedAgreements)) throw new Error("Invalid recorded EMI agreements.");
    for (const agreement of recordedAgreements) {
      if (!object(agreement) || agreement.userId !== manifest.ownerId ||
          typeof agreement.accountId !== "string" || !accountIds.has(agreement.accountId) ||
          (agreement.purchaseTransactionId != null &&
            (typeof agreement.purchaseTransactionId !== "string" ||
              !transactionIds.has(agreement.purchaseTransactionId))))
        throw new Error("A linked EMI agreement account or purchase was not found.");
    }
  }
  envelope.repairHistory = [...history, {
    repairId: manifest.repairId,
    inputSha256: inputHash,
    changeCount: manifest.changes.length,
  }];
  const output = `${JSON.stringify(envelope, null, 2)}\n`;
  summary.outputSha256 = exportSha256(output);
  return { output, summary };
}

/** Dry runs read only the two explicit files. Writing always creates a separate new file. */
export async function repairWorkspaceExportFiles(options: {
  inputPath: string;
  manifestPath: string;
  write?: boolean;
  outputPath?: string;
}) {
  if (![options.inputPath, options.manifestPath].every(path.isAbsolute))
    throw new Error("Pass absolute export and manifest paths.");
  if (Boolean(options.write) !== Boolean(options.outputPath))
    throw new Error("Writing requires both --write and an explicit --output path.");
  if (options.outputPath && !path.isAbsolute(options.outputPath))
    throw new Error("Pass an absolute output path.");
  const [input, manifest] = await Promise.all([
    readFile(options.inputPath), readFile(options.manifestPath),
  ]);
  const prepared = prepareWorkspaceExportRepair(input, manifest);
  if (options.write && options.outputPath) {
    const outputFile = await open(options.outputPath, "wx", 0o600);
    try {
      await outputFile.writeFile(prepared.output, "utf8");
      await outputFile.sync();
    } finally {
      await outputFile.close();
    }
  }
  return { mode: options.write ? "candidate-written" : "dry-run", ...prepared.summary };
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, manifest: { type: "string" },
    output: { type: "string" }, write: { type: "boolean", default: false },
  } });
  if (!values.input || !values.manifest)
    throw new Error("Usage: tsx scripts/repair-workspace-export.ts --input <absolute-export> --manifest <absolute-manifest> [--write --output <new-absolute-file>]");
  console.log(JSON.stringify(await repairWorkspaceExportFiles({
    inputPath: values.input, manifestPath: values.manifest,
    write: values.write, outputPath: values.output,
  }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Repair preparation failed.");
    process.exitCode = 1;
  });
}
