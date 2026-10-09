import { describe, expect, it } from "vitest";
import { groupSummary, monthlySummary } from "./finance";
import { cloneDemoData, DEMO_ACCOUNT_IDS, DEMO_USER_ID } from "./seed";
import type { ExpenseGroup, Transaction, WorkspaceData } from "./types";
import { validateWorkspaceRecord } from "./validation";

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function fixture(): WorkspaceData {
  const data = cloneDemoData();
  data.groups = [];
  data.shares = [];
  data.settlements = [];
  data.transactions = [];
  data.allocations = [];
  data.emiAllocations = [];
  const transaction = (
    number: number,
    amount: string,
    kind: "transfer" | "expense",
  ): Transaction => ({
    id: id(number),
    userId: DEMO_USER_ID,
    amount,
    currency: "INR",
    kind,
    status: "posted",
    occurredOn: "2026-10-04",
    description: "Synthetic group payment",
    fromAccountId: kind === "expense" ? DEMO_ACCOUNT_IDS.bank : null,
    toAccountId: kind === "transfer" ? DEMO_ACCOUNT_IDS.bank : null,
  });
  data.transactions = [
    transaction(8101, "100.00", "transfer"),
    transaction(8102, "80.00", "transfer"),
    transaction(8103, "90.00", "expense"),
    transaction(8104, "40.00", "expense"),
    transaction(8105, "10.00", "expense"),
  ];
  const group: ExpenseGroup = {
    id: id(8201),
    userId: DEMO_USER_ID,
    kind: "contribution_pool",
    title: "Synthetic contribution pool",
    occurredOn: "2026-10-04",
    merchant: "Contribution pool",
    totalCost: "140.00",
    paidBy: "Contribution pool",
    transactionId: null,
    notes:
      "Known payments are separate posted purchases; personal share unknown.",
  };
  data.groups.push(group);
  data.settlements = data.transactions.slice(0, 2).map((movement, index) => ({
    id: id(8301 + index),
    userId: DEMO_USER_ID,
    groupId: group.id,
    transactionId: movement.id,
    counterparty: `Person ${index + 1}`,
    direction: "incoming",
    amount: movement.amount,
  }));
  return data;
}

describe("contribution pools", () => {
  it("keeps contribution cash distinct from expense, income, and personal cost", () => {
    const data = fixture();
    const group = data.groups[0];
    expect(
      validateWorkspaceRecord(data, "groups", group, DEMO_USER_ID),
    ).toEqual(group);
    expect(groupSummary(data, group.id)).toMatchObject({
      isContributionPool: true,
      total: "140.00",
      incoming: "180.00",
      poolRemaining: "40.00",
      ownerShareKnown: false,
      receivable: "0.00",
      payable: "0.00",
    });
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      gross: "140.00",
      net: "140.00",
      income: "0.00",
      expenseCount: 3,
    });
    expect(data.transactions).toHaveLength(5);
  });

  it("shows a pool shortfall and deducts an explicitly matched returned contribution", () => {
    const data = fixture();
    const returned: Transaction = {
      ...data.transactions[0],
      id: id(8106),
      amount: "50.00",
      fromAccountId: DEMO_ACCOUNT_IDS.bank,
      toAccountId: null,
    };
    data.transactions.push(returned);
    data.settlements.push({
      ...data.settlements[0],
      id: id(8303),
      transactionId: returned.id,
      direction: "outgoing",
      amount: returned.amount,
    });
    expect(groupSummary(data, data.groups[0].id)).toMatchObject({
      outgoing: "50.00",
      poolRemaining: "-10.00",
      ownerShareKnown: false,
      payable: "0.00",
    });
  });

  it("excludes unconfirmed cash movements and recognizes an explicit zero personal share", () => {
    const data = fixture();
    data.transactions[1].status = "pending_review";
    data.shares.push({
      id: id(8401),
      userId: DEMO_USER_ID,
      groupId: data.groups[0].id,
      participant: "You",
      amount: "0.00",
      isOwner: true,
    });
    expect(groupSummary(data, data.groups[0].id)).toMatchObject({
      incoming: "100.00",
      poolRemaining: "-40.00",
      ownerShareKnown: true,
      ownerShare: "0.00",
    });
  });

  it("retains linked-purchase validation for legacy expenses and protects the pool type", () => {
    const data = fixture();
    const pool = data.groups[0];
    expect(() =>
      validateWorkspaceRecord(
        data,
        "groups",
        { ...pool, id: id(8202), kind: undefined },
        DEMO_USER_ID,
      ),
    ).toThrow("existing dated posted purchase");
    expect(() =>
      validateWorkspaceRecord(
        data,
        "groups",
        { ...pool, kind: "expense", transactionId: data.transactions[2].id },
        DEMO_USER_ID,
      ),
    ).toThrow("cannot change its type");
    expect(() =>
      validateWorkspaceRecord(
        data,
        "groups",
        { ...pool, transactionId: data.transactions[2].id },
        DEMO_USER_ID,
      ),
    ).toThrow("separate ledger payments");
  });
});
