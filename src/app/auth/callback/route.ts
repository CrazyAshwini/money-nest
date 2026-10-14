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
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 0x20)
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
  // Email links may be cross-site navigation; validate the destination, not Fetch Metadata.
  if (!origin) {
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
  const params = request.nextUrl.searchParams;
  const recovery =
    params.get("next") === "/reset-password" ||
    params.get("type") === "recovery";
  const failed = () =>
    redirect(
      origin,
      recovery
        ? "/login?auth_error=recovery"
        : "/login?auth_error=confirmation",
    );
  if (privateProfileEnabled()) return failed();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return failed();
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
