import "server-only";
import { NextRequest } from "next/server";
import {
  privateProfileEnabled,
  PrivateProfileError,
  authenticatePrivateProfile,
} from "@/lib/private-profile-store";
import { privateRequestAllowed } from "@/lib/private-request";
import { privateResponse } from "@/lib/private-profile-http";
import {
  acquireReceiptScan,
  receiptProviderMetadata,
  ReceiptAIError,
  readReceiptUpload,
  scanReceiptWithAI,
  readReceiptAIConfiguration,
} from "@/lib/ai-receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!privateRequestAllowed(request, true))
    return privateResponse(
      { error: "Request origin is not allowed.", code: "origin_not_allowed" },
      403,
    );
  if (!privateProfileEnabled())
    return privateResponse(
      {
        error: "Sign in to a private profile to scan a receipt.",
        code: "private_profile_required",
      },
      403,
    );
  let release: (() => void) | undefined;
  let image: Buffer | undefined;
  try {
    // Authenticate and require a configured key before reading uploads or spending provider credits.
    const { ownerId } = await authenticatePrivateProfile(
      request.cookies.get("finance-os-private-session")?.value ?? "",
    );
    const configuration = readReceiptAIConfiguration();
    if (!configuration)
      throw new ReceiptAIError(
        "ai_not_configured",
        "Receipt AI is not available yet. Contact the app owner.",
        409,
      );
    release = acquireReceiptScan(ownerId);
    const metadata = receiptProviderMetadata(configuration.provider);
    const upload = await readReceiptUpload(request, configuration);
    image = upload.bytes;
    const extraction = await scanReceiptWithAI({
      configuration,
      bytes: image,
      mediaType: upload.mediaType,
      signal: request.signal,
      redacted: upload.redacted,
    });
    return privateResponse({
      extraction,
      fingerprint: upload.fingerprint,
      provider: metadata.provider,
      model: configuration.model,
    });
  } catch (error) {
    if (error instanceof PrivateProfileError && error.code === "auth")
      return privateResponse(
        { error: "Sign in to your profile.", code: "authentication_required" },
        401,
      );
    if (error instanceof ReceiptAIError)
      return privateResponse(
        { error: error.message, code: error.code },
        error.status,
      );
    return privateResponse(
      {
        error: "The receipt scan could not be completed. Please retry.",
        code: "scan_unavailable",
      },
      503,
    );
  } finally {
    image?.fill(0);
    release?.();
  }
}
