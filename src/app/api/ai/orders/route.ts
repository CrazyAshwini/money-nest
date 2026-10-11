import "server-only";
import { NextRequest } from "next/server";
import { privateProfileEnabled, PrivateProfileError, authenticatePrivateProfile } from "@/lib/private-profile-store";
import { privateRequestAllowed } from "@/lib/private-request";
import { privateResponse } from "@/lib/private-profile-http";
import { acquireReceiptScan, receiptProviderMetadata, ReceiptAIError, readReceiptUpload, scanOrderHistoryWithAI, readReceiptAIConfiguration, orderBatchFingerprint } from "@/lib/ai-receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  if (!privateRequestAllowed(request, true)) return privateResponse({ error: "Request origin is not allowed.", code: "origin_not_allowed" }, 403);
  if (!privateProfileEnabled()) return privateResponse({ error: "Sign in to a private profile to scan order history.", code: "private_profile_required" }, 403);
  let release: (() => void) | undefined;
  let images: Buffer[] = [];
  try {
    const { ownerId } = await authenticatePrivateProfile(request.cookies.get("finance-os-private-session")?.value ?? "");
    const configuration = readReceiptAIConfiguration();
    if (!configuration) throw new ReceiptAIError("ai_not_configured", "Order scanning is unavailable. Contact the app owner.", 409);
    release = acquireReceiptScan(ownerId);
    const upload = await readReceiptUpload(request, configuration);
    images = upload.images;
    const fingerprint = orderBatchFingerprint(images);
    const extraction = await scanOrderHistoryWithAI({ configuration, images, fingerprint, ownerId, signal: request.signal, redacted: upload.redacted });
    return privateResponse({ extraction, fingerprint, provider: receiptProviderMetadata(configuration.provider).provider, model: configuration.model });
  } catch (error) {
    if (error instanceof PrivateProfileError && error.code === "auth") return privateResponse({ error: "Sign in to your profile.", code: "authentication_required" }, 401);
    if (error instanceof ReceiptAIError) return privateResponse({ error: error.message, code: error.code }, error.status);
    return privateResponse({ error: "The order scan could not be completed. Please retry.", code: "scan_unavailable" }, 503);
  } finally { for (const image of images) image.fill(0); release?.(); }
}
