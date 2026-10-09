import { NextRequest } from "next/server";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import {
  privateAuthPOST,
  privateProfileGET,
  privateResponse,
} from "@/lib/private-profile-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!privateProfileEnabled())
    return privateResponse(
      { error: "A private local profile is not configured." },
      503,
    );
  return privateProfileGET(request);
}
export async function POST(request: NextRequest) {
  if (!privateProfileEnabled())
    return privateResponse(
      { error: "A private local profile is not configured." },
      503,
    );
  return privateAuthPOST(request);
}
