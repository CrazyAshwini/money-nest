import { NextRequest, NextResponse } from "next/server";
import {
  exportPrivateProfile,
  privateProfileEnabled,
  PrivateProfileError,
} from "@/lib/private-profile-store";
import { privateRequestAllowed } from "@/lib/private-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const COOKIE = "finance-os-private-session";

export async function GET(request: NextRequest) {
  if (!privateProfileEnabled())
    return NextResponse.json({ error: "Local profile export is unavailable." }, { status: 404 });
  if (!privateRequestAllowed(request))
    return NextResponse.json({ error: "This profile is available only on this computer." }, { status: 403 });
  try {
    const bundle = await exportPrivateProfile(
      request.cookies.get(COOKIE)?.value ?? "",
    );
    return new NextResponse(JSON.stringify(bundle), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'attachment; filename="money-nest-transfer.json"',
        "Content-Type": "application/json; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof PrivateProfileError && error.code === "auth" ? 401 : 503;
    return NextResponse.json(
      { error: status === 401 ? "Sign in to export your profile." : "Your profile could not be exported." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
