import { CATEGORIES, type Category } from "./types";

export const OTHER_PLATFORM = "Other";

/** Suggested sources for expense entry. These labels are stored as plain text. */
export const CATEGORY_PLATFORMS: Readonly<Record<Category, readonly string[]>> =
  {
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
    Travel: ["IRCTC", "MakeMyTrip", "Goibibo", "Airline", OTHER_PLATFORM],
    Entertainment: ["BookMyShow", "PVR INOX", "Gaming", OTHER_PLATFORM],
    Other: ["Local merchant", "Online purchase", OTHER_PLATFORM],
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
    Food: ["Swiggy", "Zomato", "Blinkit", "Instamart", "Domino's"],
    Shopping: [
      "Amazon",
      "Flipkart",
      "Meesho",
      "Myntra",
      "Blinkit",
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
