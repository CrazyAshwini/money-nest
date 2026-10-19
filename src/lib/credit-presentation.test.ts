import { describe, expect, it } from "vitest";
import {
  getAggregateCreditAvailability,
  getCreditAvailabilityPresentation,
} from "./credit-presentation";
import type { Account, AccountSnapshot, WorkspaceData } from "./types";
import { accountUsage } from "./usage";

const TODAY = "2026-10-19";
const OWNER = "synthetic-owner";

function fixture(): WorkspaceData {
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

function account(data: WorkspaceData, values: Partial<Account> = {}) {
  const record: Account = {
    id: `account-${data.accounts.length}`,
    userId: OWNER,
    active: true,
    kind: "credit_card",
    institution: "Synthetic issuer",
    name: "Synthetic card",
    maskedSuffix: "1234",
    creditLimit: "1000.00",
    ...values,
  };
  data.accounts.push(record);
  return record;
}

function report(
  data: WorkspaceData,
  accountId: string,
  values: Partial<AccountSnapshot>,
) {
  data.snapshots.push({
    id: `report-${data.snapshots.length}`,
    userId: OWNER,
    accountId,
    asOf: TODAY,
    source: "user_report",
    verifiedByUser: true,
    ...values,
  });
}

function bill(data: WorkspaceData, accountId: string) {
  data.bills.push({
    id: `bill-${data.bills.length}`,
    userId: OWNER,
    accountId,
    statementAmount: "170.00",
    statementDate: "2026-10-05",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    dueDate: "2026-10-25",
  });
}

describe("credit availability presentation from existing selectors", () => {
  it("retains the explicit verified availability rather than recalculating from usage", () => {
    const data = fixture();
    const card = account(data);
    report(data, card.id, {
      reportedOutstanding: "200.00",
      reportedAvailable: "700.00",
    });
    const before = structuredClone(data);
    expect(
      getCreditAvailabilityPresentation(accountUsage(data, card.id, TODAY)),
    ).toMatchObject({
      amount: "700.00",
      status: "verified",
      label: "Available credit",
    });
    expect(data).toEqual(before);
  });

  it("preserves verified zero availability", () => {
    const data = fixture();
    const card = account(data);
    report(data, card.id, { reportedAvailable: "0.00" });
    expect(
      getCreditAvailabilityPresentation(accountUsage(data, card.id, TODAY)),
    ).toMatchObject({
      amount: "0.00",
      status: "verified",
    });
  });

  it("labels a complete-balance limit subtraction as an estimate", () => {
    const data = fixture();
    const card = account(data);
    report(data, card.id, { reportedOutstanding: "200.00" });
    expect(
      getCreditAvailabilityPresentation(accountUsage(data, card.id, TODAY)),
    ).toMatchObject({
      amount: "800.00",
      status: "estimated",
      label: "Estimated available credit",
    });
  });

  it.each([
    { asOf: "2026-10-18", verifiedByUser: true },
    { asOf: TODAY, verifiedByUser: false },
  ])(
    "does not call a stale or unconfirmed availability report verified (%o)",
    (values) => {
      const data = fixture();
      const card = account(data);
      report(data, card.id, { reportedAvailable: "700.00", ...values });
      expect(
        getCreditAvailabilityPresentation(accountUsage(data, card.id, TODAY)),
      ).toMatchObject({
        amount: "700.00",
        status: "estimated",
        label: "Estimated available credit",
      });
    },
  );

  it("uses the selector's movement-adjusted value and downgrades its status", () => {
    const data = fixture();
    const card = account(data);
    report(data, card.id, { asOf: "2026-10-18", reportedAvailable: "700.00" });
    data.transactions.push({
      id: "later-purchase",
      userId: OWNER,
      kind: "expense",
      status: "posted",
      occurredOn: TODAY,
      amount: "45.25",
      currency: "INR",
      description: "Synthetic purchase",
      fromAccountId: card.id,
      toAccountId: null,
    });
    expect(
      getCreditAvailabilityPresentation(accountUsage(data, card.id, TODAY)),
    ).toMatchObject({
      amount: "654.75",
      status: "estimated",
    });
  });

  it("supports an independently reported available limit when the approved limit is unknown", () => {
    const data = fixture();
    const provider = account(data, { kind: "pay_later", creditLimit: null });
    report(data, provider.id, { reportedAvailable: "300.00" });
    const usage = accountUsage(data, provider.id, TODAY);
    expect(usage.used).toBeNull();
    expect(getCreditAvailabilityPresentation(usage)).toMatchObject({
      amount: "300.00",
      status: "verified",
      label: "Available limit",
    });
  });

  it("identifies an estimated Pay Later available limit without calling it verified", () => {
    const data = fixture();
    const provider = account(data, { kind: "pay_later" });
    report(data, provider.id, { reportedOutstanding: "200.00" });
    expect(
      getCreditAvailabilityPresentation(accountUsage(data, provider.id, TODAY)),
    ).toMatchObject({
      amount: "800.00",
      status: "estimated",
      label: "Estimated available limit",
    });
  });

  it("hides limit minus bill-only minimum exposure, which is only an upper bound", () => {
    const data = fixture();
    const provider = account(data, { kind: "pay_later" });
    bill(data, provider.id);
    const usage = accountUsage(data, provider.id, TODAY);
    expect(usage).toMatchObject({
      provenance: "partial",
      used: "170.00",
      availableCredit: null,
      estimatedAvailableCredit: "830.00",
    });
    expect(getCreditAvailabilityPresentation(usage)).toMatchObject({
      amount: null,
      status: "unknown",
      label: "Available limit",
    });
  });

  it("keeps direct verified availability even when the separately known usage is bill-only", () => {
    const data = fixture();
    const provider = account(data, { kind: "pay_later", creditLimit: null });
    bill(data, provider.id);
    report(data, provider.id, { reportedAvailable: "300.00" });
    const usage = accountUsage(data, provider.id, TODAY);
    expect(usage).toMatchObject({ provenance: "partial", used: "170.00" });
    expect(getCreditAvailabilityPresentation(usage)).toMatchObject({
      amount: "300.00",
      status: "verified",
      label: "Available limit",
    });
  });

  it("keeps unknown availability unknown instead of treating absent limits as zero", () => {
    const data = fixture();
    const card = account(data, { creditLimit: null });
    report(data, card.id, { reportedOutstanding: "200.00" });
    expect(
      getCreditAvailabilityPresentation(accountUsage(data, card.id, TODAY)),
    ).toMatchObject({
      amount: null,
      status: "unknown",
      label: "Available credit",
    });
  });
});

describe("aggregate availability coverage", () => {
  it("sums supported decimal amounts exactly without changing verification state", () => {
    const data = fixture();
    const first = account(data);
    const second = account(data);
    report(data, first.id, { reportedAvailable: "0.10" });
    report(data, second.id, { reportedAvailable: "0.20" });
    expect(
      getAggregateCreditAvailability(
        data.accounts.map((item) => accountUsage(data, item.id, TODAY)),
      ),
    ).toMatchObject({
      amount: "0.30",
      status: "verified",
      count: 2,
      knownCount: 2,
      verifiedCount: 2,
      estimatedCount: 0,
      complete: true,
    });
  });

  it("counts known zero as supported availability", () => {
    const data = fixture();
    const card = account(data);
    report(data, card.id, { reportedAvailable: "0.00" });
    expect(
      getAggregateCreditAvailability([accountUsage(data, card.id, TODAY)]),
    ).toMatchObject({
      amount: "0.00",
      status: "verified",
      knownCount: 1,
      complete: true,
    });
  });

  it("marks a mixed known/unknown aggregate partial and excludes the unknown figure", () => {
    const data = fixture();
    const known = account(data);
    const unknown = account(data);
    report(data, known.id, { reportedAvailable: "375.25" });
    const result = getAggregateCreditAvailability([
      accountUsage(data, known.id, TODAY),
      accountUsage(data, unknown.id, TODAY),
    ]);
    expect(result).toMatchObject({
      amount: "375.25",
      status: "partial",
      label: "Known available · partial",
      knownCount: 1,
      verifiedCount: 1,
      estimatedCount: 0,
      count: 2,
      complete: false,
    });
    expect(result.note).toContain(
      "Unknown availability is excluded, not treated as zero",
    );
  });

  it("retains estimated coverage even when other providers have unknown availability", () => {
    const data = fixture();
    const estimated = account(data, { kind: "pay_later" });
    const partial = account(data, { kind: "pay_later" });
    report(data, estimated.id, { reportedOutstanding: "100.00" });
    bill(data, partial.id);
    const result = getAggregateCreditAvailability([
      accountUsage(data, estimated.id, TODAY),
      accountUsage(data, partial.id, TODAY),
    ]);
    expect(result).toMatchObject({
      amount: "900.00",
      status: "partial",
      estimatedCount: 1,
      knownCount: 1,
      complete: false,
    });
    expect(result.note).toContain("1 of 2 providers");
    expect(result.note).toContain("Includes 1 estimate");
  });

  it("labels a complete mixture of verified and estimated records as estimated", () => {
    const data = fixture();
    const verified = account(data);
    const estimated = account(data);
    report(data, verified.id, { reportedAvailable: "300.00" });
    report(data, estimated.id, { reportedOutstanding: "200.00" });
    expect(
      getAggregateCreditAvailability([
        accountUsage(data, verified.id, TODAY),
        accountUsage(data, estimated.id, TODAY),
      ]),
    ).toMatchObject({
      amount: "1100.00",
      status: "estimated",
      label: "Estimated available",
      verifiedCount: 1,
      estimatedCount: 1,
      knownCount: 2,
      complete: true,
    });
  });

  it("does not invent a zero total for groups whose availability is entirely unknown", () => {
    const data = fixture();
    const card = account(data);
    expect(
      getAggregateCreditAvailability([accountUsage(data, card.id, TODAY)]),
    ).toMatchObject({
      amount: null,
      status: "unknown",
      knownCount: 0,
      count: 1,
      complete: false,
    });
  });

  it("has an explicit empty state for accounts not yet added", () => {
    expect(getAggregateCreditAvailability([])).toMatchObject({
      amount: null,
      status: "unknown",
      knownCount: 0,
      count: 0,
      complete: false,
      note: "No credit accounts in this group yet.",
    });
  });
});
