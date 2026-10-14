import { describe, expect, it } from "vitest";
import { emptyCommerce } from "./commerce";
import {
  mergePrivateProfileCommerce,
  preparePrivateProfileMerge,
} from "./private-profile-merge";
import type { Transaction, WorkspaceData } from "./types";

const owner = "00000000-0000-4000-8000-000000000001";
const id = (last: string) => `00000000-0000-4000-8000-${last.padStart(12, "0")}`;
const account = (accountId: string, name = "Everyday") => ({
  id: accountId,
  userId: owner,
  name,
  institution: "Example Bank",
  kind: "bank" as const,
  maskedSuffix: "1234",
  active: true,
});
const transaction = (
  transactionId: string,
  accountId: string,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  id: transactionId,
  userId: owner,
  amount: "12.00",
  currency: "INR",
  kind: "expense",
  status: "posted",
  occurredOn: "2026-10-01",
  description: "Synthetic purchase",
  fromAccountId: accountId,
  toAccountId: null,
  ...overrides,
});
const workspace = (): WorkspaceData => ({
  accounts: [], snapshots: [], transactions: [], bills: [], allocations: [],
  fixedDeposits: [], loans: [], emis: [], emiAllocations: [], groups: [],
  shares: [], settlements: [], reminders: [], auditEvents: [],
});

describe("private profile merge", () => {
  it("keeps cloud rows unchanged, deduplicates transaction sources, and adds missing rows", () => {
    const cloud = workspace();
    const cloudAccount = account(id("1"));
    const cloudTransaction = transaction(id("2"), cloudAccount.id, {
      sourceSystem: "statement",
      sourceObjectId: "source-1",
      description: "Cloud version",
    });
    cloud.accounts.push(cloudAccount);
    cloud.transactions.push(cloudTransaction);

    const local = workspace();
    local.accounts.push(account(id("9")));
    local.transactions.push(
      transaction(id("8"), id("9"), {
        sourceSystem: "statement",
        sourceObjectId: "source-1",
        description: "Local duplicate",
      }),
      transaction(id("10"), id("9"), {
        sourceSystem: "statement",
        sourceObjectId: "source-2",
      }),
    );

    const result = preparePrivateProfileMerge(cloud, local, owner);
    expect(result.delta.accounts).toHaveLength(0);
    expect(result.delta.transactions.map((row) => row.id)).toEqual([id("10")]);
    expect(result.transactionIds.get(id("8"))).toBe(cloudTransaction.id);
    expect(result.full.accounts).toEqual([cloudAccount]);
    expect(result.full.transactions[0]).toEqual(cloudTransaction);
    expect(result.full.transactions).toHaveLength(2);
  });

  it("matches the same account by its complete identity and remaps dependent links", () => {
    const cloud = workspace();
    cloud.accounts.push(account(id("1")));
    const local = workspace();
    const localAccount = account(id("9"));
    local.accounts.push(localAccount);
    local.transactions.push(transaction(id("8"), localAccount.id));
    local.snapshots.push({
      id: id("11"), userId: owner, accountId: localAccount.id,
      asOf: "2026-10-01T00:00:00.000Z", reportedBalance: "100.00",
      source: "user_report", verifiedByUser: true,
    });

    const result = preparePrivateProfileMerge(cloud, local, owner);
    expect(result.delta.accounts).toHaveLength(0);
    expect(result.delta.transactions[0].fromAccountId).toBe(id("1"));
    expect(result.delta.snapshots[0].accountId).toBe(id("1"));
  });

  it("maps legacy source-observation identities and preserves cloud commerce", () => {
    const cloud = workspace();
    const cloudAccount = account(id("1"));
    cloud.accounts.push(cloudAccount);
    cloud.transactions.push(transaction(id("2"), cloudAccount.id));
    const local = workspace();
    local.accounts.push({ ...cloudAccount });
    local.transactions.push(transaction(id("8"), cloudAccount.id, {
      sourceSystem: "notion",
      sourceObjectId: "page-1",
    }));

    const merged = preparePrivateProfileMerge(cloud, local, owner, [{
      recordId: id("2"), sourceSystem: "notion", sourceObjectId: "page-1",
    }]);
    expect(merged.delta.transactions).toHaveLength(0);
    expect(merged.transactionIds.get(id("8"))).toBe(id("2"));

    const current = emptyCommerce();
    current.operations.push({ key: "a".repeat(64), completedAt: "2026-10-01T00:00:00.000Z" });
    const incoming = emptyCommerce();
    incoming.operations.push(
      { key: "a".repeat(64), completedAt: "2026-10-02T00:00:00.000Z" },
      { key: "b".repeat(64), completedAt: "2026-10-03T00:00:00.000Z" },
    );
    const commerce = mergePrivateProfileCommerce(current, incoming, owner, merged.transactionIds);
    expect(commerce.added.operations).toBe(1);
    expect(commerce.commerce.operations[0]).toEqual(current.operations[0]);
    expect(commerce.commerce.operations).toHaveLength(2);
  });

  it("is idempotent when the same transfer is prepared again", () => {
    const cloud = workspace();
    const local = workspace();
    const saved = account(id("1"));
    local.accounts.push(saved);
    local.transactions.push(transaction(id("2"), saved.id));
    const first = preparePrivateProfileMerge(cloud, local, owner);
    const second = preparePrivateProfileMerge(first.full, local, owner);
    expect(Object.values(second.delta).every((rows) => rows.length === 0)).toBe(true);
  });
});
