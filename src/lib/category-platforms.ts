import type { Category } from "./types";

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
