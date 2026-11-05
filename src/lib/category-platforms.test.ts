import { describe, expect, it } from "vitest";
import {
  CATEGORY_PLATFORMS,
  getCategoryPlatformOptions,
  inferCategoryAndPlatformFromText,
  inferCategoryFromPlatform,
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

  describe("smart category and platform inference", () => {
    it("infers category and platform from typed description or merchant text", () => {
      expect(inferCategoryAndPlatformFromText("Swiggy lunch")).toEqual({
        category: "Food",
        platform: "Swiggy",
      });
      expect(inferCategoryAndPlatformFromText("Blinkit order for vegetables")).toEqual({
        category: "Shopping",
        platform: "Blinkit",
      });
      expect(inferCategoryAndPlatformFromText("Uber cab to airport")).toEqual({
        category: "Transport",
        platform: "Uber",
      });
      expect(inferCategoryAndPlatformFromText("Amazon Prime subscription")).toEqual({
        category: "Subscriptions",
        platform: "Amazon Prime",
      });
      expect(inferCategoryAndPlatformFromText("Tata 1mg medicines")).toEqual({
        category: "Health & Personal Care",
        platform: "Tata 1mg",
      });
      expect(inferCategoryAndPlatformFromText("Unknown random payment")).toBeNull();
      expect(inferCategoryAndPlatformFromText("")).toBeNull();
      expect(inferCategoryAndPlatformFromText(null)).toBeNull();
    });

    it("infers category directly from chosen platform", () => {
      expect(inferCategoryFromPlatform("Swiggy")).toBe("Food");
      expect(inferCategoryFromPlatform("Zomato")).toBe("Food");
      expect(inferCategoryFromPlatform("Blinkit")).toBe("Shopping");
      expect(inferCategoryFromPlatform("Uber")).toBe("Transport");
      expect(inferCategoryFromPlatform("Netflix")).toBe("Subscriptions");
      expect(inferCategoryFromPlatform("Tata 1mg")).toBe("Health & Personal Care");
      expect(inferCategoryFromPlatform("RandomPlatform")).toBeNull();
    });
  });
});
