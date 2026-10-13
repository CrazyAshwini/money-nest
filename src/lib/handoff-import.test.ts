import { describe, expect, it } from "vitest";
import { planHandoffImport } from "./handoff-import";
import type { Account, Transaction, WorkspaceData } from "./types";

const OWNER = "20000000-0000-4000-8000-000000000001";
const BANK_PAGE = "30000000-0000-4000-8000-000000000001";
const TX_PAGE = "30000000-0000-4000-8000-000000000002";
const BANK = "40000000-0000-4000-8000-000000000001";
const TX = "40000000-0000-4000-8000-000000000002";
const url = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`;
function empty(): WorkspaceData {
  return {
    accounts: [],
    snapshots: [],
    transactions: [],
    bills: [],
    allocations: [],
    fixedDeposits: [],
    loans: [],
    emis: [],
    emiAllocations: [],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
  };
}
function manifest() {
  return {
    currency: "INR",
    as_of: "2026-10-13",
    accounts: [
      {
        code: "BANK",
        name: "Synthetic Bank • 1234",
        type: "Bank",
        limit_inr: null,
        snapshot_as_of: null,
        url: url(BANK_PAGE),
      },
    ],
    transactions: [
      {
        notion_page_id: TX_PAGE,
        date: "2026-10-10",
        amount_inr: 25,
        description: "Synthetic purchase",
        type: "Expense",
        from_account: "BANK",
        to_account: null,
        category: "Other",
        reference: "UPI 999999000001",
      },
    ],
  };
}
function bank(): Account {
  return {
    id: BANK,
    userId: OWNER,
    name: "Synthetic Bank",
    institution: "Synthetic Bank",
    kind: "bank",
    active: true,
    maskedSuffix: "1234",
    openingBalance: null,
    openingBalanceDate: null,
  };
}
function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: TX,
    userId: OWNER,
    amount: "25.00",
    currency: "INR",
    kind: "expense",
    status: "posted",
    occurredOn: "2026-10-10",
    description: "Synthetic purchase",
    fromAccountId: BANK,
    toAccountId: null,
    sourceSystem: "private_finance_export",
    sourceObjectId: "synthetic-old-row",
    externalReference: "1",
    notes: "Existing evidence remains private.",
    ...overrides,
  };
}
function existing(overrides: Partial<Transaction> = {}) {
  const data = empty();
  data.accounts.push(bank());
  data.transactions.push(transaction(overrides));
  return data;
}

describe("private handoff reconciliation", () => {
  it("imports stable Notion identities once and retains separate equal-sized sibling records", () => {
    const input = manifest();
    input.transactions.push({
      ...input.transactions[0],
      notion_page_id: "30000000-0000-4000-8000-000000000003",
      reference: "UPI 999999000002",
    });
    const first = planHandoffImport(input, empty(), OWNER);
    expect(first.counters.transactionsCreated).toBe(2);
    expect(first.workspace.transactions[0].id).not.toBe(
      first.workspace.transactions[1].id,
    );
    const again = planHandoffImport(
      input,
      first.workspace,
      OWNER,
      first.sources,
    );
    expect(again.counters.created).toBe(0);
    expect(again.workspace.transactions).toHaveLength(2);
  });

  it("holds equal date and amount as a candidate rather than assuming identity", () => {
    const previous = existing();
    const result = planHandoffImport(manifest(), previous, OWNER);
    expect(result.counters.transactionsCreated).toBe(0);
    expect(result.reviewItems[0].candidateIds).toEqual([TX]);
    expect(result.workspace.transactions).toEqual(previous.transactions);
    expect(
      result.sources.some((source) => source.collection === "transactions"),
    ).toBe(false);
  });

  it("matches actual bank references while preserving inherited identity and notes", () => {
    const previous = existing({ externalReference: "999999000001" });
    const result = planHandoffImport(manifest(), previous, OWNER);
    expect(result.reviewItems).toHaveLength(0);
    expect(result.workspace.transactions[0].id).toBe(TX);
    expect(result.workspace.transactions[0].sourceObjectId).toBe(
      "synthetic-old-row",
    );
    expect(result.workspace.transactions[0].notes).toContain(
      "Existing evidence remains private.",
    );
    expect(
      result.sources.find((source) => source.collection === "transactions")
        ?.recordId,
    ).toBe(TX);
  });

  it("detects an amount conflict behind the same bank reference", () => {
    const input = manifest();
    input.transactions[0].amount_inr = 30;
    const result = planHandoffImport(
      input,
      existing({ externalReference: "999999000001" }),
      OWNER,
    );
    expect(result.workspace.transactions[0].amount).toBe("25.00");
    expect(result.reviewItems[0].reason).toContain("amount");
    expect(result.counters.transactionsCreated).toBe(0);
  });

  it("requires a separate confirmation before matched financial corrections", () => {
    const input = manifest();
    input.transactions[0].amount_inr = 30;
    const previous = existing();
    const held = planHandoffImport(
      input,
      previous,
      OWNER,
      [],
      [{ sourceObjectId: TX_PAGE, action: "match", recordId: TX }],
    );
    expect(held.workspace.transactions[0].amount).toBe("25.00");
    const accepted = planHandoffImport(
      input,
      previous,
      OWNER,
      [],
      [
        {
          sourceObjectId: TX_PAGE,
          action: "match",
          recordId: TX,
          confirmCorrections: true,
        },
      ],
    );
    expect(accepted.workspace.transactions[0].amount).toBe("30.00");
    expect(accepted.workspace.transactions[0].id).toBe(TX);
  });

  it("retains missing dates as drafts without fabricating an account or date", () => {
    const input = manifest();
    const raw = input.transactions[0] as unknown as Record<string, unknown>;
    raw.date = null;
    raw.from_account = null;
    const result = planHandoffImport(input, empty(), OWNER);
    expect(result.workspace.transactions[0]).toMatchObject({
      occurredOn: null,
      status: "pending_review",
      fromAccountId: null,
      toAccountId: null,
    });
    const again = planHandoffImport(
      input,
      result.workspace,
      OWNER,
      result.sources,
    );
    expect(again.counters.created).toBe(0);
  });

  it("never removes a previously recorded transaction omitted from the handoff", () => {
    const previous = existing({ amount: "50.00" });
    const result = planHandoffImport(manifest(), previous, OWNER);
    expect(result.workspace.transactions).toHaveLength(2);
    expect(
      result.workspace.transactions.find((row) => row.id === TX)?.amount,
    ).toBe("50.00");
  });

  it("rejects repeated source identities and incorrect monetary/count claims", () => {
    const duplicate = manifest();
    duplicate.transactions.push(duplicate.transactions[0]);
    expect(() => planHandoffImport(duplicate, empty(), OWNER)).toThrow(
      "repeats",
    );
    const claimed = {
      ...manifest(),
      counts: { transactions: 2 },
      face_amount_totals_inr: { Expense: 30 },
    };
    expect(() => planHandoffImport(claimed, empty(), OWNER)).toThrow(
      "reconciliation",
    );
  });

  it("checks incoming statement invariants even when an identity decision is held", () => {
    const input = {
      ...manifest(),
      statement_reconciliation: {
        account: "BANK",
        statement_period_start: "2026-10-01",
        statement_period_end: "2026-10-13",
        opening_inr: 100,
        debit_count: 1,
        debit_total_inr: 25,
        credit_count: 0,
        credit_total_inr: 0,
        closing_inr: 75,
      },
    };
    const result = planHandoffImport(input, existing(), OWNER);
    expect(result.reviewItems).toHaveLength(1);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(() =>
      planHandoffImport(
        {
          ...input,
          statement_reconciliation: {
            ...input.statement_reconciliation,
            closing_inr: 80,
          },
        },
        empty(),
        OWNER,
      ),
    ).toThrow("reconciliation");
  });

  it("enforces workspace ownership and never treats row ordinals as bank references", () => {
    const input = manifest();
    input.transactions[0].reference = "1";
    const result = planHandoffImport(input, existing(), OWNER);
    expect(result.reviewItems).toHaveLength(1);
    const previous = existing();
    previous.transactions[0].userId = "20000000-0000-4000-8000-000000000002";
    expect(() => planHandoffImport(input, previous, OWNER)).toThrow(
      "ownership",
    );
  });
});
