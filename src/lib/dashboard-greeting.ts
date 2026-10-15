export type DashboardGreeting =
  "Good morning" | "Good afternoon" | "Good evening";

/** A missing or invalid account preference falls back to the viewer's device. */
export function greetingTimeZone(
  preference?: string | null,
): string | undefined {
  const timeZone = preference?.trim();
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
    return timeZone;
  } catch {
    return undefined;
  }
}

export function dashboardGreeting(
  date: Date,
  timeZonePreference?: string | null,
): DashboardGreeting {
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: greetingTimeZone(timeZonePreference),
    }).format(date),
  );
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

export function dashboardFirstName(displayName?: string | null): string {
  return displayName?.trim().split(/\s+/u)[0] || "there";
}
