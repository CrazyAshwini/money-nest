import "server-only";
import { NextRequest } from "next/server";
import {
  authenticatePrivateProfile,
  privateProfileEnabled,
} from "./private-profile-store";
import { privateRequestAllowed } from "./private-request";
import { cloudRequestAllowed } from "./cloud-request";
import { createSupabaseServerClient } from "./supabase/server";
import {
  cloudOwnerConfigured,
  cloudUserAllowed,
  isCloudOwner,
} from "./cloud-owner";
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

/** Hosted AI and workspace APIs share the same exact deployment origin policy. */
export function cloudAIRequestAllowed(request: NextRequest, write = false) {
  return cloudRequestAllowed(request, write);
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
  if (error || !cloudUserAllowed(data.user) || !isCloudOwner(data.user))
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
