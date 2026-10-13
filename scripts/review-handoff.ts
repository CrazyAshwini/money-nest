/** Private local dry-run. No credentials, network calls, or transaction details in stdout.
 * Usage: npx tsx scripts/review-handoff.ts --input D:/Downloads/handoff.zip
 *   --state D:/Downloads/cloud-backup.json --output D:/Downloads/handoff-plan.json
 *   [--decisions D:/Downloads/decisions.json] [--sources D:/Downloads/sources.json]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import {
  planHandoffImport,
  type HandoffDecision,
} from "../src/lib/handoff-import";
import type { WorkspaceData } from "../src/lib/types";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || args.has(key))
    throw new Error(
      "Use unique --input, --state, --output and optional --decisions/--sources/--owner arguments.",
    );
  args.set(key, value);
}
const requiredPath = (key: string) => {
  const value = args.get(key);
  if (!value) throw new Error(`${key} is required.`);
  return resolve(value);
};
const inputPath = requiredPath("--input"),
  statePath = requiredPath("--state");
const bytes = readFileSync(inputPath);
if (bytes.length > 10 * 1024 * 1024)
  throw new Error("The private handoff is too large.");
let manifest: unknown;
if (/\.zip$/i.test(inputPath)) {
  const files = unzipSync(bytes, {
    filter: (file) =>
      file.name === "transaction_manifest.json" &&
      file.originalSize <= 10 * 1024 * 1024,
  });
  const manifestBytes = files["transaction_manifest.json"];
  if (!manifestBytes)
    throw new Error("The ZIP needs a bounded transaction_manifest.json.");
  manifest = JSON.parse(strFromU8(manifestBytes));
} else manifest = JSON.parse(bytes.toString("utf8"));
const state = JSON.parse(readFileSync(statePath, "utf8"));
const workspace: WorkspaceData = state.workspace ?? state;
const ownerId =
  args.get("--owner") ??
  workspace.accounts[0]?.userId ??
  workspace.transactions[0]?.userId;
if (!ownerId)
  throw new Error(
    "An empty workspace needs --owner with its cloud owner UUID.",
  );
const decisions: HandoffDecision[] = args.has("--decisions")
  ? JSON.parse(readFileSync(requiredPath("--decisions"), "utf8"))
  : [];
const sources: unknown[] = args.has("--sources")
  ? JSON.parse(readFileSync(requiredPath("--sources"), "utf8"))
  : [];
const inputHash = createHash("sha256").update(bytes).digest("hex");
const plan = planHandoffImport(
  manifest,
  workspace,
  ownerId,
  sources,
  decisions,
);
if (args.has("--output")) {
  const requested = args.get("--output")!;
  if (!isAbsolute(requested))
    throw new Error("The private plan output path must be absolute.");
  const outputPath = resolve(requested),
    relativeOutput = relative(process.cwd(), outputPath);
  if (!relativeOutput.startsWith("..") && !isAbsolute(relativeOutput))
    throw new Error("Keep private plan files outside the repository.");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        manifest,
        plan,
        ownerId,
        revision: state.revision ?? null,
        inputHash,
        decisions,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify(
    {
      counters: plan.counters,
      changes: Object.fromEntries(
        Object.entries(plan.changes).map(([key, rows]) => [key, rows.length]),
      ),
      checks: plan.checks,
      reviewReasons: plan.reviewItems.reduce<Record<string, number>>(
        (counts, item) => {
          counts[item.reason] = (counts[item.reason] ?? 0) + 1;
          return counts;
        },
        {},
      ),
      reviewCandidates: {
        none: plan.reviewItems.filter((row) => row.candidateIds.length === 0)
          .length,
        single: plan.reviewItems.filter((row) => row.candidateIds.length === 1)
          .length,
        multiple: plan.reviewItems.filter((row) => row.candidateIds.length > 1)
          .length,
      },
    },
    null,
    2,
  ),
);
