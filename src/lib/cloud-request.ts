import "server-only";
import type { NextRequest } from "next/server";
import { cloudOwnerRestricted } from "./cloud-owner";

/** Deployment URLs are explicit; forwarded headers never choose an auth redirect. */
export function cloudApplicationOrigin(request: NextRequest): string | null {
  const configured = process.env.APP_URL;
  if (!configured)
    return cloudOwnerRestricted() ? null : request.nextUrl.origin;
  try {
    const url = new URL(configured);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.port === "0" ||
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function cloudRequestAllowed(request: NextRequest, write = false) {
  const origin = cloudApplicationOrigin(request);
  if (!origin) return false;
  const url = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  const sameHost =
    request.nextUrl.hostname === url.hostname ||
    (loopback.includes(request.nextUrl.hostname) &&
      loopback.includes(url.hostname));
  if (
    !sameHost ||
    request.nextUrl.protocol !== url.protocol ||
    request.nextUrl.port !== url.port
  )
    return false;
  const host = request.headers.get("host");
  if (!host && cloudOwnerRestricted()) return false;
  if (host && host.toLowerCase() !== url.host.toLowerCase()) return false;
  const supplied = request.headers.get("origin");
  if (supplied && supplied !== origin) return false;
  if (write && cloudOwnerRestricted() && supplied !== origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
