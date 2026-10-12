import { describe, expect, it } from "vitest";
import {
  CATEGORY_PLATFORMS,
  getCategoryPlatformOptions,
  OTHER_PLATFORM,
} from "./category-platforms";
import { CATEGORIES } from "./types";
import { receiptExtractionSchema } from "./receipt-scan";

describe("expense category platform choices", () => {
  it("offers Stationery in the category list and receipt schema", () => {
    expect(CATEGORIES).toContain("Stationery");
    expect(
      receiptExtractionSchema.shape.category.safeParse("Stationery").success,
    ).toBe(true);
  });

  it("offers Food platforms and Other for every supported category", () => {
    expect(getCategoryPlatformOptions("Food")).toEqual([
      "Swiggy",
      "Zomato",
      "Domino's",
      "Other",
    ]);
    for (const category of CATEGORIES) {
      const options = getCategoryPlatformOptions(category);
      expect(options.length).toBeGreaterThan(1);
      expect(options.at(-1)).toBe(OTHER_PLATFORM);
      expect(new Set(options).size).toBe(options.length);
    }
  });

  it("keeps a saved or scanned merchant intact when choosing another category", () => {
    const customMerchant = "Synthetic receipt merchant";
    expect(getCategoryPlatformOptions("Food", customMerchant)).toContain(
      customMerchant,
    );
    expect(getCategoryPlatformOptions("Stationery", customMerchant)).toContain(
      customMerchant,
    );
    expect(CATEGORY_PLATFORMS.Food).not.toContain(customMerchant);
    expect(
      getCategoryPlatformOptions("Food", "Swiggy").filter(
        (option) => option === "Swiggy",
      ),
    ).toHaveLength(1);
    expect(getCategoryPlatformOptions("Food", "swiggy")).toContain("swiggy");
  });

  it("uses safe fallback choices for legacy or unknown categories", () => {
    for (const category of [null, undefined, "Legacy category", "__proto__"]) {
      expect(getCategoryPlatformOptions(category)).toEqual([
        ...CATEGORY_PLATFORMS.Other,
      ]);
    }
    expect(getCategoryPlatformOptions("Food", "   ")).toEqual([
      ...CATEGORY_PLATFORMS.Food,
    ]);
  });
});
