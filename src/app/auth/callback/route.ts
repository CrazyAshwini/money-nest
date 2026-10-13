import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import { cloudUserAllowed } from "@/lib/cloud-owner";
import { cloudApplicationOrigin } from "@/lib/cloud-request";

export const dynamic = "force-dynamic";
const otpTypes = new Set([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

function redirect(origin: string, path: string) {
  return NextResponse.redirect(new URL(path, origin), {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function destination(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value)
  )
    return "/dashboard";
  // Auth credentials never remain in the next page's address, and callbacks cannot loop.
  const url = new URL(value, "https://redirect.invalid");
  if (
    url.origin !== "https://redirect.invalid" ||
    /^\/(?:api|auth)(?:\/|$)/.test(url.pathname)
  )
    return "/dashboard";
  return url.pathname;
}

export async function GET(request: NextRequest) {
  const origin = cloudApplicationOrigin(request);
  const host = request.headers.get("host");
  if (
    !origin ||
    request.nextUrl.origin !== origin ||
    (host && host.toLowerCase() !== new URL(origin).host.toLowerCase())
  ) {
    return NextResponse.json(
      { error: "Authentication callback origin is not allowed." },
      {
        status: 403,
        headers: {
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }
  const failed = () => redirect(origin, "/login?auth_error=confirmation");
  if (privateProfileEnabled()) return failed();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return failed();
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const hash = params.get("token_hash");
  const type = params.get("type");
  try {
    if (
      code &&
      !hash &&
      code.length <= 2048 &&
      params.getAll("code").length === 1
    ) {
      const result = await supabase.auth.exchangeCodeForSession(code);
      if (result.error) return failed();
    } else if (
      !code &&
      hash &&
      /^[a-zA-Z0-9_-]{20,512}$/.test(hash) &&
      type &&
      otpTypes.has(type) &&
      params.getAll("token_hash").length === 1 &&
      params.getAll("type").length === 1
    ) {
      const result = await supabase.auth.verifyOtp({
        token_hash: hash,
        type: type as EmailOtpType,
      });
      if (result.error) return failed();
    } else return failed();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !cloudUserAllowed(user)) {
      await supabase.auth.signOut();
      return failed();
    }
    return redirect(origin, destination(params.get("next")));
  } catch {
    return failed();
  }
}
