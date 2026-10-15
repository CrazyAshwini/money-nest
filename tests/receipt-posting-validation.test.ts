import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AccountSnapshot, Transaction, WorkspaceData } from "../src/lib/types";
import { ReceiptDuplicateError, validateWorkspaceRecord } from "../src/lib/validation";

function fixture() {
  const userId = randomUUID();
  const bank = randomUUID();
  const card = randomUUID();
  const payLater = randomUUID();
  const data: WorkspaceData = {
    accounts: [
      { id: bank, userId, kind: "bank", name: "Synthetic bank", institution: "Synthetic", maskedSuffix: "", active: true },
      { id: card, userId, kind: "credit_card", name: "Synthetic card", institution: "Synthetic", maskedSuffix: "", active: true },
      { id: payLater, userId, kind: "pay_later", name: "Synthetic Pay Later", institution: "Synthetic", maskedSuffix: "", active: true },
    ],
    snapshots: [], transactions: [], bills: [], allocations: [], fixedDeposits: [], loans: [], emis: [], emiAllocations: [], groups: [], shares: [], settlements: [], reminders: [], auditEvents: [],
  };
  const entry: Transaction = { id: randomUUID(), userId, amount: "45.00", currency: "INR", kind: "expense", status: "posted", occurredOn: "2026-10-15", description: "Synthetic screenshot purchase", fromAccountId: bank, toAccountId: null, sourceSystem: "receipt_ai", sourceObjectId: "a".repeat(64), externalReference: "RRN123456789" };
  const report = (accountId: string, fields: Partial<AccountSnapshot>): AccountSnapshot => ({ id: randomUUID(), userId, accountId, asOf: "2026-10-14T20:00:00Z", source: "app_screenshot", verifiedByUser: true, ...fields });
  return { data, entry, report, bank, card, payLater, userId };
}

describe("confirmed screenshot posting boundary", () => {
  it.each(["reportedUtilized", "reportedOutstanding", "reportedAvailable"] as const)("accepts a known zero %s for either liability account", (field) => {
    const f = fixture();
    for (const accountId of [f.card, f.payLater]) {
      const snapshot = f.report(accountId, { [field]: "0.00" });
      f.data.snapshots = [snapshot];
      expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, fromAccountId: accountId, fromBalanceSnapshotId: snapshot.id }, f.userId)).not.toThrow();
      expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, kind: "refund", fromAccountId: null, toAccountId: accountId, toBalanceSnapshotId: snapshot.id }, f.userId)).not.toThrow();
    }
  });

  it("requires the matching account's cash or liability amount, owner and IST date", () => {
    const f = fixture();
    const cardReport = f.report(f.card, { reportedBalance: "0.00" });
    const bankReport = f.report(f.bank, { reportedAvailable: "0.00" });
    f.data.snapshots = [cardReport, bankReport];
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, fromAccountId: f.card, fromBalanceSnapshotId: cardReport.id }, f.userId)).toThrow("owned account balance or credit report");
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, fromBalanceSnapshotId: bankReport.id }, f.userId)).toThrow("owned account balance or credit report");
    cardReport.reportedUtilized = "0.00";
    for (const changes of [{ occurredOn: "2026-10-14" }, { fromAccountId: f.payLater }, { fromAccountId: randomUUID() }]) {
      expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, fromAccountId: f.card, fromBalanceSnapshotId: cardReport.id, ...changes }, f.userId)).toThrow();
    }
    cardReport.userId = randomUUID();
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, fromAccountId: f.card, fromBalanceSnapshotId: cardReport.id }, f.userId)).toThrow();
  });

  it("protects linked liability reports while permitting zero-valued alternate metrics", () => {
    const f = fixture();
    const snapshot = f.report(f.card, { reportedUtilized: "100.00" });
    f.data.snapshots = [snapshot];
    f.data.transactions = [{ ...f.entry, fromAccountId: f.card, fromBalanceSnapshotId: snapshot.id }];
    expect(() => validateWorkspaceRecord(f.data, "snapshots", { ...snapshot, reportedUtilized: null, reportedAvailable: "0.00" }, f.userId)).not.toThrow();
    for (const changes of [{ reportedUtilized: null, reportedBalance: "100.00" }, { accountId: f.payLater }, { asOf: "2026-10-15T20:00:00Z" }]) {
      expect(() => validateWorkspaceRecord(f.data, "snapshots", { ...snapshot, ...changes }, f.userId)).toThrow("Remove transaction balance confirmations");
    }
  });

  it("rejects duplicate screenshot identities across IDs including voided records and permits same-ID retries", () => {
    const f = fixture();
    f.data.transactions = [{ ...f.entry, status: "voided" }];
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, id: randomUUID(), externalReference: null }, f.userId)).toThrow(ReceiptDuplicateError);
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, description: "Reviewed existing entry" }, f.userId)).not.toThrow();
  });

  it("rejects a normalized receipt reference for the same account without merging cross-account entries", () => {
    const f = fixture();
    f.data.transactions = [{ ...f.entry, status: "voided" }];
    const next = { ...f.entry, id: randomUUID(), sourceObjectId: "b".repeat(64), externalReference: " rrn 123456789 " };
    expect(() => validateWorkspaceRecord(f.data, "transactions", next, f.userId)).toThrow("Review the existing transaction");
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...next, kind: "income", fromAccountId: null, toAccountId: f.card }, f.userId)).not.toThrow();
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...next, sourceSystem: "csv" }, f.userId)).not.toThrow();
  });

  it("allows unrelated edits of legacy duplicate identities while rejecting a new conflicting identity", () => {
    const f = fixture();
    const second = { ...f.entry, id: randomUUID() };
    f.data.transactions = [f.entry, second];
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...second, description: "Corrected old label" }, f.userId)).not.toThrow();
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...second, sourceObjectId: "c".repeat(64), externalReference: "REF999999" }, f.userId)).not.toThrow();
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...second, sourceObjectId: "c".repeat(64) }, f.userId)).not.toThrow();
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...second, sourceSystem: "manual" }, f.userId)).not.toThrow();
    f.data.transactions.push({ ...f.entry, id: randomUUID(), sourceObjectId: "d".repeat(64) });
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...second, sourceObjectId: "d".repeat(64) }, f.userId)).toThrow(ReceiptDuplicateError);
  });

  it("keeps unknown references distinct and rejects negative money or foreign account links", () => {
    const f = fixture();
    f.data.transactions = [{ ...f.entry, externalReference: "Unknown" }];
    expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, id: randomUUID(), sourceObjectId: "b".repeat(64), externalReference: " unknown " }, f.userId)).not.toThrow();
    for (const changes of [{ amount: "-45.00" }, { fromAccountId: randomUUID() }, { toAccountId: randomUUID() }]) {
      expect(() => validateWorkspaceRecord(f.data, "transactions", { ...f.entry, ...changes }, f.userId)).toThrow();
    }
  });
});
