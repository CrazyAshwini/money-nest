import "server-only";
import { NextRequest } from "next/server";
import { authenticatePrivateProfile, commitPrivateCommerce, privateProfileEnabled, PrivateProfileError, readPrivateCommerce } from "@/lib/private-profile-store";
import { privateRequestAllowed } from "@/lib/private-request";
import { privateResponse } from "@/lib/private-profile-http";
import { readBoundedBody, ReceiptAIError } from "@/lib/ai-receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sessionToken = (request: NextRequest) => request.cookies.get("finance-os-private-session")?.value ?? "";
const unavailable = () => privateResponse({ error: "Orders are available in a private local profile.", code: "private_profile_required" }, 403);
const failure = (error: unknown) => error instanceof PrivateProfileError
  ? privateResponse({ error: error.message }, error.code === "auth" ? 401 : error.code === "storage" ? 503 : 400)
  : error instanceof ReceiptAIError ? privateResponse({ error: "The request is too large or invalid." }, error.status)
    : privateResponse({ error: "Order changes could not be completed. Check the details and retry." }, 400);
export async function GET(request: NextRequest) {
  if (!privateRequestAllowed(request)) return privateResponse({ error: "This profile is available only on this computer." }, 403);
  if (!privateProfileEnabled()) return unavailable();
  try { return privateResponse(await readPrivateCommerce(sessionToken(request))); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  if (!privateRequestAllowed(request, true)) return privateResponse({ error: "Request origin is not allowed." }, 403);
  if (!privateProfileEnabled()) return unavailable();
  let bytes: Buffer | undefined;
  try {
    // Authenticate before parsing any client financial data.
    await authenticatePrivateProfile(sessionToken(request));
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return privateResponse({ error: "Send a reviewed JSON order or refund operation." }, 400);
    bytes = await readBoundedBody(request, 750_000);
    const input: unknown = JSON.parse(bytes.toString("utf8"));
    return privateResponse(await commitPrivateCommerce(sessionToken(request), input));
  } catch (error) { return failure(error); }
  finally { bytes?.fill(0); }
}
