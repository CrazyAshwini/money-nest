import "server-only";
import { NextRequest } from "next/server";
import {
  authenticatePrivateProfile,
  privateProfileEnabled,
} from "./private-profile-store";
import { privateRequestAllowed } from "./private-request";
import { createSupabaseServerClient } from "./supabase/server";
import { cloudOwnerConfigured, isCloudOwner } from "./cloud-owner";
import { MAX_HOSTED_RECEIPT_BYTES, MAX_RECEIPT_BYTES } from "./receipt-scan";

export class AIOwnerAuthenticationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 403,
  ) {
    super(message);
    this.name = "AIOwnerAuthenticationError";
  }
}

/** A hosted scanner trusts only the deployment's explicit canonical origin. */
export function cloudAIRequestAllowed(request: NextRequest, write = false) {
  try {
    const configured = process.env.APP_URL?.trim();
    if (!configured) return false;
    const app = new URL(configured);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname);
    if (
      (app.protocol !== "https:" && !(loopback && app.protocol === "http:")) ||
      app.username ||
      app.password ||
      app.pathname !== "/" ||
      app.search ||
      app.hash ||
      app.port === "0" ||
      request.headers.get("host")?.toLowerCase() !== app.host ||
      request.nextUrl.protocol !== app.protocol ||
      request.nextUrl.port !== app.port ||
      (!loopback && request.nextUrl.hostname !== app.hostname)
    )
      return false;
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    return (
      (!site || site === "same-origin" || site === "none") &&
      (write ? origin === app.origin : origin === null || origin === app.origin)
    );
  } catch {
    return false;
  }
}

/** Authenticate before reading uploads, configuration, or spending AI credits. */
export async function authenticateAIOwnerRequest(
  request: NextRequest,
  write = true,
): Promise<{ ownerId: string; cloud: boolean }> {
  const local = privateProfileEnabled();
  if (
    !(local
      ? privateRequestAllowed(request, write)
      : cloudAIRequestAllowed(request, write))
  )
    throw new AIOwnerAuthenticationError(
      "origin_not_allowed",
      "Request origin is not allowed.",
    );
  if (local) {
    const { ownerId } = await authenticatePrivateProfile(
      request.cookies.get("finance-os-private-session")?.value ?? "",
    );
    return { ownerId, cloud: false };
  }
  if (!cloudOwnerConfigured())
    throw new AIOwnerAuthenticationError(
      "cloud_owner_required",
      "The app owner needs to enable cloud receipt scanning.",
    );
  const client = await createSupabaseServerClient();
  if (!client)
    throw new AIOwnerAuthenticationError(
      "authentication_required",
      "Sign in to the owner's profile to use receipt AI.",
    );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !isCloudOwner(data.user))
    throw new AIOwnerAuthenticationError(
      "owner_profile_required",
      "Sign in to the owner's profile to use receipt AI.",
    );
  return { ownerId: data.user.id, cloud: true };
}

export function receiptUploadLimits(cloud: boolean) {
  return {
    maxImageBytes: cloud ? MAX_HOSTED_RECEIPT_BYTES : MAX_RECEIPT_BYTES,
    // Leave room below Vercel's 4.5 MB payload limit for multipart metadata.
    maxMultipartBytes: cloud
      ? MAX_HOSTED_RECEIPT_BYTES + 64 * 1024
      : 6 * 1024 * 1024,
  };
}
