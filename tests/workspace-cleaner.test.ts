import { describe, expect, it } from "vitest";
import { sanitizeWorkspaceTransactions } from "../src/lib/workspace-cleaner";
import type { WorkspaceData, Account, Transaction, AccountSnapshot, FixedDeposit } from "../src/lib/types";

describe("workspace-cleaner", () => {
  const userId = "4aed7ac5-23e7-4878-aa7a-13ad6d24b597";
  const sbiAccountId = "a4efa024-1d0c-59a2-aabd-c330a661be77";
  const idfcAccountId = "5d9bc626-5ee8-514f-a2ff-fca8b5618b74";
  const iciciAccountId = "2e84b7fc-dc55-4052-a087-7910619c3f2e";

  const createBaseWorkspace = (): WorkspaceData => {
    const accounts: Account[] = [
      {
        id: sbiAccountId,
        userId,
        name: "SBI Savings",
        institution: "SBI",
        kind: "bank",
        maskedSuffix: "6338",
        active: true,
      },
      {
        id: idfcAccountId,
        userId,
        name: "IDFC FIRST Hello Cashback",
        institution: "IDFC FIRST Bank",
        kind: "credit_card",
        maskedSuffix: "9959",
        active: true,
      },
      {
        id: iciciAccountId,
        userId,
        name: "ICICI Bank",
        institution: "ICICI Bank",
        kind: "bank",
        maskedSuffix: "3888",
        active: true,
      },
    ];

    const fixedDeposits: FixedDeposit[] = [
      {
        id: "0ed85bdd-233c-508d-ac8d-b6722773ff34",
        userId,
        name: "IDFC FIRST Bank fixed deposit 2",
        institution: "IDFC FIRST Bank",
        maskedSuffix: "",
        principal: "10000.00",
        openingDate: "2026-04-18",
        maturityDate: "2027-04-20",
        payoutMethod: "Unconfirmed",
        maturityInstruction: "reinvest",
        pledged: true,
        backingAccountId: idfcAccountId,
        payoutAccountId: null,
      },
    ];

    const transactions: Transaction[] = [
      {
        id: "4234c966-1214-42b1-9b12-25197b972bb7",
        userId,
        amount: "121.10",
        currency: "INR",
        kind: "expense",
        status: "posted",
        occurredOn: "2026-10-18",
        description: "Credit Card Bill Payment · IDFC First Bank",
        fromAccountId: sbiAccountId,
        toAccountId: null,
      },
    ];

    return {
      accounts,
      snapshots: [],
      transactions,
      bills: [],
      allocations: [],
      fixedDeposits,
      loans: [],
      emis: [],
      emiAllocations: [],
      groups: [],
      shares: [],
      settlements: [],
      reminders: [],
      auditEvents: [],
    };
  };

  it("applies IDFC card closure, cashback statement credit, and FD encashment into SBI", () => {
    const ws = createBaseWorkspace();
    const result = sanitizeWorkspaceTransactions(ws);

    // IDFC card should be deactivated
    const idfcAcc = result.accounts.find((a) => a.id === idfcAccountId);
    expect(idfcAcc?.active).toBe(false);
    expect(idfcAcc?.notes).toContain("Card closed on 25 Oct 2026");

    // FD should be unpledged with payout to SBI and encashment value 10289.00
    const fd = result.fixedDeposits.find((f) => f.id === "0ed85bdd-233c-508d-ac8d-b6722773ff34");
    expect(fd?.pledged).toBe(false);
    expect(fd?.payoutAccountId).toBe(sbiAccountId);
    expect(fd?.reportedEncashmentValue).toBe("10289.00");
    expect(fd?.reportedAsOf).toBe("2026-10-25");

    // Transactions should include IDFC cashback credit of 48.90
    const cashback = result.transactions.find((t) => t.toAccountId === idfcAccountId && t.amount === "48.90");
    expect(cashback).toBeDefined();
    expect(cashback?.kind).toBe("adjustment");
    expect(cashback?.occurredOn).toBe("2026-10-19");

    // Transactions should include SBI 25 Oct mini-statement items
    const rapido = result.transactions.find((t) => t.fromAccountId === sbiAccountId && t.amount === "50.00");
    expect(rapido).toBeDefined();
    expect(rapido?.kind).toBe("expense");
    expect(rapido?.category).toBe("Transport");

    const fdCredit = result.transactions.find((t) => t.toAccountId === sbiAccountId && t.amount === "10289.00");
    expect(fdCredit).toBeDefined();
    expect(fdCredit?.kind).toBe("transfer");

    const bankVerify = result.transactions.find((t) => t.toAccountId === sbiAccountId && t.amount === "1.00");
    expect(bankVerify).toBeDefined();
    expect(bankVerify?.kind).toBe("adjustment");

    // Snapshots should include SBI 18,575.85 and IDFC 0.00
    const sbiSnap = result.snapshots.find((s) => s.accountId === sbiAccountId && s.reportedBalance === "18575.85");
    expect(sbiSnap).toBeDefined();
    expect(sbiSnap?.verifiedByUser).toBe(true);

    const idfcSnap = result.snapshots.find((s) => s.accountId === idfcAccountId && s.reportedBalance === "0.00");
    expect(idfcSnap).toBeDefined();
  });

  it("does not inject rogue transactions into empty workspaces for other users", () => {
    const emptyWorkspace: WorkspaceData = {
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

    const result = sanitizeWorkspaceTransactions(emptyWorkspace);
    expect(result.transactions).toHaveLength(0);
    expect(result.snapshots).toHaveLength(0);
  });
});
