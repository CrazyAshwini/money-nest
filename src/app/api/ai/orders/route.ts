import "server-only";
import { NextRequest } from "next/server";
import { PrivateProfileError } from "@/lib/private-profile-store";
import {
  AIOwnerAuthenticationError,
  authenticateAIOwnerRequest,
  receiptUploadLimits,
} from "@/lib/ai-owner-auth";
import { privateResponse } from "@/lib/private-profile-http";
import {
  acquireReceiptScan,
  receiptProviderMetadata,
  ReceiptAIError,
  readReceiptUpload,
  scanOrderHistoryWithAI,
  readReceiptAIConfiguration,
  orderBatchFingerprint,
} from "@/lib/ai-receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  let release: (() => void) | undefined;
  let images: Buffer[] = [];
  try {
    const { ownerId, cloud } = await authenticateAIOwnerRequest(request);
    const configuration = readReceiptAIConfiguration();
    if (!configuration)
      throw new ReceiptAIError(
        "ai_not_configured",
        "Order scanning is unavailable. Contact the app owner.",
        409,
      );
    release = acquireReceiptScan(ownerId);
    const upload = await readReceiptUpload(
      request,
      configuration,
      receiptUploadLimits(cloud),
    );
    images = upload.images;
    const fingerprint = orderBatchFingerprint(images);
    const extraction = await scanOrderHistoryWithAI({
      configuration,
      images,
      fingerprint,
      ownerId,
      signal: request.signal,
      redacted: upload.redacted,
    });
    return privateResponse({
      extraction,
      fingerprint,
      provider: receiptProviderMetadata(configuration.provider).provider,
      model: configuration.model,
    });
  } catch (error) {
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
    if (error instanceof ReceiptAIError)
      return privateResponse(
        { error: error.message, code: error.code },
        error.status,
      );
    return privateResponse(
      {
        error: "The order scan could not be completed. Please retry.",
        code: "scan_unavailable",
      },
      503,
    );
  } finally {
    for (const image of images) image.fill(0);
    release?.();
  }
}
