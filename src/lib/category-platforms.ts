import { CATEGORIES, type Category, type TransactionKind } from "./types";

export const OTHER_PLATFORM = "Other";

export const EXPENSE_CATALOG_CATEGORIES: readonly string[] = [
  "Food",
  "Shopping",
  "Transport",
  "Bills & Utilities",
  "Stationery & Education",
  "Health & Personal Care",
  "Entertainment",
  "Gifts",
  "Others",
];

export const INCOME_CATALOG_CATEGORIES: readonly string[] = [
  "Salary / Fellowship",
  "Gift Received",
  "Interest & Rewards",
  "Other Income",
];

export const BILL_REPAYMENT_CATALOG_CATEGORIES: readonly string[] = [
  "Credit Card",
  "Pay Later",
  "Loan EMI",
];

export const TRANSFER_CATALOG_CATEGORIES: readonly string[] = [
  "Own Accounts",
  "Wallet / Cash",
  "Savings & Investments",
];

export const REFUND_CATALOG_CATEGORIES: readonly string[] = [
  "Purchase Refund",
  "Shared Expense / Paid-for-Others Repayment",
  "Other Refund",
];

export const ADJUSTMENT_CATALOG_CATEGORIES: readonly string[] = [
  "Balance Correction",
  "Reconciliation Adjustment",
  "Other Adjustment",
];

export const TRANSACTION_TYPE_CATEGORIES: Readonly<
  Record<TransactionKind, readonly string[]>
> = {
  expense: EXPENSE_CATALOG_CATEGORIES,
  income: INCOME_CATALOG_CATEGORIES,
  bill_payment: BILL_REPAYMENT_CATALOG_CATEGORIES,
  transfer: TRANSFER_CATALOG_CATEGORIES,
  refund: REFUND_CATALOG_CATEGORIES,
  adjustment: ADJUSTMENT_CATALOG_CATEGORIES,
};

export const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  // Simplified -> Canonical / Legacy
  Food: "Food & Drinks",
  "Bills & Utilities": "Utilities",
  "Stationery & Education": "Education",
  "Health & Personal Care": "Health",
  Gifts: "Gift Given",
  Others: "Other",
  "Credit Card": "Credit Card Payment",
  "Pay Later": "Pay Later Payment",
  "Own Accounts": "Own Account Transfer",
  "Wallet / Cash": "Wallet Top-up",
  "Savings & Investments": "Savings / Investment",
  "Shared Expense / Paid-for-Others Repayment": "Split Bill Reimbursement",
  "Other Refund": "Other Money Back",

  // Canonical / Legacy -> Simplified
  "Food & Drinks": "Food",
  Utilities: "Bills & Utilities",
  Education: "Stationery & Education",
  Stationery: "Stationery & Education",
  Health: "Health & Personal Care",
  "Personal Care": "Health & Personal Care",
  "Gift Given": "Gifts",
  Other: "Others",
  "Credit Card Payment": "Credit Card",
  "Pay Later Payment": "Pay Later",
  "Own Account Transfer": "Own Accounts",
  "Wallet Top-up": "Wallet / Cash",
  "Savings / Investment": "Savings & Investments",
  "Cash Withdrawal / Deposit": "Own Accounts",
  "Split Bill Reimbursement": "Shared Expense / Paid-for-Others Repayment",
  "Overpayment Refund": "Other Refund",
  "Other Money Back": "Other Refund",
  "Business / Freelance": "Other Income",
  "Interest / Rewards": "Interest & Rewards",
  "Investment Income": "Other Income",
};

export const EXPENSE_SUBCATEGORIES: Readonly<Record<string, readonly string[]>> =
  {
    "Food & Drinks": ["Groceries", "Restaurant", "Snacks"],
    Food: ["Groceries", "Restaurant", "Snacks"],
    Shopping: ["Clothing", "Electronics", "Household"],
    Transport: ["Auto/Cab", "Bus/Train", "Fuel"],
    Utilities: ["Electricity", "Mobile Recharge", "Internet", "Water"],
    "Bills & Utilities": ["Electricity", "Mobile Recharge", "Internet", "Water"],
    Education: ["Books", "Stationery", "Courses"],
    "Stationery & Education": ["Books", "Stationery", "Courses"],
    Stationery: ["Books", "Stationery", "Courses"],
    Health: ["Medicines", "Consultation"],
    "Health & Personal Care": ["Medicines", "Consultation"],
    Entertainment: ["Movies", "Games", "Subscriptions"],
    Housing: ["Rent", "Maintenance"],
  };

