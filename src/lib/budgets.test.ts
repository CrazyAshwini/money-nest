import { beforeEach, describe, expect, it } from "vitest";
import {
  computeBudgetStatus,
  getCategoryBudgets,
  saveCategoryBudgets,
} from "./budgets";

describe("category budgets utility", () => {
  const userId = "test-user-123";
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, String(val));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    };
    Object.defineProperty(globalThis, "window", {
      value: globalThis,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      configurable: true,
      writable: true,
    });
  });

  it("reads empty budgets when nothing is stored", () => {
    expect(getCategoryBudgets(userId)).toEqual({});
  });

  it("saves and retrieves category budgets for a specific user", () => {
    const budgets = { Food: "5000", Shopping: "3000" };
    saveCategoryBudgets(userId, budgets);
    expect(getCategoryBudgets(userId)).toEqual(budgets);

    // Isolated per user
    expect(getCategoryBudgets("other-user")).toEqual({});
  });

  it("computes status for spend well below limit", () => {
    const status = computeBudgetStatus("2000.00", "5000");
    expect(status).not.toBeNull();
    expect(status?.percentage).toBe(40);
    expect(status?.isOver).toBe(false);
    expect(status?.isWarning).toBe(false);
    expect(status?.statusLabel).toContain("₹3,000 left");
    expect(status?.remaining).toBe("3000.00");
  });

  it("computes status when spending reaches warning threshold (>= 80%)", () => {
    const status = computeBudgetStatus("4200.00", "5000");
    expect(status).not.toBeNull();
    expect(status?.percentage).toBe(84);
    expect(status?.isOver).toBe(false);
    expect(status?.isWarning).toBe(true);
    expect(status?.statusLabel).toContain("₹800 left");
  });

  it("computes status when spending exceeds budget (> 100%)", () => {
    const status = computeBudgetStatus("5500.00", "5000");
    expect(status).not.toBeNull();
    expect(status?.percentage).toBe(110);
    expect(status?.isOver).toBe(true);
    expect(status?.isWarning).toBe(false);
    expect(status?.statusLabel).toContain("Over by ₹500");
    expect(status?.remaining).toBe("0.00");
  });

  it("returns null when limit is not configured or invalid", () => {
    expect(computeBudgetStatus("1000", "")).toBeNull();
    expect(computeBudgetStatus("1000", "0")).toBeNull();
    expect(computeBudgetStatus("1000", "-500")).toBeNull();
    expect(computeBudgetStatus("1000", undefined)).toBeNull();
  });
});
