import "server-only";
import { NextRequest } from "next/server";
import {
  privateProfileEnabled,
  PrivateProfileError,
  authenticatePrivateProfile,
} from "@/lib/private-profile-store";
import { privateRequestAllowed } from "@/lib/private-request";
import { privateResponse } from "@/lib/private-profile-http";
import { readReceiptAISettings } from "@/lib/ai-receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sessionToken = (request: NextRequest) =>
  request.cookies.get("finance-os-private-session")?.value ?? "";
const unavailable = () =>
  privateResponse(
    {
      error: "Sign in to a private profile to use receipt AI.",
      code: "private_profile_required",
    },
    403,
  );
const failure = (error: unknown) => {
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
  if (!privateRequestAllowed(request))
    return privateResponse(
      { error: "Request is not allowed.", code: "origin_not_allowed" },
      403,
    );
  if (!privateProfileEnabled()) return unavailable();
  try {
    await authenticatePrivateProfile(sessionToken(request));
    // No masked credential, key prefix, profile identity or financial record leaves this endpoint.
    return privateResponse({
      available: true,
      ownerManaged: true,
      ...readReceiptAISettings(),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  if (!privateRequestAllowed(request, true))
    return privateResponse(
      { error: "Request origin is not allowed.", code: "origin_not_allowed" },
      403,
    );
  if (!privateProfileEnabled()) return unavailable();
  try {
    await authenticatePrivateProfile(sessionToken(request));
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