/** Suggested sources for expense entry. These labels are stored as plain text. */
export const CATEGORY_PLATFORMS: Readonly<Record<string, readonly string[]>> =
  {
    "Food & Drinks": [
      "Swiggy",
      "Zomato",
      "Blinkit",
      "Zepto",
      "BigBasket",
      "Swiggy Instamart",
      "Domino's",
      "Local restaurant / store",
      OTHER_PLATFORM,
    ],
    Food: ["Swiggy", "Zomato", "Domino's", OTHER_PLATFORM],
    Groceries: [
      "Blinkit",
      "Zepto",
      "BigBasket",
      "Swiggy Instamart",
      "Local grocery store",
      OTHER_PLATFORM,
    ],
    Shopping: [
      "Amazon",
      "Flipkart",
      "Myntra",
      "Meesho",
      "Blinkit",
      "Swiggy Instamart",
      "Local store",
      OTHER_PLATFORM,
    ],
    Stationery: [
      "Local stationery shop",
      "Amazon",
      "Flipkart",
      "Classmate",
      OTHER_PLATFORM,
    ],
    "Stationery & Education": [
      "Local stationery shop",
      "Amazon",
      "Flipkart",
      "Classmate",
      "School / college",
      "Coaching",
      "Udemy",
      "Coursera",
      OTHER_PLATFORM,
    ],
    Transport: ["Uber", "Ola", "Rapido", "Public transport", OTHER_PLATFORM],
    Education: [
      "School / college",
      "Coaching",
      "Udemy",
      "Coursera",
      OTHER_PLATFORM,
    ],
    Housing: ["Rent", "Housing society", "Maintenance", OTHER_PLATFORM],
    Utilities: [
      "Electricity provider",
      "Water provider",
      "Jio",
      "Airtel",
      "Vi",
      OTHER_PLATFORM,
    ],
    "Bills & Utilities": [
      "Electricity provider",
      "Water provider",
      "Jio",
      "Airtel",
      "Vi",
      OTHER_PLATFORM,
    ],
    Subscriptions: [
      "Netflix",
      "YouTube Premium",
      "Spotify",
      "Amazon Prime",
      OTHER_PLATFORM,
    ],
    Health: [
      "Pharmacy",
      "Clinic / hospital",
      "Apollo Pharmacy",
      "Tata 1mg",
      "PharmEasy",
      OTHER_PLATFORM,
    ],
    "Health & Personal Care": [
      "Pharmacy",
      "Clinic / hospital",
      "Apollo Pharmacy",
      "Tata 1mg",
      "PharmEasy",
      "Nykaa",
      "Salon / Spa",
      "Local store",
      OTHER_PLATFORM,
    ],
    Travel: ["IRCTC", "MakeMyTrip", "Goibibo", "Airline", OTHER_PLATFORM],
    Entertainment: ["BookMyShow", "PVR INOX", "Gaming", OTHER_PLATFORM],
    "Gift Given": [
      "Amazon",
      "Flipkart",
      "Local store",
      "Gift shop",
      OTHER_PLATFORM,
    ],
    Gifts: [
      "Amazon",
      "Flipkart",
      "Local store",
      "Gift shop",
      OTHER_PLATFORM,
    ],
    "Gift Received": ["Personal gift", OTHER_PLATFORM],
    "Personal Care": [
      "Nykaa",
      "Amazon",
      "Local store",
      "Salon / Spa",
      "Pharmacy",
      OTHER_PLATFORM,
    ],
    Other: ["Local merchant", "Online purchase", OTHER_PLATFORM],
    Others: ["Local merchant", "Online purchase", OTHER_PLATFORM],
  };

/** Keep a saved or scanned merchant selectable, including after category changes. */
export function getCategoryPlatformOptions(
  category: string | null | undefined,
  currentPlatform?: string | null,
): string[] {
  const options =
    category &&
    Object.prototype.hasOwnProperty.call(CATEGORY_PLATFORMS, category)
      ? CATEGORY_PLATFORMS[category as Category]
      : category &&
          Object.prototype.hasOwnProperty.call(CATEGORY_ALIASES, category) &&
          Object.prototype.hasOwnProperty.call(
            CATEGORY_PLATFORMS,
            CATEGORY_ALIASES[category],
          )
        ? CATEGORY_PLATFORMS[CATEGORY_ALIASES[category] as Category]
        : CATEGORY_PLATFORMS.Other;
  if (!currentPlatform?.trim() || options.includes(currentPlatform)) {
    return [...options];
  }
  return [...options.slice(0, -1), currentPlatform, OTHER_PLATFORM];
}

/**
 * History suggestions are read-only filters, not entry defaults or migrations.
 * Keep the existing editor choices above intact, including legacy categories.
 */
const HISTORY_CATEGORY_PLATFORMS: Readonly<Record<string, readonly string[]>> =
  {
    "Food & Drinks": ["Swiggy", "Zomato", "Blinkit", "Instamart", "Domino's"],
    Food: ["Swiggy", "Zomato", "Blinkit", "Instamart", "Domino's"],
    Shopping: [
      "Amazon",
      "Flipkart",
      "Meesho",
      "Myntra",
      "Blinkit",
      "Swiggy Instamart",
      "Instamart",
    ],
    Groceries: ["Blinkit", "Zepto", "Instamart", "Swiggy"],
    Transport: ["Rapido", "Uber", "Ola", "IRCTC", "redBus"],
    "Stationery Items": [
      "Blinkit",
      "Instamart",
      "Flipkart",
      "Amazon",
      "Meesho",
    ],
    Utilities: ["Amazon Pay", "PhonePe", "Google Pay"],
    Health: ["Tata 1mg", "Apollo", "PharmEasy"],
    Others: [],
  };

