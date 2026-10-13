import "server-only";
import { NextRequest } from "next/server";
import {
  authenticatePrivateProfile,
  commitPrivateCommerce,
  privateProfileEnabled,
  PrivateProfileError,
  readPrivateCommerce,
} from "@/lib/private-profile-store";
import { privateRequestAllowed } from "@/lib/private-request";
import { privateResponse } from "@/lib/private-profile-http";
import { readBoundedBody, ReceiptAIError } from "@/lib/ai-receipt-service";
import {
  AIOwnerAuthenticationError,
  authenticateAIOwnerRequest,
} from "@/lib/ai-owner-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CloudCommerceError,
  commitCloudCommerce,
  readCloudCommerce,
} from "@/lib/supabase/commerce-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sessionToken = (request: NextRequest) =>
  request.cookies.get("finance-os-private-session")?.value ?? "";
const failure = (error: unknown) =>
  error instanceof PrivateProfileError
    ? privateResponse(
        { error: error.message },
        error.code === "auth" ? 401 : error.code === "storage" ? 503 : 400,
      )
    : error instanceof CloudCommerceError ||
        error instanceof AIOwnerAuthenticationError
      ? privateResponse({ error: error.message }, error.status)
      : error instanceof ReceiptAIError
        ? privateResponse(
            { error: "The request is too large or invalid." },
            error.status,
          )
        : privateResponse(
            {
              error:
                "Order changes could not be completed. Check the details and retry.",
            },
            400,
          );
export async function GET(request: NextRequest) {
  try {
    if (privateProfileEnabled()) {
      if (!privateRequestAllowed(request))
        return privateResponse(
          { error: "This profile is available only on this computer." },
          403,
        );
      return privateResponse(await readPrivateCommerce(sessionToken(request)));
    }
    const { ownerId } = await authenticateAIOwnerRequest(request, false);
    const supabase = await createSupabaseServerClient();
    if (!supabase)
      throw new CloudCommerceError("Your cloud workspace is unavailable.", 503);
    return privateResponse(await readCloudCommerce(supabase, ownerId));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  let bytes: Buffer | undefined;
  try {
    // Authenticate before parsing any client financial data.
    const local = privateProfileEnabled();
    if (local && !privateRequestAllowed(request, true))
      return privateResponse({ error: "Request origin is not allowed." }, 403);
    const owner = local
      ? await authenticatePrivateProfile(sessionToken(request))
      : await authenticateAIOwnerRequest(request);
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return privateResponse(
        { error: "Send a reviewed JSON order or refund operation." },
        400,
      );
    bytes = await readBoundedBody(request, 750_000);
    const input: unknown = JSON.parse(bytes.toString("utf8"));
    if (local)
      return privateResponse(
        await commitPrivateCommerce(sessionToken(request), input),
      );
    const supabase = await createSupabaseServerClient();
    if (!supabase)
      throw new CloudCommerceError("Your cloud workspace is unavailable.", 503);
    return privateResponse(
      await commitCloudCommerce(supabase, owner.ownerId, input),
    );
  } catch (error) {
    return failure(error);
  } finally {
    bytes?.fill(0);
  }
}
