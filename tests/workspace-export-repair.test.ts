import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportSha256,
  prepareWorkspaceExportRepair,
  repairWorkspaceExportFiles,
} from "../scripts/repair-workspace-export";
import type { Account, Transaction, WorkspaceData } from "../src/lib/types";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) ||
        !path.basename(resolved).startsWith("money-nest-export-repair-"))
      throw new Error("Unexpected temporary test directory.");
    await rm(resolved, { recursive: true, force: true });
  }
});

function fixture() {
  const ownerId = randomUUID();
  const account: Account = {
    id: randomUUID(), userId: ownerId, name: "Synthetic bank",
    institution: "Example Institution", kind: "bank", maskedSuffix: "",
    active: true, openingBalance: "100.00", openingBalanceDate: "2026-01-01",
  };
  const transaction: Transaction = {
    id: randomUUID(), userId: ownerId, amount: "5.00", currency: "INR",
    kind: "expense", status: "posted", occurredOn: "2026-01-02",
    description: "Synthetic purchase", fromAccountId: account.id, toAccountId: null,
  };
  const workspace: WorkspaceData = {
    accounts: [account], transactions: [transaction], snapshots: [], bills: [],
    allocations: [], fixedDeposits: [], loans: [], emis: [], emiAllocations: [],
    groups: [], shares: [], settlements: [], reminders: [], auditEvents: [],
  };
  const envelope = {
    format: "money-nest-private-export", version: 1,
    profile: { id: ownerId, displayName: "Synthetic profile", email: "test@example.test" },
    workspace,
    commerce: { orders: [], refunds: [], operations: [] },
    metadata: { source: "synthetic-test", preserve: [1, null, "recorded"] },
  };
  const input = `${JSON.stringify(envelope)}\n`;
  const manifest = {
    format: "money-nest-workspace-repair", version: 1, ownerId,
    repairId: "synthetic-note-correction", inputSha256: exportSha256(input),
    changes: [{ collection: "transactions", id: transaction.id,
      before: transaction, after: { ...transaction, notes: "Reviewed synthetic note" } }],
  };
  return { ownerId, account, transaction, envelope, input, manifest };
}

function prepare(f = fixture()) {
  return prepareWorkspaceExportRepair(f.input, JSON.stringify(f.manifest));
}

async function files() {
  const directory = await mkdtemp(path.join(tmpdir(), "money-nest-export-repair-"));
  directories.push(directory);
  const f = fixture();
  const inputPath = path.join(directory, "export.json");
  const manifestPath = path.join(directory, "repair.json");
  const outputPath = path.join(directory, "candidate.json");
  await writeFile(inputPath, f.input);
  await writeFile(manifestPath, JSON.stringify(f.manifest));
  return { ...f, directory, inputPath, manifestPath, outputPath };
}

