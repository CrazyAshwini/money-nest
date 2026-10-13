import "server-only";
import type { NextRequest } from "next/server";
import { cloudOwnerRestricted } from "./cloud-owner";

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

function cleanHost(value: string | null | undefined): string {
  if (!value) return "";
  return value.split(",")[0].trim().toLowerCase().split(":")[0];
}

function isVercelHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app");
}

function isLoopback(hostname: string): boolean {
  return loopbackHosts.includes(hostname);
}

/** Deployment URLs are explicit; forwarded headers never choose an auth redirect. */
export function cloudApplicationOrigin(request: NextRequest): string | null {
  const reqHost = cleanHost(request.nextUrl.hostname);
  const hostHeader = cleanHost(request.headers.get("x-forwarded-host") || request.headers.get("host"));
  const activeHost = reqHost || hostHeader;

  // On Vercel deployments (*.vercel.app) or loopback, dynamically bind to that deployment origin:
  if (isVercelHost(activeHost) || isLoopback(activeHost)) {
    const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
    return `${proto}://${activeHost}`;
  }

  const configured = process.env.APP_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      const loopback = isLoopback(url.hostname);
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

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return cloudOwnerRestricted() ? null : request.nextUrl.origin;
}

export function cloudRequestAllowed(request: NextRequest, write = false) {
  const origin = cloudApplicationOrigin(request);
  if (!origin) return false;
  const url = new URL(origin);

  const reqHost = cleanHost(request.nextUrl.hostname);
  const hostHeader = cleanHost(request.headers.get("x-forwarded-host") || request.headers.get("host"));
  const urlHost = cleanHost(url.hostname);

  const isVercel = isVercelHost(reqHost) || isVercelHost(hostHeader);
  const isLoop = isLoopback(reqHost) || isLoopback(hostHeader);

  const sameHost =
    reqHost === urlHost ||
    hostHeader === urlHost ||
    (isVercel && (isVercelHost(urlHost) || Boolean(process.env.APP_URL))) ||
    (isLoop && (isLoopback(urlHost) || Boolean(process.env.APP_URL)));

  if (!sameHost) return false;

  const host = request.headers.get("host");
  if (!host && cloudOwnerRestricted() && !isVercel && !isLoop) return false;

  const supplied = request.headers.get("origin");
  if (supplied) {
    try {
      const suppliedUrl = new URL(supplied);
      const suppliedHost = cleanHost(suppliedUrl.hostname);
      const allowed =
        supplied === origin ||
        suppliedHost === reqHost ||
        suppliedHost === hostHeader ||
        (isVercel && isVercelHost(suppliedHost)) ||
        (isLoop && isLoopback(suppliedHost));
      if (!allowed) return false;
    } catch {
      return false;
    }
  }

  if (write && cloudOwnerRestricted() && supplied) {
    try {
      const suppliedUrl = new URL(supplied);
      const suppliedHost = cleanHost(suppliedUrl.hostname);
      const allowed =
        supplied === origin ||
        suppliedHost === reqHost ||
        suppliedHost === hostHeader ||
        (isVercel && isVercelHost(suppliedHost)) ||
        (isLoop && isLoopback(suppliedHost));
      if (!allowed) return false;
    } catch {
      return false;
    }
  }

  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

