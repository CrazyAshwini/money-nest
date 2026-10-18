import { describe, expect, it } from "vitest";
import {
  accountHistoryHref,
  accountTransactionDirection,
  getRecentAccountTransactions,
  maskedAccountSuffix,
  resolveSelectedAccountId,
} from "./account-presentation";
import type { Account, Transaction } from "./types";

const account: Account = {
  id: "bank-a",
  userId: "owner",
  name: "Everyday",
  institution: "Bank",
  kind: "bank",
  maskedSuffix: "1234",
  active: true,
};
const transaction = (
  id: string,
  values: Partial<Transaction> = {},
): Transaction => ({
  id,
  userId: account.userId,
  amount: "100.00",
  currency: "INR",
  kind: "expense",
  status: "posted",
  occurredOn: "2026-10-18",
  description: "Entry",
  fromAccountId: account.id,
  toAccountId: null,
  ...values,
});

describe("stable account presentation selection", () => {
  it("preserves selected identity through reorder and falls back safely after removal/filtering", () => {
    const records = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(resolveSelectedAccountId(records, "b")).toBe("b");
    expect(resolveSelectedAccountId([...records].reverse(), "b")).toBe("b");
    expect(
      resolveSelectedAccountId(
        records.filter((item) => item.id !== "b"),
        "b",
      ),
    ).toBe("a");
    expect(resolveSelectedAccountId(records, "missing")).toBe("a");
    expect(resolveSelectedAccountId([], "a")).toBeNull();
  });
  it("never displays more than four identifier characters", () => {
    expect(maskedAccountSuffix(" 1234567890 ")).toBe("••7890");
    expect(maskedAccountSuffix("12")).toBe("••12");
    expect(maskedAccountSuffix("")).toBe("Identifier not available");
    expect(maskedAccountSuffix(undefined)).toBe("Identifier not available");
  });
  it("preserves the exact account query ID and explicitly requests complete history", () => {
    const href = accountHistoryHref("a&kind=expense");
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("account")).toBe("a&kind=expense");
    expect(params.get("period")).toBe("all");
    expect(params.has("kind")).toBe(false);
  });
});

describe("account-specific recent ledger preview", () => {
  it("uses exact account links and owner scope, preserving repayments, refunds and review states", () => {
    const rows = [
      transaction("purchase"),
      transaction("repayment", {
        kind: "bill_payment",
        fromAccountId: "bank-b",
        toAccountId: account.id,
      }),
      transaction("refund", {
        kind: "refund",
        fromAccountId: null,
        toAccountId: account.id,
      }),
      transaction("pending", { status: "pending_review" }),
      transaction("voided", { status: "voided" }),
      transaction("other-account", {
        fromAccountId: "bank-aa",
        description: account.id,
      }),
      transaction("other-owner", { userId: "another-owner" }),
    ];
    const data = { accounts: [account], transactions: rows };
    expect(
      getRecentAccountTransactions(data, account.id, 5).map((row) => row.id),
    ).toEqual(["pending", "purchase", "refund", "repayment", "voided"]);
    expect(getRecentAccountTransactions(data, "missing")).toEqual([]);
    expect(data.transactions).toEqual(rows);
  });
  it("orders by recorded date and stable ID ties independently of insertion/creation time", () => {
    const rows = [
      transaction("b", {
        occurredOn: "2026-10-17",
        createdAt: "2026-10-19T12:00:00Z",
      }),
      transaction("undated", { occurredOn: null }),
      transaction("c", { occurredOn: "2026-10-18" }),
      transaction("a", {
        occurredOn: "2026-10-17",
        createdAt: "2026-10-01T12:00:00Z",
      }),
      transaction("old", { occurredOn: "2026-09-01" }),
    ];
    const data = { accounts: [account], transactions: rows };
    expect(
      getRecentAccountTransactions(data, account.id, 3).map((row) => row.id),
    ).toEqual(["c", "a", "b"]);
    expect(
      getRecentAccountTransactions(
        { ...data, transactions: [...rows].reverse() },
        account.id,
        3,
      ).map((row) => row.id),
    ).toEqual(["c", "a", "b"]);
    expect(rows[0].id).toBe("b");
  });
  it("shows a transfer once for either associated account without reclassifying its kind", () => {
    const transfer = transaction("transfer", {
      kind: "transfer",
      toAccountId: "bank-b",
    });
    const data = {
      accounts: [account, { ...account, id: "bank-b" }],
      transactions: [transfer],
    };
    expect(getRecentAccountTransactions(data, "bank-a")).toEqual([transfer]);
    expect(getRecentAccountTransactions(data, "bank-b")).toEqual([transfer]);
    expect(accountTransactionDirection(transfer, "bank-a")).toBe("outgoing");
    expect(accountTransactionDirection(transfer, "bank-b")).toBe("incoming");
    expect(
      accountTransactionDirection(
        { fromAccountId: "bank-a", toAccountId: "bank-a" },
        "bank-a",
      ),
    ).toBe("internal");
    expect(transfer.kind).toBe("transfer");
  });
});
