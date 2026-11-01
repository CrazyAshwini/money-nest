import { describe, expect, it } from "vitest";
import { sanitizeWorkspaceTransactions, SAMSUNG_TV_LOAN_ID } from "../src/lib/workspace-cleaner";
import { loanSchema, emiSchema, validateWorkspaceRecord } from "../src/lib/validation";
import { accountBalance, emiSummary, localDateISO } from "../src/lib/finance";
import type { WorkspaceData, Account, Transaction, FixedDeposit } from "../src/lib/types";

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

    // Snapshots should include SBI 19,000.00 and ICICI 283.74 as of 31 Oct 2026
    const sbiSnap31 = result.snapshots.find(
      (s) => s.accountId === sbiAccountId && s.reportedBalance === "19000.00" && s.asOf.startsWith("2026-10-31"),
    );
    expect(sbiSnap31).toBeDefined();
    expect(sbiSnap31?.verifiedByUser).toBe(true);

    const iciciSnap31 = result.snapshots.find(
      (s) => s.accountId === iciciAccountId && s.reportedBalance === "223.44" && s.asOf.startsWith("2026-10-31"),
    );
    expect(iciciSnap31).toBeDefined();
    expect(iciciSnap31?.verifiedByUser).toBe(true);
    expect(localDateISO(iciciSnap31!.asOf)).toBe("2026-10-31");
    expect(localDateISO(sbiSnap31!.asOf)).toBe("2026-10-31");

    // A transaction on 31 Oct linked to this snapshot validates cleanly
    const sampleTx: Transaction = {
      id: "99999999-9999-4999-8999-999999999991",
      userId,
      amount: "10.00",
      currency: "INR",
      kind: "income",
      status: "posted",
      occurredOn: "2026-10-31",
      description: "Received cashback from POP · Popclubpayouts",
      merchant: "POP · Popclubpayouts",
      platform: "Online purchase",
      fromAccountId: null,
      toAccountId: iciciAccountId,
      category: "Income",
      sourceSystem: "receipt_ai",
      toBalanceSnapshotId: iciciSnap31?.id ?? null,
      fromBalanceSnapshotId: null,
    };
    expect(() => validateWorkspaceRecord(result, "transactions", sampleTx, userId)).not.toThrow();

    // ICICI transactions should contain the full 28 statement entries plus month-end charge (29 total)
    const iciciTxs = result.transactions.filter(
      (t) => t.fromAccountId === iciciAccountId || t.toAccountId === iciciAccountId,
    );
    expect(iciciTxs.length).toBeGreaterThanOrEqual(29);

    // Verified ICICI balance should reconcile to exactly ₹223.44
    const iciciBal = accountBalance(result, iciciAccountId, "2026-11-01");
    expect(iciciBal.current).toBe("223.44");
    expect(iciciBal.reconciliation).toBe("matched");

    // SBI new transactions should contain Utkarsh maturity, Meesho, Flipkart, Navi Loans, Ramswrup
    expect(result.transactions.some((t) => t.amount === "2001.15" && t.toAccountId === sbiAccountId)).toBe(true);
    expect(result.transactions.some((t) => t.amount === "137.00" && t.fromAccountId === sbiAccountId)).toBe(true);
    expect(result.transactions.some((t) => t.amount === "2.00" && t.fromAccountId === sbiAccountId)).toBe(true);
    const flipkartDiyaTx = result.transactions.find((t) => t.amount === "270.00" && t.fromAccountId === sbiAccountId);
    expect(flipkartDiyaTx).toBeDefined();
    expect(flipkartDiyaTx?.description).toContain("Cycle Pure Ghee Tealight Diyas");
    expect(flipkartDiyaTx?.merchant).toContain("SuperComNet");
    expect(flipkartDiyaTx?.notes).toContain("OD439018210263725100");
    expect(result.transactions.some((t) => t.amount === "3500.00" && t.fromAccountId === sbiAccountId)).toBe(true);
    expect(result.transactions.some((t) => t.amount === "1100.00" && t.toAccountId === sbiAccountId)).toBe(true);

    // Self-transfers should connect SBI and ICICI cleanly
    const sbiToIcici2500 = result.transactions.find(
      (t) => t.amount === "2500.00" && t.fromAccountId === sbiAccountId && t.toAccountId === iciciAccountId,
    );
    expect(sbiToIcici2500).toBeDefined();

    const iciciToSbi1555 = result.transactions.find(
      (t) => t.amount === "1555.00" && t.fromAccountId === iciciAccountId && t.toAccountId === sbiAccountId,
    );
    expect(iciciToSbi1555).toBeDefined();

    const sbiToIcici323 = result.transactions.find(
      (t) => t.amount === "323.00" && t.fromAccountId === sbiAccountId && t.toAccountId === iciciAccountId,
    );
    expect(sbiToIcici323).toBeDefined();

    // Utkarsh SuperMoney account should be present and active with ₹990.00 limit
    const utkarshAcc = result.accounts.find(
      (a) => a.kind === "credit_card" && (a.maskedSuffix === "XX32" || a.name?.includes("Utkarsh")),
    );
    expect(utkarshAcc).toBeDefined();
    expect(utkarshAcc?.creditLimit).toBe("990.00");
    expect(utkarshAcc?.active).toBe(true);

    // Utkarsh SuperMoney 9 successful spends should all be present
    const utkarshId = utkarshAcc!.id;
    const utkarshSpends = result.transactions.filter(
      (t) => t.fromAccountId === utkarshId && t.kind === "expense",
    );
    expect(utkarshSpends).toHaveLength(9);
    expect(utkarshSpends.some((t) => t.amount === "140.00" && t.occurredOn === "2026-10-02")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "360.00" && t.occurredOn === "2026-10-06")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "40.00" && t.occurredOn === "2026-10-06")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "291.00" && t.occurredOn === "2026-10-08")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "257.22" && t.occurredOn === "2026-10-10")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "40.00" && t.occurredOn === "2026-10-12")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "224.00" && t.occurredOn === "2026-10-25")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "140.49" && t.occurredOn === "2026-10-30")).toBe(true);
    expect(utkarshSpends.some((t) => t.amount === "136.19" && t.occurredOn === "2026-10-31")).toBe(true);

    // Utkarsh repayments from SBI (941.75 on 2 Oct, 832.01 on 9 Oct)
    const utkarshRepay1 = result.transactions.find(
      (t) => t.amount === "941.75" && t.fromAccountId === sbiAccountId && t.toAccountId === utkarshId,
    );
    expect(utkarshRepay1).toBeDefined();
    expect(utkarshRepay1?.kind).toBe("bill_payment");

    const utkarshRepay2 = result.transactions.find(
      (t) => t.amount === "832.01" && t.fromAccountId === sbiAccountId && t.toAccountId === utkarshId,
    );
    expect(utkarshRepay2).toBeDefined();
    expect(utkarshRepay2?.kind).toBe("bill_payment");

    // Utkarsh snapshot as of 31 Oct with outstanding ₹797.90
    const utkarshSnap31 = result.snapshots.find(
      (s) => s.accountId === utkarshId && s.asOf.startsWith("2026-10-31"),
    );
    expect(utkarshSnap31).toBeDefined();
    expect(utkarshSnap31?.reportedOutstanding).toBe("797.90");
    expect(utkarshSnap31?.verifiedByUser).toBe(true);
  });

  it("attaches Samsung TV EMI agreement, loan, and 9 installments when Amazon Pay Later account exists", () => {
    const ws = createBaseWorkspace();
    ws.accounts.push({
      id: "476fa60a-ab35-5769-a18c-839e8a88d283",
      userId,
      name: "Amazon Pay Later",
      institution: "Amazon",
      kind: "pay_later",
      maskedSuffix: "",
      creditLimit: "35000.00",
      active: true,
    });

    const result = sanitizeWorkspaceTransactions(ws);
    expect(result.emiAgreements).toBeDefined();
    expect(result.emiAgreements).toHaveLength(1);
    expect(result.emiAgreements![0]).toMatchObject({
      id: "agr-samsung-tv",
      financedPrincipal: "30509.79",
      monthlyPayment: "3678.70",
      emiCount: 9,
      status: "active",
    });

    // Check Loan
    expect(result.loans).toBeDefined();
    expect(result.loans).toHaveLength(1);
    const tvLoan = result.loans.find((l) => l.id === SAMSUNG_TV_LOAN_ID);
    expect(tvLoan).toBeDefined();
    expect(tvLoan).toMatchObject({
      id: SAMSUNG_TV_LOAN_ID,
      userId,
      name: 'Samsung 43" TV (Amazon Pay Later EMI)',
      lender: "Amazon Pay Later",
      kind: "institutional",
      contractualPrincipal: "30509.79",
      netDisbursed: "30509.79",
      reportedOutstanding: "30509.79",
      reportedAsOf: "2026-10-18",
      repaymentAccountId: "476fa60a-ab35-5769-a18c-839e8a88d283",
    });
    expect(loanSchema.safeParse(tvLoan).success).toBe(true);

    // Check EMIs
    expect(result.emis).toBeDefined();
    expect(result.emis).toHaveLength(9);
    expect(result.emis.every((e) => e.loanId === SAMSUNG_TV_LOAN_ID)).toBe(true);
    expect(result.emis.every((e) => e.amount === "3678.70")).toBe(true);
    expect(result.emis.every((e) => emiSchema.safeParse(e).success)).toBe(true);
    expect(result.emis[0].dueDate).toBe("2026-11-05");
    expect(result.emis[8].dueDate).toBe("2027-07-05");
  });

  it("updates Navi Personal Loan, marks EMI #1 paid on 2026-10-30, and links emiAllocation", () => {
    const naviLoanId = "20b7d2f7-5853-5e57-aa97-0a57619c611b";
    const naviEmi1Id = "b1945f2c-6bc1-5edc-a3c2-001879c2a307";
    const naviEmi2Id = "c2945f2c-6bc1-5edc-a3c2-001879c2a308";
    const naviEmi3Id = "d3945f2c-6bc1-5edc-a3c2-001879c2a309";

    const base = createBaseWorkspace();
    const workspace: WorkspaceData = {
      ...base,
      loans: [
        {
          id: naviLoanId,
          userId,
          name: "Navi Personal Loan",
          lender: "Navi Finance",
          kind: "institutional",
          contractualPrincipal: "10500.00",
          netDisbursed: "10500.00",
          reportedOutstanding: "10500.00",
          reportedAsOf: "2026-10-01",
          repaymentAccountId: sbiAccountId,
          disbursedOn: "2026-10-01",
        },
      ],
      emis: [
        {
          id: naviEmi1Id,
          userId,
          loanId: naviLoanId,
          number: 1,
          dueDate: "2026-11-01",
          amount: "3500.00",
        },
        {
          id: naviEmi2Id,
          userId,
          loanId: naviLoanId,
          number: 2,
          dueDate: "2026-12-01",
          amount: "3500.00",
        },
        {
          id: naviEmi3Id,
          userId,
          loanId: naviLoanId,
          number: 3,
          dueDate: "2027-01-01",
          amount: "3500.00",
        },
      ],
      emiAllocations: [],
      transactions: [],
    };

    const cleaned = sanitizeWorkspaceTransactions(workspace);

    // 1. Verify Navi loan outstanding reduced to 7000.00 as of 2026-10-30
    const naviLoan = cleaned.loans.find((l) => l.id === naviLoanId);
    expect(naviLoan).toBeDefined();
    expect(naviLoan?.reportedOutstanding).toBe("7000.00");
    expect(naviLoan?.reportedAsOf).toBe("2026-10-30");

    // 2. Verify EMI #1 due date updated to 2026-10-30
    const emi1 = cleaned.emis.find((e) => e.id === naviEmi1Id);
    expect(emi1).toBeDefined();
    expect(emi1?.dueDate).toBe("2026-10-30");

    // 3. Verify Navi payment transaction is formatted and dated 2026-10-30
    const naviTx = cleaned.transactions.find(
      (t) => t.amount === "3500.00" && t.externalReference === "144089859407",
    );
    expect(naviTx).toBeDefined();
    expect(naviTx?.occurredOn).toBe("2026-10-30");
    expect(naviTx?.merchant).toBe("Navi Loans");
    expect(naviTx?.description).toBe("Navi Loans — Personal Loan EMI #1");
    expect(naviTx?.kind).toBe("bill_payment");

    // 4. Verify emiAllocation was created
    const alloc = cleaned.emiAllocations.find((a) => a.emiId === naviEmi1Id);
    expect(alloc).toBeDefined();
    expect(alloc?.amount).toBe("3500.00");
    expect(alloc?.transactionId).toBe(naviTx?.id);

    // 5. Verify emiSummary calculates EMI #1 as paid
    const summary = emiSummary(cleaned, naviEmi1Id, "2026-10-31");
    expect(summary.status).toBe("paid");
    expect(summary.paid).toBe("3500.00");
    expect(summary.remaining).toBe("0.00");
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

  it("ensures exactly one ₹60.30 transaction for Chicken Biryani in Food category with ₹223.44 ICICI balance", () => {
    const ws = createBaseWorkspace();
    // Add an existing 60.30 transaction to test deduplication
    ws.transactions.push({
      id: "existing-60-30",
      userId,
      amount: "60.30",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-31",
      description: "Old charge 60.30",
      fromAccountId: iciciAccountId,
      toAccountId: null,
    });

    const result = sanitizeWorkspaceTransactions(ws);
    const biryaniTxns = result.transactions.filter((t) => t.amount === "60.30");
    expect(biryaniTxns).toHaveLength(1);
    expect(biryaniTxns[0].description).toBe("Chicken Biryani");
    expect(biryaniTxns[0].category).toBe("Food");
    expect(biryaniTxns[0].merchant).toBe("Chicken Biryani");
    expect(biryaniTxns[0].fromAccountId).toBe(iciciAccountId);

    const bal = accountBalance(result, iciciAccountId, "2026-10-31");
    expect(bal.current).toBe("223.44");
  });

  it("updates Suryoday credit limit to 900.00 and records repayments (820.91 & 50) and 29.09 cashback", () => {
    const ws = createBaseWorkspace();
    // Add an initial Suryoday transaction to verify update
    ws.transactions.push({
      id: "f25f639d-b1b9-4579-bcfa-90f169585650",
      userId,
      amount: "821.25",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-21",
      description: "Bill payment for Suryoday RuPay",
      fromAccountId: sbiAccountId,
      toAccountId: null,
    });

    const result = sanitizeWorkspaceTransactions(ws);
    const suryodayAccountId = "8986e87f-8844-5af2-a7a5-31ef839fb72c";

    // 1. Suryoday account should exist with 900.00 limit
    const suryodayAcc = result.accounts.find((a) => a.id === suryodayAccountId);
    expect(suryodayAcc).toBeDefined();
    expect(suryodayAcc?.creditLimit).toBe("900.00");
    expect(suryodayAcc?.kind).toBe("credit_card");

    // 2. Repayment of 820.91 should be updated and mapped to bill_payment
    const repayment820 = result.transactions.find((t) => t.toAccountId === suryodayAccountId && t.amount === "820.91");
    expect(repayment820).toBeDefined();
    expect(repayment820?.kind).toBe("bill_payment");
    expect(repayment820?.occurredOn).toBe("2026-10-21");

    // 3. Repayment of 50.00 should be recorded
    const repayment50 = result.transactions.find((t) => t.toAccountId === suryodayAccountId && t.amount === "50.00");
    expect(repayment50).toBeDefined();
    expect(repayment50?.kind).toBe("bill_payment");
    expect(repayment50?.occurredOn).toBe("2026-10-18");

    // 4. Cashback of 29.09 should be recorded on 21 Oct
    const cashback = result.transactions.find((t) => t.toAccountId === suryodayAccountId && t.amount === "29.09");
    expect(cashback).toBeDefined();
    expect(cashback?.kind).toBe("adjustment");
    expect(cashback?.occurredOn).toBe("2026-10-21");

    // 5. Total credit payments (820.91 + 50.00 + 29.09 = 900.00) clears the 900.00 opening liability
    const snapshot = result.snapshots.find((s) => s.accountId === suryodayAccountId);
    expect(snapshot).toBeDefined();
    expect(snapshot?.reportedOutstanding).toBe("0.00");
    expect(snapshot?.reportedAvailable).toBe("900.00");
  });
});
