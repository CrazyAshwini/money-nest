import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import { privateAuthPOST } from "@/lib/private-profile-http";
import {
  cloudSignupEmailAllowed,
  cloudSignupEnabled,
  cloudUserAllowed,
} from "@/lib/cloud-owner";
import {
  cloudApplicationOrigin,
  cloudRequestAllowed,
} from "@/lib/cloud-request";

export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

const input = z.object({
  action: z.enum(["login", "signup", "logout"]),
  email: z.string().trim().max(254).pipe(z.email()).optional(),
  password: z.string().min(8).max(128).optional(),
});
export async function POST(request: NextRequest) {
  if (privateProfileEnabled()) return privateAuthPOST(request);
  if (!cloudRequestAllowed(request, true))
    return response({ error: "Request origin is not allowed." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return response(
      {
        configured: false,
        error:
          "Supabase is not configured. Add your project URL and public key to .env.local.",
      },
      503,
    );
  if (Number(request.headers.get("content-length") || 0) > 8192)
    return response({ error: "Request is too large." }, 413);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return response(
      { error: "Enter a valid email and a password of at least 8 characters." },
      400,
    );
  const { action, email, password } = parsed.data;
  if (action === "signup" && !cloudSignupEnabled())
    return response(
      {
        error:
          "This workspace is available to its owner. Sign in with your existing account.",
      },
      403,
    );
  if (
    action === "signup" &&
    email &&
    !cloudSignupEmailAllowed(email)
  )
    return response(
      { error: "Sign-up is limited to the Money Nest owner account." },
      403,
    );
  if (action === "logout") {
    const { error } = await supabase.auth.signOut();
    return response(
      error ? { error: "Could not sign out. Try again." } : { ok: true },
      error ? 400 : 200,
    );
  }
  if (!email || !password)
    return response({ error: "Email and password are required." }, 400);
  const result =
    action === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: new URL(
              "/auth/callback",
              cloudApplicationOrigin(request)!,
            ).toString(),
          },
        });
  if (result.error)
    return response(
      {
        error:
          action === "login"
            ? "Sign-in failed. Check your credentials and email confirmation."
            : "Sign-up could not be completed. Check your details or try again later.",
      },
      400,
    );
  if (action === "login" && !result.data.session)
    return response(
      {
        error: "Sign-in failed. Check your credentials and email confirmation.",
      },
      400,
    );
  if (result.data.session) {
    const verified = await supabase.auth.getUser();
    if (verified.error || !cloudUserAllowed(verified.data.user)) {
      await supabase.auth.signOut();
      return response(
        { error: "Sign-in is unavailable for this account." },
        403,
      );
    }
  }
  return response({
    ok: true,
    needsEmailConfirmation: action === "signup" && !result.data.session,
  });
}
