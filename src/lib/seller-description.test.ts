import { describe, expect, it } from "vitest";
import {
  replaceSellerDescription,
  withSellerDescription,
} from "./seller-description";

describe("seller descriptions", () => {
  it("keeps the purchase and names its seller once", () => {
    expect(withSellerDescription("Chicken biryani", "Bikkgane Biryani")).toBe(
      "Chicken biryani · Bikkgane Biryani",
    );
    expect(withSellerDescription(null, "Bikkgane Biryani")).toBe(
      "Bikkgane Biryani",
    );
    expect(withSellerDescription("Lunch", null)).toBe("Lunch");
    expect(withSellerDescription(null, null)).toBe("");
  });
  it("recognizes names despite casing and whitespace without repeating them", () => {
    const description = "Lunch at bIKKgane Biryani";
    expect(withSellerDescription(description, " Bikkgane\n Biryani ")).toBe(
      description,
    );
    expect(withSellerDescription("Bikkgane Biryani", "bikkgane biryani")).toBe(
      "Bikkgane Biryani",
    );
    expect(withSellerDescription("Dinner · Domino's", "Domino's")).toBe(
      "Dinner · Domino's",
    );
  });
  it("matches exact seller names rather than substrings or regex patterns", () => {
    expect(withSellerDescription("Cafeteria lunch", "Cafe")).toBe(
      "Cafeteria lunch · Cafe",
    );
    expect(withSellerDescription("Lunch at A+B (Cafe)", "A+B (Cafe)")).toBe(
      "Lunch at A+B (Cafe)",
    );
    expect(withSellerDescription("Lunch at AAB (Cafe)", "A+B (Cafe)")).toBe(
      "Lunch at AAB (Cafe) · A+B (Cafe)",
    );
  });
  it("retains useful complete words and the full seller within the storage bound", () => {
    const description =
      "A detailed lunch order with delivery and several dishes ".repeat(5);
    const result = withSellerDescription(description, "Bikkgane Biryani");
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/^A detailed lunch order/);
    expect(result).toMatch(/· Bikkgane Biryani$/);
    expect(description.startsWith(`${result.split(" · ")[0]} `)).toBe(true);
    expect(withSellerDescription(result, "Bikkgane Biryani")).toBe(result);
  });
  it("preserves a seller near the end of an oversized description", () => {
    const result = withSellerDescription(
      `${"Item details ".repeat(25)}· Bikkgane Biryani`,
      "Bikkgane Biryani",
    );
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.match(/Bikkgane Biryani/g)).toHaveLength(1);
    expect(result).toMatch(/· Bikkgane Biryani$/);
  });
  it("respects small limits and does not split Unicode surrogate pairs", () => {
    expect(withSellerDescription("Lunch", "Seller", 0)).toBe("");
    expect(withSellerDescription("Lunch", "Seller", 4)).toBe("Sell");
    expect(withSellerDescription("😀😀😀", null, 5)).toBe("😀😀");
  });
});

describe("correcting seller descriptions", () => {
  it("replaces a known seller while preserving the purchase details", () => {
    expect(
      replaceSellerDescription(
        "Chicken biryani · Bikkgane Biryani",
        "Bikkgane Biryani",
        "New Restaurant",
      ),
    ).toBe("Chicken biryani · New Restaurant");
    expect(
      replaceSellerDescription(
        "Lunch at bIKKgane Biryani with delivery",
        " Bikkgane\n Biryani ",
        "New Restaurant",
      ),
    ).toBe("Lunch at New Restaurant with delivery");
    expect(
      replaceSellerDescription(
        "Bikkgane Biryani",
        "Bikkgane Biryani",
        "New Restaurant",
      ),
    ).toBe("New Restaurant");
  });
  it("matches complete names and treats punctuation and dollar signs as plain text", () => {
    expect(
      replaceSellerDescription(
        "Lunch at A+B (Cafe)",
        "A+B (Cafe)",
        "$1 New Cafe",
      ),
    ).toBe("Lunch at $1 New Cafe");
    expect(
      replaceSellerDescription("Cafeteria lunch", "Cafe", "New Restaurant"),
    ).toBe("Cafeteria lunch · New Restaurant");
  });
  it("does not add the new seller twice when it is already in the description", () => {
    expect(
      replaceSellerDescription(
        "Lunch · Old Restaurant · New Restaurant",
        "Old Restaurant",
        "New Restaurant",
      ),
    ).toBe("Lunch · New Restaurant");
    expect(
      replaceSellerDescription(
        "Dinner at NEW Restaurant · Old Restaurant",
        "Old Restaurant",
        "New Restaurant",
      ),
    ).toBe("Dinner at NEW Restaurant");
  });
  it("adds the new seller once when the previous name is absent", () => {
    expect(
      replaceSellerDescription(
        "Chicken biryani",
        "Old Restaurant",
        "New Restaurant",
      ),
    ).toBe("Chicken biryani · New Restaurant");
    expect(
      replaceSellerDescription(
        "Lunch at New Restaurant",
        null,
        "New Restaurant",
      ),
    ).toBe("Lunch at New Restaurant");
    expect(
      replaceSellerDescription(null, "Old Restaurant", "New Restaurant"),
    ).toBe("New Restaurant");
  });
  it("clears a known seller and removes the separators or prepositions introducing it", () => {
    expect(
      replaceSellerDescription("Lunch · Old Restaurant", "Old Restaurant", ""),
    ).toBe("Lunch");
    expect(
      replaceSellerDescription(
        "Old Restaurant · Lunch",
        "Old Restaurant",
        null,
      ),
    ).toBe("Lunch");
    expect(
      replaceSellerDescription(
        "Lunch · Old Restaurant · delivery",
        "Old Restaurant",
        null,
      ),
    ).toBe("Lunch · delivery");
    expect(
      replaceSellerDescription(
        "Lunch at Old Restaurant with delivery",
        "Old Restaurant",
        null,
      ),
    ).toBe("Lunch with delivery");
    expect(
      replaceSellerDescription("Old Restaurant", "Old Restaurant", null),
    ).toBe("");
    expect(replaceSellerDescription("Cafeteria lunch", "Cafe", null)).toBe(
      "Cafeteria lunch",
    );
  });
  it("retains the corrected seller under the description length bound", () => {
    const result = replaceSellerDescription(
      `${"Useful item details ".repeat(15)}· Old Restaurant`,
      "Old Restaurant",
      "New Restaurant",
    );
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/^Useful item details/);
    expect(result).toMatch(/· New Restaurant$/);
    expect(result).not.toContain("Old Restaurant");
  });
});
