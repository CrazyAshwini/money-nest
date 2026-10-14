import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { testFixturesEnabled } from "./test-fixtures";

const isolated = {
  FINANCE_E2E_FIXTURES: "1",
  FINANCE_PRIVATE_ENABLED: "false",
};

describe("synthetic browser fixture isolation", () => {
  it("requires explicit fixture opt-in and disabled private persistence", () => {
    expect(testFixturesEnabled({})).toBe(false);
    expect(testFixturesEnabled({ FINANCE_E2E_FIXTURES: "1" })).toBe(false);
    expect(
      testFixturesEnabled({ ...isolated, FINANCE_E2E_FIXTURES: "true" }),
    ).toBe(false);
    expect(testFixturesEnabled(isolated)).toBe(true);
  });

  it("never enables fixtures alongside a private profile, including isolated private tests", () => {
    expect(
      testFixturesEnabled({ ...isolated, FINANCE_PRIVATE_ENABLED: "true" }),
    ).toBe(false);
    expect(
      testFixturesEnabled({
        ...isolated,
        FINANCE_PRIVATE_ENABLED: "true",
        FINANCE_PRIVATE_TEST_MODE: "true",
      }),
    ).toBe(false);
  });

  it.each([
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FINANCE_CLOUD_OWNER_ID",
    "FINANCE_CLOUD_OWNER_EMAIL",
  ])("blocks fixture mode whenever %s is configured", (key) => {
    expect(
      testFixturesEnabled({ ...isolated, [key]: "synthetic-config" }),
    ).toBe(false);
  });
});
