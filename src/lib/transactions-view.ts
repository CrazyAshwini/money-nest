import {
  getHistoryPlatformSuggestions,
  isOtherHistoryPlatform,
  normalizeTransactionFilter,
  transactionCategoryLabel,
} from "./category-platforms";
import { ownedAnalyticsData } from "./analytics-presentation";
import { formatDate, monthLabel, monthlySummary, sumMoney } from "./finance";
import {
  CATEGORIES,
  TRANSACTION_KINDS,
  type Money,
  type Transaction,
  type TransactionKind,
  type WorkspaceData,
} from "./types";

export interface TransactionViewFilters {
  period: "month" | "all" | "date";
  month: string;
  date: string;
  kind: "all" | TransactionKind;
  category: string;
  platform: string;
  query: string;
  account: string;
  /** Preserve an unsupported explicit status as an empty-result restriction. */
  status: string;
  sort: "newest" | "oldest";
  invalidPeriod: boolean;
}

const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** URL state has one deterministic interpretation, including existing drilldowns. */
export function parseTransactionFilters(
  params: { get(name: string): string | null },
  today: string,
): TransactionViewFilters {
  const date = params.get("date") ?? "";
  const explicitMonth = params.get("month") ?? "";
  const month =
    explicitMonth ||
    (date && validDate(date) ? date.slice(0, 7) : today.slice(0, 7));
  const kind = params.get("kind");
  const category = params.get("category")?.trim() ?? "";
  const platform = params.get("platform")?.trim() ?? "";
  const status = params.get("status") ?? "";
  return {
    period: date
      ? "date"
      : explicitMonth
        ? "month"
        : params.get("period") === "all"
          ? "all"
          : "month",
    month,
    date,
    kind: TRANSACTION_KINDS.includes(kind as TransactionKind)
      ? (kind as TransactionKind)
      : "all",
    category: category ? transactionCategoryLabel(category) : "",
    platform: category
      ? ["other", "others"].includes(normalizeTransactionFilter(platform))
        ? "Others"
        : (getHistoryPlatformSuggestions(category).find(
            (suggestion) =>
              normalizeTransactionFilter(suggestion) ===
              normalizeTransactionFilter(platform),
          ) ?? platform)
      : "",
    query: params.get("q") ?? "",
    account:
      params.get("account") === "all" ? "" : (params.get("account") ?? ""),
    status,
    sort: params.get("sort") === "oldest" ? "oldest" : "newest",
    invalidPeriod: date
      ? !validDate(date)
      : explicitMonth
        ? !validMonth(explicitMonth)
        : !validMonth(month),
  };
}

/** Produces one value per supported key; no router effects or saved-record writes. */
export function serializeTransactionFilters(
  filters: TransactionViewFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.period === "date") {
    params.set("date", filters.date);
    params.set("period", "all");
  } else if (filters.period === "all") {
    params.set("period", "all");
  } else {
    params.set("month", filters.month);
    params.set("period", "month");
  }
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.category) params.set("category", filters.category);
  if (filters.category && filters.platform)
    params.set("platform", filters.platform);
  if (filters.query) params.set("q", filters.query);
  if (filters.account) params.set("account", filters.account);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort === "oldest") params.set("sort", "oldest");
  return params;
}

/** Only the model's transfer and repayment classifications are transfer activity. */
export function isTransferActivity(transaction: Transaction): boolean {
  return transaction.kind === "transfer" || transaction.kind === "bill_payment";
}

export interface TransactionActivitySummary {
  expenses: Money;
  income: Money;
  transfers: Money;
  expenseCount: number;
  incomeCount: number;
  transferCount: number;
  postedCount: number;
  pendingCount: number;
  voidedCount: number;
  undatedPostedCount: number;
  count: number;
}

function distinctLabels(values: Iterable<string>): string[] {
  const labels = new Map<string, string>();
  for (const value of values) {
    const label = value.trim().replace(/\s+/g, " ");
    const normalized = normalizeTransactionFilter(label);
    if (normalized && !labels.has(normalized)) labels.set(normalized, label);
  }
  return [...labels.values()];
}

/**
 * Read-only view over the authenticated owner's records. Gross spending and income
 * retain monthlySummary's posted/date semantics; refunds stay separate activity.
 */
