import "server-only";
import type { NextRequest } from "next/server";
import { cloudOwnerRestricted } from "./cloud-owner";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function applicationURL(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.port === "0" ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && loopbackHosts.has(url.hostname)))
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

/** Read only the actual Host, preserving loopback aliases normalized by NextURL. */
function requestURL(request: NextRequest): URL | null {
  const host = request.headers.get("host");
  const authority = host?.match(
    /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/i,
  );
  if (!authority) return null;
  const url = applicationURL(`${request.nextUrl.protocol}//${host}`);
  if (
    !url ||
    authority[1].toLowerCase() !== url.hostname ||
    url.port !== request.nextUrl.port ||
    (url.hostname !== request.nextUrl.hostname &&
      !(
        loopbackHosts.has(url.hostname) &&
        loopbackHosts.has(request.nextUrl.hostname)
      ))
  )
    return null;
  return url;
}

/** Only explicit app/current-deployment origins choose API and auth destinations. */
export function cloudApplicationOrigin(request: NextRequest): string | null {
  const active = requestURL(request);
  if (!active) return null;
  const allowed: string[] = [];
  if (process.env.APP_URL) {
    const app = applicationURL(process.env.APP_URL);
    if (!app) return null;
    allowed.push(app.origin);
  }
  if (process.env.VERCEL_URL) {
    const host = process.env.VERCEL_URL.trim();
    // This server-provided value names this deployment, never every Vercel tenant.
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i.test(host))
      return null;
    allowed.push(`https://${host.toLowerCase()}`);
  }
  if (allowed.includes(active.origin)) return active.origin;
  // Keep unconfigured local development usable, without trusting remote hosts.
  if (
    !allowed.length &&
    !cloudOwnerRestricted() &&
    loopbackHosts.has(active.hostname)
  )
    return active.origin;
  return null;
}

export function cloudRequestAllowed(
  request: NextRequest,
  write = false,
): boolean {
  const origin = cloudApplicationOrigin(request);
  if (!origin) return false;
  const supplied = request.headers.get("origin");
  if (write ? supplied !== origin : supplied !== null && supplied !== origin)
    return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
