import { describe, expect, it } from "vitest";
import {
  dashboardFirstName,
  dashboardGreeting,
  greetingTimeZone,
} from "./dashboard-greeting";

describe("dashboard local greeting", () => {
  it.each([
    ["04:59:59", "Good evening"],
    ["05:00:00", "Good morning"],
    ["11:59:59", "Good morning"],
    ["12:00:00", "Good afternoon"],
    ["16:59:59", "Good afternoon"],
    ["17:00:00", "Good evening"],
    ["23:59:59", "Good evening"],
    ["00:00:00", "Good evening"],
  ])("uses the correct greeting at %s", (time, expected) => {
    expect(dashboardGreeting(new Date(`2026-10-14T${time}Z`), "UTC")).toBe(
      expected,
    );
  });

  it("uses the account time zone even when its day differs from UTC", () => {
    const instant = new Date("2026-10-14T23:30:00Z");
    expect(dashboardGreeting(instant, "Asia/Kolkata")).toBe("Good morning");
    expect(dashboardGreeting(instant, "America/New_York")).toBe("Good evening");
    expect(dashboardGreeting(instant, "Pacific/Honolulu")).toBe(
      "Good afternoon",
    );
  });

  it("falls back to the device for missing or invalid preferences", () => {
    const instant = new Date("2026-10-14T10:30:00Z");
    expect(greetingTimeZone(" Pacific/Honolulu ")).toBe("Pacific/Honolulu");
    expect(greetingTimeZone("Not/A_Timezone")).toBeUndefined();
    expect(greetingTimeZone("  ")).toBeUndefined();
    expect(dashboardGreeting(instant, "Not/A_Timezone")).toBe(
      dashboardGreeting(instant),
    );
    expect(dashboardGreeting(instant, null)).toBe(dashboardGreeting(instant));
  });

  it("extracts the first display-name word with a neutral missing-name fallback", () => {
    expect(dashboardFirstName("  Alex  Morgan ")).toBe("Alex");
    expect(dashboardFirstName("李\t伟")).toBe("李");
    expect(dashboardFirstName("\n \t")).toBe("there");
    expect(dashboardFirstName(null)).toBe("there");
  });
});
