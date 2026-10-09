import { addMoney, ledgerBalance, subtractMoney } from "./finance";
import type { Account, Transaction, WorkspaceData } from "./types";

/** Fictional fixtures only. Never replace these with an owner's imported records. */
export const DEMO_USER_ID = "10000000-0000-4000-8000-000000000001";
export const DEMO_TODAY = "2026-10-09";
export const DEMO_MONTH = "2026-10";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const DEMO_ACCOUNT_IDS = {
  bank: id(101),
  savings: id(102),
  platinum: id(103),
  rewards: id(104),
  secured: id(105),
  payLater: id(106),
  wallet: id(107),
};
export function createDemoData(): WorkspaceData {
  const userId = DEMO_USER_ID;
  const a = DEMO_ACCOUNT_IDS;
  const accounts: Account[] = [
    {
      id: a.bank,
      userId,
      name: "Meridian Everyday",
      institution: "Meridian Bank",
      kind: "bank",
      maskedSuffix: "4821",
      openingBalance: "18350.75",
      openingBalanceDate: "2026-08-01",
      active: true,
      accent: "#a7b1ff",
      notes: "Primary salary and everyday spending account.",
    },
    {
      id: a.savings,
      userId,
      name: "Crescent Reserve",
      institution: "Crescent Bank",
      kind: "bank",
      maskedSuffix: "7094",
      openingBalance: "42000.00",
      openingBalanceDate: "2026-08-01",
      active: true,
      accent: "#7dd3b5",
      notes: "Emergency fund. Kept separate from everyday spending.",
    },
    {
      id: a.platinum,
      userId,
      name: "Aster Platinum",
      institution: "Aster Bank",
      kind: "credit_card",
      maskedSuffix: "2108",
      creditLimit: "150000.00",
      openingBalance: "15780.00",
      openingBalanceDate: "2026-08-01",
      active: true,
      accent: "#aeb5fa",
    },
    {
      id: a.rewards,
      userId,
      name: "Grove Rewards",
      institution: "Grove Bank",
      kind: "credit_card",
      maskedSuffix: "6529",
      creditLimit: "60000.00",
      openingBalance: "4200.00",
      openingBalanceDate: "2026-08-01",
      active: true,
      accent: "#b0c7b3",
    },
    {
      id: a.secured,
      userId,
      name: "Harbor Secured",
      institution: "Harbor Bank",
      kind: "credit_card",
      maskedSuffix: "8836",
      creditLimit: "18000.00",
      openingBalance: "1600.00",
      openingBalanceDate: "2026-08-01",
      active: true,
      accent: "#c9b7ed",
      notes:
        "Secured by a pledged fixed deposit. Deposit is not spendable cash.",
    },
    {
      id: a.payLater,
      userId,
      name: "Luma Pay Later",
      institution: "Luma",
      kind: "pay_later",
      maskedSuffix: "3102",
      creditLimit: "25000.00",
      openingBalance: "2670.00",
      openingBalanceDate: "2026-08-01",
      active: true,
      accent: "#e7c28b",
    },
    {
      id: a.wallet,
      userId,
      name: "Pocket Wallet",
      institution: "Pocket",
      kind: "wallet",
      maskedSuffix: "9017",
      openingBalance: "2000.00",
      openingBalanceDate: "2026-08-01",
      active: true,
      accent: "#8bc4d9",
    },
  ];
  const data: WorkspaceData = {
    accounts,
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
  let transactionId = 1000;
  function transaction(
    values: Omit<Transaction, "id" | "userId" | "currency" | "status"> &
      Partial<Pick<Transaction, "status">>,
  ): Transaction {
    const record: Transaction = {
      id: id(transactionId++),
      userId,
      currency: "INR",
      status: "posted",
      sourceSystem: "synthetic_demo",
      createdAt: "2026-10-09T08:30:00Z",
      ...values,
    };
    data.transactions.push(record);
    return record;
  }
  const expenseTemplates = [
    {
      day: "01",
      description: "October apartment rent",
      merchant: "Maple Residences",
      category: "Housing",
      amount: "18500.00",
      account: a.bank,
    },
    {
      day: "02",
      description: "Weekly groceries",
      merchant: "Greenbasket",
      category: "Groceries",
      amount: "1740.80",
      account: a.platinum,
    },
    {
      day: "02",
      description: "Coffee and breakfast",
      merchant: "Sunday Coffee",
      category: "Food",
      amount: "285.00",
      account: a.bank,
    },
    {
      day: "03",
      description: "Internet subscription",
      merchant: "Cloudline Fibre",
      category: "Utilities",
      amount: "899.00",
      account: a.bank,
    },
    {
      day: "03",
      description: "A book for the weekend",
      merchant: "Papertrail Books",
      category: "Education",
      amount: "640.00",
      account: a.wallet,
    },
    {
      day: "04",
      description: "Team lunch",
      merchant: "Juniper Kitchen",
      category: "Food",
      amount: "1680.00",
      account: a.platinum,
    },
    {
      day: "04",
      description: "Metro travel pass",
      merchant: "City Metro",
      category: "Transport",
      amount: "600.00",
      account: a.bank,
    },
    {
      day: "05",
      description: "Streaming subscription",
      merchant: "Frame Plus",
      category: "Subscriptions",
      amount: "349.00",
      account: a.rewards,
    },
    {
      day: "05",
      description: "Desk lamp",
      merchant: "Hearth & Home",
      category: "Shopping",
      amount: "1290.00",
      account: a.payLater,
    },
    {
      day: "06",
      description: "Fresh produce",
      merchant: "The Farmers Market",
      category: "Groceries",
      amount: "720.25",
      account: a.bank,
    },
    {
      day: "06",
      description: "Dinner with friends",
      merchant: "Wildflower Table",
      category: "Food",
      amount: "1260.00",
      account: a.platinum,
    },
    {
      day: "07",
      description: "Cab ride home",
      merchant: "Orbit Rides",
      category: "Transport",
      amount: "235.50",
      account: a.bank,
    },
    {
      day: "07",
      description: "Running essentials",
      merchant: "Stride Studio",
      category: "Health",
      amount: "1890.00",
      account: a.rewards,
    },
    {
      day: "08",
      description: "Design software",
      merchant: "Canvas Tools",
      category: "Subscriptions",
      amount: "799.00",
      account: a.platinum,
    },
    {
      day: "08",
      description: "Weekend cinema",
      merchant: "Silver Screen",
      category: "Entertainment",
      amount: "680.00",
      account: a.secured,
    },
    {
      day: "08",
      description: "Lunch at the office",
      merchant: "Little Leaf",
      category: "Food",
      amount: "210.00",
      account: a.bank,
    },
    {
      day: "09",
      description: "Train ticket for a friend",
      merchant: "Northline Rail",
      category: "Travel",
      amount: "1849.60",
      account: a.bank,
    },
    {
      day: "09",
      description: "Notebook and pens",
      merchant: "Papertrail Books",
      category: "Education",
      amount: "325.00",
      account: a.bank,
    },
  ];
  for (const [month, extra] of [
    ["2026-08", "210.00"],
    ["2026-09", "85.00"],
    ["2026-10", "0.00"],
  ] as const) {
    transaction({
      occurredOn: `${month}-01`,
      amount: "62000.00",
      kind: "income",
      description: "Monthly salary",
      merchant: "Arc Studio",
      fromAccountId: null,
      toAccountId: a.bank,
      category: "Salary",
    });
    for (const template of expenseTemplates) {
      transaction({
        occurredOn: `${month}-${template.day}`,
        amount: addMoney(
          template.amount,
          template.category === "Shopping" ? extra : "0.00",
        ),
        kind: "expense",
        description: template.description.replace(
          "October",
          month === "2026-08"
            ? "August"
            : month === "2026-09"
              ? "September"
              : "October",
        ),
        merchant: template.merchant,
        category: template.category,
        fromAccountId: template.account,
        toAccountId: null,
      });
    }
    transaction({
      occurredOn: `${month}-03`,
      amount: "1000.00",
      kind: "transfer",
      description: "Wallet top-up",
      fromAccountId: a.bank,
      toAccountId: a.wallet,
      notes: "Transfer only; purchases are counted separately.",
    });
  }
  const cardPayment = transaction({
    occurredOn: "2026-10-04",
    amount: "10000.00",
    kind: "bill_payment",
    description: "Aster statement repayment",
    fromAccountId: a.bank,
    toAccountId: a.platinum,
    externalReference: "DEMO-ASTER-1004",
  });
  const provisionalPayment = transaction({
    occurredOn: "2026-10-08",
    amount: "1500.00",
    kind: "bill_payment",
    description: "Grove repayment awaiting statement match",
    fromAccountId: a.bank,
    toAccountId: a.rewards,
    notes: "Bank debit confirmed; card-side allocation remains provisional.",
  });
  const laterPayment = transaction({
    occurredOn: "2026-10-05",
    amount: "1250.00",
    kind: "bill_payment",
    description: "Luma partial repayment",
    fromAccountId: a.bank,
    toAccountId: a.payLater,
  });
  const loanDisbursal = transaction({
    occurredOn: "2026-08-13",
    amount: "44000.00",
    kind: "transfer",
    description: "Willow Finance loan disbursement",
    externalPayer: "Willow Finance",
    fromAccountId: null,
    toAccountId: a.bank,
    notes:
      "Loan liability, not income. Contractual principal is tracked separately.",
  });
  const priorEmi = transaction({
    occurredOn: "2026-09-10",
    amount: "9800.00",
    kind: "bill_payment",
    description: "Willow Finance installment 1",
    fromAccountId: a.bank,
    toAccountId: null,
    externalReference: "DEMO-WILLOW-0910",
  });
  const partialEmi = transaction({
    occurredOn: "2026-10-08",
    amount: "2500.00",
    kind: "bill_payment",
    description: "Willow Finance partial installment 2",
    fromAccountId: a.bank,
    toAccountId: null,
    externalReference: "DEMO-WILLOW-1008",
  });
  const returnedTransfer = transaction({
    occurredOn: "2026-10-02",
    amount: "750.00",
    kind: "transfer",
    description: "Returned deposit transfer",
    fromAccountId: a.bank,
    toAccountId: null,
  });
  transaction({
    occurredOn: "2026-10-07",
    amount: "750.00",
    kind: "refund",
    description: "Return of deposit transfer",
    fromAccountId: null,
    toAccountId: a.bank,
    refundOfTransactionId: returnedTransfer.id,
    notes: "Returned transfer; excluded from spend refunds and income.",
  });
  const ticket = data.transactions.find(
    (t) =>
      t.description === "Train ticket for a friend" &&
      t.occurredOn === "2026-10-09",
  )!;
  transaction({
    occurredOn: "2026-10-09",
    amount: "1850.00",
    kind: "refund",
    description: "Avery reimbursed the train ticket",
    fromAccountId: null,
    toAccountId: a.bank,
    externalPayer: "Avery",
    refundOfTransactionId: ticket.id,
    notes:
      "Purchase was ₹1,849.60. The ₹0.40 difference is preserved for review.",
  });
  const incoming = transaction({
    occurredOn: "2026-10-06",
    amount: "840.00",
    kind: "transfer",
    description: "Rowan's dinner contribution",
    externalPayer: "Rowan",
    fromAccountId: null,
    toAccountId: a.bank,
  });
  const incoming2 = transaction({
    occurredOn: "2026-10-07",
    amount: "420.00",
    kind: "transfer",
    description: "Sage's partial dinner contribution",
    externalPayer: "Sage",
    fromAccountId: null,
    toAccountId: a.bank,
  });
  transaction({
    occurredOn: null,
    amount: "749.00",
    kind: "expense",
    status: "pending_review",
    description: "Mobile plan — purchase date needed",
    merchant: "Daylight Mobile",
    category: "Utilities",
    fromAccountId: a.bank,
    toAccountId: null,
    notes: "Supply the purchase date before including this in monthly totals.",
  });
  transaction({
    occurredOn: "2026-10-08",
    amount: "1395.00",
    kind: "expense",
    status: "pending_review",
    description: "Friend-paid wellness order",
    merchant: "Stillwater Wellness",
    category: "Health",
    fromAccountId: null,
    toAccountId: null,
    externalPayer: "Avery",
    notes:
      "Confirm the purchase and whether reimbursement is owed. No debt is automatically created.",
  });
  transaction({
    occurredOn: "2026-10-09",
    amount: "499.00",
    kind: "expense",
    status: "pending_review",
    description: "Possible duplicate subscription",
    merchant: "Focus Notes",
    category: "Subscriptions",
    fromAccountId: a.rewards,
    toAccountId: null,
    notes: "Statement import requires duplicate review.",
  });

  data.bills = [
    {
      id: id(201),
      userId,
      accountId: a.platinum,
      statementAmount: "18800.00",
      statementDate: "2026-09-28",
      dueDate: "2026-10-19",
      periodStart: "2026-08-29",
      periodEnd: "2026-09-28",
      minimumDue: "940.00",
      statementCredits: "0.00",
    },
    {
      id: id(202),
      userId,
      accountId: a.rewards,
      statementAmount: "7200.00",
      statementDate: "2026-10-01",
      dueDate: "2026-10-22",
      periodStart: "2026-09-02",
      periodEnd: "2026-10-01",
      minimumDue: "360.00",
      statementCredits: "0.00",
    },
    {
      id: id(203),
      userId,
      accountId: a.payLater,
      statementAmount: "3250.00",
      statementDate: "2026-10-01",
      dueDate: "2026-10-15",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      minimumDue: null,
      statementCredits: "0.00",
    },
  ];
  data.allocations = [
    {
      id: id(301),
      userId,
      billId: id(201),
      transactionId: cardPayment.id,
      amount: "10000.00",
      verified: true,
      createdAt: "2026-10-04T12:00:00Z",
    },
    {
      id: id(302),
      userId,
      billId: id(202),
      transactionId: provisionalPayment.id,
      amount: "1500.00",
      verified: false,
      createdAt: "2026-10-08T12:00:00Z",
    },
    {
      id: id(303),
      userId,
      billId: id(203),
      transactionId: laterPayment.id,
      amount: "1250.00",
      verified: true,
      createdAt: "2026-10-05T12:00:00Z",
    },
  ];
  data.fixedDeposits = [
    {
      id: id(401),
      userId,
      name: "Harbor security deposit",
      institution: "Harbor Bank",
      maskedSuffix: "5462",
      principal: "20000.00",
      openingDate: "2026-06-18",
      maturityDate: "2027-06-18",
      maturityAmount: "21420.00",
      annualRate: "7.10",
      payoutMethod: "At maturity",
      maturityInstruction: "reinvest",
      pledged: true,
      backingAccountId: a.secured,
      payoutAccountId: a.bank,
      notes:
        "Lien against Harbor Secured. Not included in spendable bank balance.",
    },
    {
      id: id(402),
      userId,
      name: "The rainy day fund",
      institution: "Crescent Bank",
      maskedSuffix: "1275",
      principal: "50000.00",
      openingDate: "2026-05-01",
      maturityDate: "2027-05-01",
      maturityAmount: "53400.00",
      annualRate: "6.80",
      payoutMethod: "At maturity",
      maturityInstruction: "withdraw",
      pledged: false,
      backingAccountId: null,
      payoutAccountId: a.savings,
    },
    {
      id: id(403),
      userId,
      name: "Future plans",
      institution: "Meridian Bank",
      maskedSuffix: "9381",
      principal: "30000.00",
      openingDate: "2026-07-24",
      maturityDate: "2027-01-24",
      maturityAmount: "31020.00",
      annualRate: "6.75",
      payoutMethod: "At maturity",
      maturityInstruction: "unconfirmed",
      pledged: false,
      backingAccountId: null,
      payoutAccountId: a.bank,
    },
  ];
  data.loans = [
    {
      id: id(501),
      userId,
      name: "Personal loan",
      lender: "Willow Finance",
      kind: "institutional",
      contractualPrincipal: "45000.00",
      netDisbursed: "44000.00",
      reportedOutstanding: "36000.00",
      reportedAsOf: "2026-10-07",
      annualRate: null,
      scheduledTotal: "49000.00",
      repaymentAccountId: a.bank,
      disbursedOn: loanDisbursal.occurredOn,
      notes:
        "Lender-reported outstanding. No principal/interest split supplied.",
    },
    {
      id: id(502),
      userId,
      name: "Weekend trip advance",
      lender: "Avery",
      kind: "lent",
      contractualPrincipal: "3500.00",
      netDisbursed: "3500.00",
      reportedOutstanding: "3500.00",
      reportedAsOf: "2026-10-08",
      annualRate: null,
      scheduledTotal: null,
      repaymentAccountId: a.bank,
      disbursedOn: "2026-09-27",
      notes: "Personal receivable. Repayment date has not been confirmed.",
    },
  ];
  data.emis = [
    "2026-09-10",
    "2026-10-10",
    "2026-11-10",
    "2026-12-10",
    "2027-01-10",
  ].map((dueDate, index) => ({
    id: id(601 + index),
    userId,
    loanId: id(501),
    number: index + 1,
    dueDate,
    amount: "9800.00",
    principalPortion: null,
    interestPortion: null,
  }));
  data.emiAllocations = [
    {
      id: id(701),
      userId,
      emiId: id(601),
      transactionId: priorEmi.id,
      amount: "9800.00",
    },
    {
      id: id(702),
      userId,
      emiId: id(602),
      transactionId: partialEmi.id,
      amount: "2500.00",
    },
  ];
  const groupPurchase = transaction({
    occurredOn: "2026-10-06",
    amount: "2520.00",
    kind: "expense",
    description: "Friday dinner with Rowan and Sage",
    merchant: "Juniper Kitchen",
    category: "Food",
    fromAccountId: a.bank,
    toAccountId: null,
  });
  data.groups = [
    {
      id: id(801),
      userId,
      title: "Friday dinner",
      occurredOn: "2026-10-06",
      merchant: "Juniper Kitchen",
      totalCost: "2520.00",
      paidBy: "You",
      transactionId: groupPurchase.id,
      notes: "Three equal shares; Sage has settled half of their share.",
    },
  ];
  data.shares = [
    {
      id: id(811),
      userId,
      groupId: id(801),
      participant: "You",
      amount: "840.00",
      isOwner: true,
    },
    {
      id: id(812),
      userId,
      groupId: id(801),
      participant: "Rowan",
      amount: "840.00",
      isOwner: false,
    },
    {
      id: id(813),
      userId,
      groupId: id(801),
      participant: "Sage",
      amount: "840.00",
      isOwner: false,
    },
  ];
  data.settlements = [
    {
      id: id(821),
      userId,
      groupId: id(801),
      transactionId: incoming.id,
      counterparty: "Rowan",
      direction: "incoming",
      amount: "840.00",
    },
    {
      id: id(822),
      userId,
      groupId: id(801),
      transactionId: incoming2.id,
      counterparty: "Sage",
      direction: "incoming",
      amount: "420.00",
    },
  ];
  data.reminders = [
    {
      id: id(901),
      userId,
      title: "Willow installment due tomorrow",
      emiId: id(602),
      billId: null,
      triggerAt: "2026-10-09T03:30:00Z",
      channel: "in_app",
      enabled: true,
      state: "scheduled",
    },
    {
      id: id(902),
      userId,
      title: "Luma statement due in 3 days",
      billId: id(203),
      emiId: null,
      triggerAt: "2026-10-12T03:30:00Z",
      channel: "in_app",
      enabled: true,
      state: "scheduled",
    },
    {
      id: id(903),
      userId,
      title: "Aster statement reminder",
      billId: id(201),
      emiId: null,
      triggerAt: "2026-10-16T03:30:00Z",
      channel: "email",
      enabled: false,
      state: "scheduled",
    },
  ];
  data.auditEvents = [
    {
      id: id(951),
      userId,
      entityType: "bill",
      entityId: id(201),
      action: "payment_allocated",
      description: "Confirmed ₹10,000 repayment against the Aster statement.",
      occurredAt: "2026-10-04T12:00:00Z",
    },
    {
      id: id(952),
      userId,
      entityType: "transaction",
      entityId: provisionalPayment.id,
      action: "allocation_provisional",
      description: "Grove repayment awaits receiving statement confirmation.",
      occurredAt: "2026-10-08T12:00:00Z",
    },
    {
      id: id(953),
      userId,
      entityType: "workspace",
      entityId: DEMO_USER_ID,
      action: "demo_loaded",
      description:
        "Fictional demonstration workspace loaded. No bank connection or personal data.",
      occurredAt: "2026-10-09T08:30:00Z",
    },
  ];
  data.snapshots = accounts.map((account, index) => {
    const calculated = ledgerBalance(data, account.id, DEMO_TODAY)!;
    const debt = account.kind === "credit_card" || account.kind === "pay_later";
    // One intentional discrepancy demonstrates reconciliation without hiding it.
    const reported =
      account.id === a.bank ? addMoney(calculated, "125.00") : calculated;
    return {
      id: id(11001 + index),
      userId,
      accountId: account.id,
      asOf: "2026-10-09T08:00:00Z",
      reportedBalance: debt ? null : reported,
      reportedOutstanding: debt ? reported : null,
      reportedUtilized: debt ? reported : null,
      reportedAvailable:
        debt && account.creditLimit
          ? subtractMoney(account.creditLimit, reported)
          : null,
      reportedUnbilled: account.id === a.platinum ? "1890.00" : null,
      nextStatementDate:
        account.id === a.platinum ? "2026-10-28" : debt ? "2026-11-01" : null,
      source: "user_report" as const,
      verifiedByUser: true,
    };
  });
  return data;
}
export const cloneDemoData = (): WorkspaceData => createDemoData();
