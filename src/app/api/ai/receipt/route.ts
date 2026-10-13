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
  scanReceiptBatchWithAI,
  receiptTransactionFingerprints,
  readReceiptAIConfiguration,
} from "@/lib/ai-receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let release: (() => void) | undefined;
  let images: Buffer[] = [];
  try {
    // Authenticate and require a configured key before reading uploads or spending provider credits.
    const { ownerId, cloud } = await authenticateAIOwnerRequest(request);
    const configuration = readReceiptAIConfiguration();
    if (!configuration)
      throw new ReceiptAIError(
        "ai_not_configured",
        "Receipt AI is not available yet. Contact the app owner.",
        409,
      );
    release = acquireReceiptScan(ownerId);
    const metadata = receiptProviderMetadata(configuration.provider);
    const upload = await readReceiptUpload(
      request,
      configuration,
      receiptUploadLimits(cloud),
    );
    images = upload.images;
    const extractions = await scanReceiptBatchWithAI({
      configuration,
      images,
      signal: request.signal,
      redacted: upload.redacted,
    });
    const fingerprints = receiptTransactionFingerprints(
      extractions,
      upload.fingerprint,
    );
    return privateResponse({
      extractions,
      fingerprints,
      extraction: extractions[0],
      fingerprint: fingerprints[0],
      provider: metadata.provider,
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
        error: "The receipt scan could not be completed. Please retry.",
        code: "scan_unavailable",
      },
      503,
    );
  } finally {
    for (const image of images) image.fill(0);
    release?.();
  }
}