describe("offline workspace export repair", () => {
  it("changes only declared rows, preserves the envelope, and records one-time provenance", () => {
    const f = fixture();
    const result = prepare(f);
    const candidate = JSON.parse(result.output);
    expect(candidate.profile).toEqual(f.envelope.profile);
    expect(candidate.metadata).toEqual(f.envelope.metadata);
    expect(candidate.commerce).toEqual(f.envelope.commerce);
    expect(candidate.workspace).toEqual({
      ...f.envelope.workspace,
      transactions: [{ ...f.transaction, notes: "Reviewed synthetic note" }],
    });
    expect(candidate.repairHistory).toEqual([{
      repairId: f.manifest.repairId, inputSha256: exportSha256(f.input), changeCount: 1,
    }]);
    expect(result.summary).toEqual({
      repairId: f.manifest.repairId, inputSha256: exportSha256(f.input),
      outputSha256: exportSha256(result.output), created: 0, updated: 1, deleted: 0,
    });
    expect(f.envelope.workspace.transactions[0]).not.toHaveProperty("notes");
  });

  it("requires the exact export bytes, including whitespace", () => {
    const f = fixture();
    expect(() => prepareWorkspaceExportRepair(`${f.input} `, JSON.stringify(f.manifest)))
      .toThrow("SHA-256");
  });

  it("does not echo private fragments when malformed JSON is rejected", () => {
    const input = '{"private-fragment":"synthetic-secret"';
    const f = fixture();
    const manifest = { ...f.manifest, inputSha256: exportSha256(input) };
    expect(() => prepareWorkspaceExportRepair(input, JSON.stringify(manifest)))
      .toThrow(/^The export and manifest must contain valid JSON\.$/);
  });

  it("compares complete before rows without depending on JSON property order", () => {
    const f = fixture();
    f.manifest.changes[0].before = Object.fromEntries(
      Object.entries(f.transaction).reverse(),
    ) as unknown as Transaction;
    expect(() => prepare(f)).not.toThrow();
    f.manifest.changes[0].before = { ...f.transaction, amount: "6.00" };
    expect(() => prepare(f)).toThrow("before-value");
    f.manifest.changes[0].before = { id: f.transaction.id } as Transaction;
    expect(() => prepare(f)).toThrow("before-value");
  });

  it("rejects a mismatched export owner or replacement owner", () => {
    const f = fixture();
    f.manifest.ownerId = randomUUID();
    expect(() => prepare(f)).toThrow("manifest owner");
    f.manifest.ownerId = f.ownerId;
    f.manifest.changes[0].after.userId = randomUUID();
    expect(() => prepare(f)).toThrow("ID and owner");
  });

  it("rejects foreign rows even when the manifest does not change them", () => {
    const f = fixture();
    f.envelope.workspace.accounts[0].userId = randomUUID();
    f.input = JSON.stringify(f.envelope);
    f.manifest.inputSha256 = exportSha256(f.input);
    expect(() => prepare(f)).toThrow("owned rows");
  });

  it("atomically supports explicit insert, replacement, and deletion", () => {
    const f = fixture();
    const created = { ...f.transaction, id: randomUUID(), amount: "2.00" };
    const manifest = {
      ...f.manifest,
      changes: [
        { collection: "transactions", id: f.transaction.id, before: f.transaction, after: null },
        { collection: "accounts", id: f.account.id, before: f.account,
          after: { ...f.account, notes: "Reviewed institution record" } },
        { collection: "transactions", id: created.id, before: null, after: created },
      ],
    };
    const result = prepareWorkspaceExportRepair(f.input, JSON.stringify(manifest));
    expect(JSON.parse(result.output).workspace.transactions).toEqual([created]);
    expect(result.summary).toMatchObject({ created: 1, updated: 1, deleted: 1 });
  });

  it("rejects repeated operations, missing-row deletion, ID changes, and existing-row inserts", () => {
    const f = fixture();
    f.manifest.changes.push(f.manifest.changes[0]);
    expect(() => prepare(f)).toThrow("only once");
    f.manifest.changes.pop();
    f.manifest.changes[0].after.id = randomUUID();
    expect(() => prepare(f)).toThrow("ID and owner");
    f.manifest.changes[0].after.id = f.transaction.id;
    const change = f.manifest.changes[0];
    expect(() => prepareWorkspaceExportRepair(f.input, JSON.stringify({ ...f.manifest,
      changes: [{ ...change, before: null }],
    }))).toThrow("before-value");
    expect(() => prepareWorkspaceExportRepair(f.input, JSON.stringify({ ...f.manifest,
      changes: [{ ...change, id: randomUUID(), before: null, after: null }],
    }))).toThrow("create, replace, or delete");
  });

  it("rejects broken final references and deletion of a still-referenced account", () => {
    const f = fixture();
    f.manifest.changes[0].after.fromAccountId = randomUUID();
    expect(() => prepare(f)).toThrow("linked account");
    expect(() => prepareWorkspaceExportRepair(f.input, JSON.stringify({ ...f.manifest,
      changes: [{ collection: "accounts", id: f.account.id, before: f.account, after: null }],
    }))).toThrow("linked account");
  });

  it("preserves commerce records and rejects removing their linked destination account", () => {
    const f = fixture();
    const account = { ...f.account, id: randomUUID() };
    const envelope = {
      ...f.envelope,
      workspace: { ...f.envelope.workspace, accounts: [f.account, account] },
      commerce: { orders: [], operations: [], refunds: [{
        id: randomUUID(), userId: f.ownerId, orderId: null, originalTransactionId: null,
        description: "Synthetic refund expectation", expectedAmount: "2.00",
        expectedBy: null, cancelledOn: null, destinationAccountId: account.id,
        route: "bank", itemTitle: null, notes: null, status: "expected", creditMatches: [],
        createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-03T00:00:00Z",
      }] },
    };
    const input = JSON.stringify(envelope);
    const manifest = { ...f.manifest, inputSha256: exportSha256(input), changes: [{
      collection: "accounts", id: account.id, before: account, after: null,
    }] };
    expect(() => prepareWorkspaceExportRepair(input, JSON.stringify(manifest)))
      .toThrow("linked commerce account");
  });

  it("preserves optional EMI agreements and rejects orphaning their recorded account", () => {
    const f = fixture();
    const account = { ...f.account, id: randomUUID() };
    const envelope = { ...f.envelope, workspace: {
      ...f.envelope.workspace, accounts: [f.account, account],
      emiAgreements: [{ id: randomUUID(), userId: f.ownerId, accountId: account.id }],
    } };
    const input = JSON.stringify(envelope);
    const manifest = { ...f.manifest, inputSha256: exportSha256(input), changes: [{
      collection: "accounts", id: account.id, before: account, after: null,
    }] };
    expect(() => prepareWorkspaceExportRepair(input, JSON.stringify(manifest)))
      .toThrow("linked EMI agreement account");
  });

  it("rejects duplicate exported IDs and uneditable collections", () => {
    const f = fixture();
    f.envelope.workspace.accounts.push(f.account);
    f.input = JSON.stringify(f.envelope);
    f.manifest.inputSha256 = exportSha256(f.input);
    expect(() => prepare(f)).toThrow("Duplicate record IDs");
    expect(() => prepareWorkspaceExportRepair(f.input, JSON.stringify({ ...f.manifest,
      changes: [{ ...f.manifest.changes[0], collection: "auditEvents" }],
    }))).toThrow("valid workspace repair manifest");
  });

  it("rejects arbitrary paths and prototype keys instead of interpreting them", () => {
    const f = fixture();
    expect(() => prepareWorkspaceExportRepair(f.input, JSON.stringify({ ...f.manifest,
      changes: [{ ...f.manifest.changes[0], path: "profile.id" }],
    }))).toThrow("valid workspace repair manifest");
    const manifest = JSON.stringify(f.manifest).replace(
      '"notes":"Reviewed synthetic note"', '"__proto__":{"polluted":true}',
    );
    expect(() => prepareWorkspaceExportRepair(f.input, manifest)).toThrow("Unsupported object key");
    expect({}).not.toHaveProperty("polluted");
  });

  it("rejects reusing an applied repair ID even with a newly calculated input hash", () => {
    const f = fixture();
    const result = prepare(f);
    const candidate = JSON.parse(result.output);
    const repeated = { ...f.manifest, inputSha256: exportSha256(result.output), changes: [{
      ...f.manifest.changes[0], before: candidate.workspace.transactions[0],
      after: { ...candidate.workspace.transactions[0], notes: "Another change" },
    }] };
    expect(() => prepareWorkspaceExportRepair(result.output, JSON.stringify(repeated)))
      .toThrow("already prepared");
  });

  it("dry-runs without writing files and requires an explicit separate output for writes", async () => {
    const f = await files();
    expect(await repairWorkspaceExportFiles({
      inputPath: f.inputPath, manifestPath: f.manifestPath,
    })).toMatchObject({ mode: "dry-run", updated: 1 });
    expect(await readdir(f.directory)).toEqual(["export.json", "repair.json"]);
    expect(await readFile(f.inputPath, "utf8")).toBe(f.input);
    await expect(repairWorkspaceExportFiles({ ...f, write: true, outputPath: undefined }))
      .rejects.toThrow("both --write");
    await expect(repairWorkspaceExportFiles({ ...f, outputPath: f.outputPath }))
      .rejects.toThrow("both --write");
  });

  it("writes a new candidate exclusively and cannot overwrite the export, manifest, or previous output", async () => {
    const f = await files();
    const originalManifest = await readFile(f.manifestPath, "utf8");
    const result = await repairWorkspaceExportFiles({ ...f, write: true });
    expect(result.mode).toBe("candidate-written");
    const candidate = await readFile(f.outputPath, "utf8");
    expect(exportSha256(candidate)).toBe(result.outputSha256);
    for (const outputPath of [f.inputPath, f.manifestPath, f.outputPath])
      await expect(repairWorkspaceExportFiles({ ...f, write: true, outputPath }))
        .rejects.toThrow(/exist/i);
    expect(await readFile(f.inputPath, "utf8")).toBe(f.input);
    expect(await readFile(f.manifestPath, "utf8")).toBe(originalManifest);
    expect(await readFile(f.outputPath, "utf8")).toBe(candidate);
  });

  it("leaves no candidate when any final validation fails", async () => {
    const f = await files();
    f.manifest.changes[0].after.amount = "-1.00";
    await writeFile(f.manifestPath, JSON.stringify(f.manifest));
    await expect(repairWorkspaceExportFiles({ ...f, write: true })).rejects.toThrow();
    expect(await readdir(f.directory)).not.toContain("candidate.json");
    expect(await readFile(f.inputPath, "utf8")).toBe(f.input);
  });

  it("runs the command in dry-run mode and prints only counts and hashes", async () => {
    const f = await files();
    const result = await promisify(execFile)(process.execPath, [
      path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      path.join(process.cwd(), "scripts/repair-workspace-export.ts"),
      "--input", f.inputPath, "--manifest", f.manifestPath,
    ], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test" } });
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: "dry-run", updated: 1 });
    expect(result.stdout).not.toContain(f.ownerId);
    expect(result.stdout).not.toContain(f.transaction.description);
    expect(await readdir(f.directory)).toEqual(["export.json", "repair.json"]);
  });
});