export function normalizeTransactionFilter(
  value: string | null | undefined,
): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

/** Aliases affect filter labels only; saved category text is never rewritten. */
export function transactionCategoryLabel(
  value: string | null | undefined,
): string {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  const normalized = normalizeTransactionFilter(trimmed);
  if (!trimmed || ["other", "others"].includes(normalized)) return "Others";
  if (["stationery", "stationery items"].includes(normalized))
    return "Stationery Items";
  return (
    [...CATEGORIES, "Stationery Items"].find(
      (category) => normalizeTransactionFilter(category) === normalized,
    ) ?? trimmed
  );
}

export function getHistoryPlatformSuggestions(
  category: string,
): readonly string[] {
  const label = transactionCategoryLabel(category);
  const key = Object.keys(HISTORY_CATEGORY_PLATFORMS).find(
    (candidate) =>
      normalizeTransactionFilter(candidate) ===
      normalizeTransactionFilter(label),
  );
  if (key) return [...HISTORY_CATEGORY_PLATFORMS[key]];
  const legacy = Object.keys(CATEGORY_PLATFORMS).find(
    (candidate) =>
      normalizeTransactionFilter(candidate) ===
      normalizeTransactionFilter(label),
  );
  return legacy
    ? CATEGORY_PLATFORMS[legacy as Category].filter(
        (platform) => platform !== OTHER_PLATFORM,
      )
    : [];
}

export function isOtherHistoryPlatform(
  category: string,
  platform: string | null | undefined,
): boolean {
  const normalized = normalizeTransactionFilter(platform);
  return (
    !normalized ||
    !getHistoryPlatformSuggestions(category).some(
      (suggestion) => normalizeTransactionFilter(suggestion) === normalized,
    )
  );
}

export function transactionTypeLabel(kind: TransactionKind | string): string {
  switch (kind) {
    case "expense":
      return "Expense";
    case "income":
      return "Income";
    case "bill_payment":
      return "Bill Repayment";
    case "transfer":
      return "Transfer";
    case "refund":
      return "Refund / Money Back";
    case "adjustment":
      return "Adjustment";
    default:
      return kind.replaceAll("_", " ");
  }
}

export function getDefaultCategoryForKind(kind: TransactionKind): string {
  switch (kind) {
    case "expense":
      return "Food";
    case "income":
      return "Salary / Fellowship";
    case "bill_payment":
      return "Credit Card";
    case "transfer":
      return "Own Accounts";
    case "refund":
      return "Purchase Refund";
    case "adjustment":
      return "Balance Correction";
    default:
      return "Others";
  }
}

export function getCategoriesForKind(
  kind: TransactionKind,
  currentCategory?: string | null,
): string[] {
  const catalog =
    TRANSACTION_TYPE_CATEGORIES[kind] || TRANSACTION_TYPE_CATEGORIES.expense;
  const result = [...catalog];
  if (currentCategory && !result.includes(currentCategory)) {
    result.push(currentCategory);
  }
  return result;
}

export function getSubcategoriesForCategory(
  kind: TransactionKind,
  category: string | null | undefined,
): string[] {
  if (kind !== "expense" || !category) return [];
  if (Object.prototype.hasOwnProperty.call(EXPENSE_SUBCATEGORIES, category)) {
    return [...EXPENSE_SUBCATEGORIES[category]];
  }
  const normalized = normalizeTransactionFilter(category);
  const found = Object.keys(EXPENSE_SUBCATEGORIES).find(
    (key) => normalizeTransactionFilter(key) === normalized,
  );
  return found ? [...EXPENSE_SUBCATEGORIES[found]] : [];
}

export function isCategoryValidForKind(
  kind: TransactionKind,
  category: string | null | undefined,
): boolean {
  if (!category) return false;
  const allowed = getCategoriesForKind(kind);
  const normalized = normalizeTransactionFilter(category);
  const aliasTarget = CATEGORY_ALIASES[category];
  const normalizedAlias = aliasTarget ? normalizeTransactionFilter(aliasTarget) : null;
  return allowed.some((c) => {
    const norm = normalizeTransactionFilter(c);
    const aliasOfAllowed = CATEGORY_ALIASES[c] ? normalizeTransactionFilter(CATEGORY_ALIASES[c]) : null;
    return (
      norm === normalized ||
      (normalizedAlias !== null && norm === normalizedAlias) ||
      (aliasOfAllowed !== null && aliasOfAllowed === normalized)
    );
  });
}
