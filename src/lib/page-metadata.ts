export const APP_PAGE_METADATA = {
  dashboard: {
    title: "Overview",
    description:
      "See your account balances, monthly spending and upcoming payments in Money Nest.",
  },
  accounts: {
    title: "Accounts",
    description:
      "Manage your bank accounts, credit cards and wallets, and review balances and credit usage.",
  },
  transactions: {
    title: "Transactions",
    description:
      "Review income, spending and transfers, or add a transaction from a payment screenshot or receipt.",
  },
  bills: {
    title: "Bills & payments",
    description:
      "Track outstanding bills, payment due dates and payments linked to your financial records.",
  },
  "pay-later": {
    title: "Pay Later",
    description:
      "Review your Pay Later balances, available limits, credit usage and upcoming repayments.",
  },
  "fixed-deposits": {
    title: "Fixed deposits",
    description:
      "Track fixed deposit balances, interest, maturity dates and the accounts linked to your deposits.",
  },
  loans: {
    title: "Loans & EMIs",
    description:
      "Manage loans, outstanding balances, installment schedules and linked EMI payments.",
  },
  "emi-calendar": {
    title: "EMI calendar",
    description:
      "See scheduled loan installments and repayment dates together in your Money Nest EMI calendar.",
  },
  "split-bills": {
    title: "Split bills",
    description:
      "Track shared expenses, participant contributions and settlements linked to actual payments.",
  },
  imports: {
    title: "Statement imports",
    description:
      "Import financial statements, review extracted transactions and resolve duplicate records before saving.",
  },
  orders: {
    title: "Orders & refunds",
    description:
      "Scan order screenshots, review purchases and track pending refunds through confirmed incoming credits.",
  },
  analytics: {
    title: "Spending analytics",
    description:
      "Explore monthly spending, category totals and financial trends from your Money Nest records.",
  },
  notifications: {
    title: "Notifications",
    description:
      "Review upcoming payments, account notices and financial records that need your attention.",
  },
  settings: {
    title: "Settings",
    description:
      "Manage your workspace preferences, data exports and receipt scanning availability in Money Nest.",
  },
  profile: {
    title: "Your profile",
    description:
      "Review your Money Nest profile, update your display name and manage access to your private workspace.",
  },
  login: {
    title: "Sign in",
    description:
      "Sign in to your Money Nest workspace to manage accounts, transactions, bills and financial goals.",
  },
  "reset-password": {
    title: "Reset your cloud password",
    description: "Choose a new password for your Money Nest cloud account.",
  },
} as const;

export type AppPage = keyof typeof APP_PAGE_METADATA;

const detailPages: Partial<
  Record<AppPage, { title: string; description: string }>
> = {
  accounts: {
    title: "Account details",
    description:
      "Review an account's balance, credit usage and linked transactions in Money Nest.",
  },
  bills: {
    title: "Bill details",
    description:
      "Review a bill's outstanding amount, due date and linked payments in Money Nest.",
  },
  "fixed-deposits": {
    title: "Fixed deposit details",
    description:
      "Review a fixed deposit's principal, interest, maturity date and linked accounts.",
  },
  loans: {
    title: "Loan details",
    description:
      "Review a loan's outstanding balance, installment schedule and repayment history.",
  },
  "split-bills": {
    title: "Shared expense details",
    description:
      "Review a shared expense, participant shares and verified settlement payments.",
  },
};

const recordIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate the route shape without looking up any private workspace records. */
export function resolveAppPage(path: readonly string[] = []) {
  const name = path[0] ?? "dashboard";
  if (!Object.prototype.hasOwnProperty.call(APP_PAGE_METADATA, name))
    return null;
  const page = name as AppPage;
  if (path.length <= 1)
    return { page, ...APP_PAGE_METADATA[page], detail: false };
  if (path.length !== 2) return null;
  if (page === "transactions" && path[1] === "new")
    return {
      page,
      title: "Add transaction",
      description:
        "Add an income, expense or transfer to Money Nest, or upload a receipt to fill in the details for review.",
      detail: false,
    };
  if (page === "profile" && path[1] === "setup")
    return {
      page,
      title: "Set up your profile",
      description:
        "Create your private Money Nest profile and secure access to your finance workspace.",
      detail: false,
    };
  const detail = detailPages[page];
  if (!detail || !recordIdPattern.test(path[1])) return null;
  return { page, ...detail, detail: true };
}

export const NOT_FOUND_METADATA = {
  title: "Page not found",
  description:
    "This Money Nest page could not be found. Return to your overview or browse your accounts.",
} as const;
