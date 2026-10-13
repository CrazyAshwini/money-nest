import "server-only";
import { NextRequest } from "next/server";
import { PrivateProfileError } from "@/lib/private-profile-store";
import {
  AIOwnerAuthenticationError,
  authenticateAIOwnerRequest,
  receiptUploadLimits,
} from "@/lib/ai-owner-auth";
import { privateResponse } from "@/lib/private-profile-http";
import { readReceiptAISettings } from "@/lib/ai-receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failure = (error: unknown) => {
  if (error instanceof AIOwnerAuthenticationError)
    return privateResponse(
      { error: error.message, code: error.code },
      error.status,
    );
  if (error instanceof PrivateProfileError && error.code === "auth")
    return privateResponse(
      { error: "Sign in to your profile.", code: "authentication_required" },
      401,
    );
  return privateResponse(
    {
      error: "The AI connection could not be accessed. Please retry.",
      code: "settings_unavailable",
    },
    503,
  );
};

export async function GET(request: NextRequest) {
  try {
    const { cloud } = await authenticateAIOwnerRequest(request, false);
    // No masked credential, key prefix, profile identity or financial record leaves this endpoint.
    return privateResponse({
      available: true,
      ownerManaged: true,
      ...readReceiptAISettings(),
      maxUploadBytes: receiptUploadLimits(cloud).maxImageBytes,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authenticateAIOwnerRequest(request);
    // User requests never read, replace or persist the app owner's credentials.
    return privateResponse(
      {
        error:
          "Receipt AI is managed by the app owner. Users cannot change its configuration.",
        code: "owner_managed",
      },
      403,
    );
  } catch (error) {
    return failure(error);
  }
}
