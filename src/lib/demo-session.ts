import { NextResponse, type NextRequest } from "next/server";

export const DEMO_SESSION_COOKIE = "money-nest-demo-session";
export const DEMO_READ_ONLY_MESSAGE = "This service is unavailable in demo mode. Exit demo to access your real workspace.";

/** A negative isolation marker, never authorization for a real profile or service. */
export function isDemoSession(request: NextRequest) {
  return request.cookies.get(DEMO_SESSION_COOKIE)?.value === "1";
}

export function demoReadOnlyResponse() {
  return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE, code: "demo_read_only" }, {
    status: 403,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}
