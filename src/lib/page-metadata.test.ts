import { describe, expect, it } from "vitest";
import { APP_PAGE_METADATA, resolveAppPage } from "./page-metadata";

const recordId = "00000000-0000-4000-8000-000000000101";

describe("workspace route boundaries", () => {
  it("recognizes the overview and every implemented page without private records", () => {
    expect(resolveAppPage()?.page).toBe("dashboard");
    for (const page of Object.keys(APP_PAGE_METADATA)) {
      const result = resolveAppPage([page]);
      expect(result?.page).toBe(page);
      expect(result?.title).toBeTruthy();
      expect(result?.description.length).toBeGreaterThan(40);
      expect(result?.detail).toBe(false);
    }
  });

  it("preserves setup, transaction creation and actual UUID detail routes", () => {
    expect(resolveAppPage(["transactions", "new"])?.title).toBe(
      "Add transaction",
    );
    expect(resolveAppPage(["profile", "setup"])?.title).toBe(
      "Set up your profile",
    );
    for (const page of [
      "accounts",
      "bills",
      "fixed-deposits",
      "loans",
      "split-bills",
    ]) {
      expect(resolveAppPage([page, recordId])?.detail).toBe(true);
    }
    expect(resolveAppPage(["loans", recordId])?.title).toBe("Loan details");
    expect(resolveAppPage(["accounts", recordId])?.title).toBe(
      "Account details",
    );
  });

  it("rejects unknown pages and malformed detail paths rather than showing another page", () => {
    for (const path of [
      ["unknown"],
      ["constructor"],
      ["__proto__"],
      ["api", "missing"],
      ["settings", recordId],
      ["transactions", recordId],
      ["orders", recordId],
      ["emi-calendar", recordId],
      ["profile", "unsupported"],
      ["accounts", "not-an-id"],
      ["loans", "123"],
      ["bills", ""],
      ["accounts", recordId, "extra"],
      ["profile", "setup", "extra"],
      ["transactions", "new", "extra"],
      ["dashboard", "extra"],
    ]) {
      expect(resolveAppPage(path), path.join("/")).toBeNull();
    }
  });
});