export function getTransactionView(
  data: WorkspaceData,
  userId: string,
  filters: TransactionViewFilters,
  today?: string,
) {
  const owned = ownedAnalyticsData(data, userId);
  const categoryEnabled = !["income", "transfer", "bill_payment"].includes(
    filters.kind,
  );
  const selectedCategory = normalizeTransactionFilter(
    transactionCategoryLabel(filters.category),
  );
  const categoryMatches = (transaction: Transaction) =>
    normalizeTransactionFilter(
      transactionCategoryLabel(transaction.category),
    ) === selectedCategory;
  const normalizedPlatform = normalizeTransactionFilter(filters.platform);
  const query = normalizeTransactionFilter(filters.query);
  const accounts = new Map(
    owned.accounts.map((account) => [account.id, account]),
  );
  const transactions = owned.transactions
    .filter((transaction) => {
      if (filters.invalidPeriod) return false;
      if (filters.period === "date" && transaction.occurredOn !== filters.date)
        return false;
      if (
        filters.period === "month" &&
        !transaction.occurredOn?.startsWith(`${filters.month}-`)
      )
        return false;
      if (
        filters.kind !== "all" &&
        !(filters.kind === "transfer"
          ? isTransferActivity(transaction)
          : transaction.kind === filters.kind)
      )
        return false;
      if (filters.status && transaction.status !== filters.status) return false;
      if (
        filters.account &&
        transaction.fromAccountId !== filters.account &&
        transaction.toAccountId !== filters.account
      )
        return false;
      if (categoryEnabled && filters.category && !categoryMatches(transaction))
        return false;
      if (
        categoryEnabled &&
        filters.category &&
        filters.platform &&
        (normalizedPlatform === "others"
          ? !isOtherHistoryPlatform(filters.category, transaction.platform)
          : normalizeTransactionFilter(transaction.platform) !==
            normalizedPlatform)
      )
        return false;
      if (query) {
        const linkedAccounts = [
          transaction.fromAccountId,
          transaction.toAccountId,
        ].flatMap((id) => {
          const account = id ? accounts.get(id) : undefined;
          return account ? [account.name, account.institution] : [];
        });
        const searchable = [
          transaction.description,
          transaction.merchant,
          transaction.platform,
          transaction.category,
          transaction.subcategory,
          transaction.notes,
          transaction.externalReference,
          transaction.externalPayer,
          transaction.sourceSystem,
          transaction.sourceObjectId,
          transaction.receiptDocumentId,
          transaction.kind,
          transaction.status,
          ...linkedAccounts,
        ]
          .filter(Boolean)
          .join(" ");
        if (!normalizeTransactionFilter(searchable).includes(query))
          return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Unconfirmed dates stay last in either order, with stable ID ties.
      if (!a.occurredOn && b.occurredOn) return 1;
      if (a.occurredOn && !b.occurredOn) return -1;
      const dateOrder = (a.occurredOn ?? "").localeCompare(b.occurredOn ?? "");
      return (
        (filters.sort === "oldest" ? dateOrder : -dateOrder) ||
        a.id.localeCompare(b.id)
      );
    });

  const datedPosted = transactions.filter(
    (transaction) =>
      transaction.status === "posted" &&
      transaction.occurredOn &&
      validDate(transaction.occurredOn),
  );
  // Gross and income need no refund reconciliation: keep the canonical selector,
  // but avoid traversing unrelated refunds for every search or period change.
  const filteredData = {
    ...owned,
    transactions: datedPosted.filter(
      (transaction) =>
        transaction.kind === "expense" || transaction.kind === "income",
    ),
  };
  const summaries = [
    ...new Set(
      datedPosted.map((transaction) => transaction.occurredOn!.slice(0, 7)),
    ),
  ].map((month) => monthlySummary(filteredData, month));
  const transferRows = datedPosted.filter(isTransferActivity);
  const summary: TransactionActivitySummary = {
    expenses: sumMoney(summaries.map((row) => row.gross)),
    income: sumMoney(summaries.map((row) => row.income)),
    transfers: sumMoney(transferRows.map((row) => row.amount)),
    expenseCount: summaries.reduce((total, row) => total + row.expenseCount, 0),
    incomeCount: datedPosted.filter(
      (transaction) => transaction.kind === "income",
    ).length,
    transferCount: transferRows.length,
    postedCount: transactions.filter(
      (transaction) => transaction.status === "posted",
    ).length,
    pendingCount: transactions.filter(
      (transaction) => transaction.status === "pending_review",
    ).length,
    voidedCount: transactions.filter(
      (transaction) => transaction.status === "voided",
    ).length,
    undatedPostedCount: transactions.filter(
      (transaction) =>
        transaction.status === "posted" &&
        (!transaction.occurredOn || !validDate(transaction.occurredOn)),
    ).length,
    count: transactions.length,
  };

  const approvedCategories = [
    "Food",
    "Shopping",
    "Groceries",
    "Transport",
    "Stationery Items",
    "Utilities",
    "Health",
    "Others",
  ];
  const categoryOptions = distinctLabels([
    ...approvedCategories,
    ...CATEGORIES.map(transactionCategoryLabel),
    ...owned.transactions.map((transaction) =>
      transactionCategoryLabel(transaction.category),
    ),
    ...(filters.category ? [filters.category] : []),
  ]).map((label) =>
    filters.category && normalizeTransactionFilter(label) === selectedCategory
      ? filters.category
      : label,
  );
  const suggestions = filters.category
    ? getHistoryPlatformSuggestions(filters.category)
    : [];
  const platformOptions = filters.category
    ? [
        ...distinctLabels([
          ...suggestions,
          ...owned.transactions
            .filter(categoryMatches)
            .map((transaction) => transaction.platform ?? ""),
          ...(filters.platform ? [filters.platform] : []),
        ])
          .filter(
            (platform) =>
              !["other", "others"].includes(
                normalizeTransactionFilter(platform),
              ),
          )
          .map((label) =>
            normalizedPlatform &&
            normalizeTransactionFilter(label) === normalizedPlatform
              ? filters.platform
              : label,
          ),
        "Others",
      ]
    : [];
  const currentMonth = today?.slice(0, 7) ?? filters.month;
  const recentMonths = validMonth(currentMonth)
    ? Array.from({ length: 12 }, (_, index) => {
        const date = new Date(`${currentMonth}-01T00:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() - index);
        return date.toISOString().slice(0, 7);
      })
    : [];
  const monthOptions = [
    ...new Set(
      [
        ...recentMonths,
        filters.month,
        ...owned.transactions.flatMap((transaction) =>
          transaction.occurredOn && validDate(transaction.occurredOn)
            ? [transaction.occurredOn.slice(0, 7)]
            : [],
        ),
      ].filter(validMonth),
    ),
  ].sort((a, b) => b.localeCompare(a));
  const periodLabel = filters.invalidPeriod
    ? `Unavailable ${filters.period === "date" ? "date" : "month"}`
    : filters.period === "date"
      ? formatDate(filters.date, { year: "numeric" })
      : filters.period === "all"
        ? "All dates"
        : monthLabel(filters.month);
  return {
    transactions,
    summary,
    categoryOptions,
    platformOptions,
    monthOptions,
    periodLabel,
  };
}
