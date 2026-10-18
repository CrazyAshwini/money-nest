import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import { privateAuthPOST } from "@/lib/private-profile-http";
import {
  cloudRecoveryEmailAllowed,
  cloudSignupConfirmationEmailAllowed,
  cloudSignupEmailAllowed,
  cloudSignupEnabled,
  cloudUserAllowed,
} from "@/lib/cloud-owner";
import {
  cloudApplicationOrigin,
  cloudRequestAllowed,
} from "@/lib/cloud-request";

export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200, retryAfter?: number) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });

const emailInput = z.string().trim().toLowerCase().max(254).pipe(z.email());
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["login", "signup", "logout", "reset", "update-password"]),
    email: emailInput.optional(),
    password: z.string().min(8).max(128).optional(),
  }),
  z.strictObject({
    action: z.literal("verify-signup-otp"),
    email: emailInput,
    token: z
      .string()
      .max(32)
      .transform((value) => value.replace(/\s/g, ""))
      .pipe(z.string().regex(/^[0-9]{6}$/)),
  }),
  z.strictObject({
    action: z.literal("resend-signup-otp"),
    email: emailInput,
  }),
]);

// This is retry advice; Supabase Auth enforces the actual project-wide email
// frequency and verification limits, including across application instances.
const OTP_RETRY_AFTER = 60;
const invalidCode =
  "This code is invalid or has expired. Request a new code and try again.";

async function boundedBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) return { body: null, tooLarge: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel().catch(() => undefined);
        return { body: null, tooLarge: true };
      }
      chunks.push(value);
    }
    return {
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      tooLarge: false,
    };
  } catch {
    return { body: null, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

function otpRateLimited(error: { status?: number; code?: string }) {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  );
}

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
  const body = await boundedBody(request);
  if (body.tooLarge) return response({ error: "Request is too large." }, 413);
  const parsed = input.safeParse(body.body);
  if (!parsed.success)
    return response(
      {
        error:
          "Enter valid account details. Email codes must contain six digits.",
      },
      400,
    );
  const { action, email } = parsed.data;

  if (action === "resend-signup-otp") {
    const origin = cloudApplicationOrigin(request);
    if (!origin)
      return response({ error: "Email verification is not configured." }, 503);
    // Do not reveal registration status; restricted mode still limits recipients.
    if (!cloudSignupConfirmationEmailAllowed(email))
      return response({ ok: true, retryAfter: OTP_RETRY_AFTER });
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: new URL("/auth/callback", origin).toString(),
        },
      });
      if (error) {
        if (otpRateLimited(error))
          return response(
            {
              error: "Please wait before requesting another code.",
              retryAfter: OTP_RETRY_AFTER,
            },
            429,
            OTP_RETRY_AFTER,
          );
        if (error.code === "user_not_found")
          return response({ ok: true, retryAfter: OTP_RETRY_AFTER });
        return response(
          { error: "We could not send a code. Please try again later." },
          503,
        );
      }
      return response({ ok: true, retryAfter: OTP_RETRY_AFTER });
    } catch {
      return response(
        { error: "We could not send a code. Please try again later." },
        503,
      );
    }
  }

  if (action === "verify-signup-otp") {
    if (!cloudSignupConfirmationEmailAllowed(email))
      return response({ error: invalidCode }, 400);
    const clearSession = async () => {
      try {
        await supabase.auth.signOut();
      } catch {
        // Never return success after an unavailable verification/session check.
      }
    };
    try {
      const result = await supabase.auth.verifyOtp({
        email,
        token: parsed.data.token,
        type: "email",
      });
      if (result.error) {
        if (otpRateLimited(result.error))
          return response(
            {
              error: "Too many code attempts. Please wait and try again.",
              retryAfter: OTP_RETRY_AFTER,
            },
            429,
            OTP_RETRY_AFTER,
          );
        return response({ error: invalidCode }, 400);
      }
      const session = result.data.session;
      if (
        typeof session?.access_token !== "string" ||
        !session.access_token ||
        typeof session.refresh_token !== "string" ||
        !session.refresh_token ||
        typeof session.user?.id !== "string" ||
        !session.user.id
      ) {
        await clearSession();
        return response(
          {
            error:
              "Email verification could not establish a session. Sign in or request a new code.",
            code: "session_unavailable",
          },
          401,
        );
      }
      // verifyOtp saves the session through our cookie-aware SSR client. Its
      // returned user is not authorization evidence; validate with Auth again.
      const verified = await supabase.auth.getUser();
      const user = verified.data.user;
      if (
        verified.error ||
        !cloudUserAllowed(user) ||
        typeof user?.email_confirmed_at !== "string" ||
        !user.email_confirmed_at.trim() ||
        user.email?.trim().toLowerCase() !== email ||
        user.id !== session.user.id
      ) {
        await clearSession();
        return response(
          { error: "Email verification is unavailable for this account." },
          403,
        );
      }
      return response({
        ok: true,
        authenticated: true,
        redirectTo: "/dashboard",
      });
    } catch {
      await clearSession();
      return response(
        { error: "We could not verify this code. Please try again." },
        503,
      );
    }
  }

  const { password } = parsed.data;
  if (action === "signup" && !cloudSignupEnabled())
    return response(
      {
        error:
          "This workspace is available to its owner. Sign in with your existing account.",
      },
      403,
    );
  if (action === "signup" && email && !cloudSignupEmailAllowed(email))
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
  if (action === "reset") {
    if (!email) return response({ error: "Enter a valid email address." }, 400);
    const origin = cloudApplicationOrigin(request);
    if (!origin)
      return response({ error: "Password recovery is not configured." }, 503);
    if (cloudRecoveryEmailAllowed(email)) {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: new URL(
            "/auth/callback?next=/reset-password",
            origin,
          ).toString(),
        });
        if (error && error.code !== "user_not_found")
          return response(
            {
              error: "We could not send a reset email. Please try again later.",
            },
            429,
          );
      } catch {
        return response(
          { error: "We could not send a reset email. Please try again later." },
          503,
        );
      }
    }
    // Keep the response the same for allowed and other email addresses.
    return response({ ok: true });
  }
  if (action === "update-password") {
    if (!password)
      return response(
        { error: "Enter a new password of at least 8 characters." },
        400,
      );
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !cloudUserAllowed(user)) {
      await supabase.auth.signOut();
      return response(
        {
          error:
            "This password-reset link is invalid or expired. Request another reset link and try again.",
        },
        401,
      );
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error)
      return response(
        {
          error: "The password could not be updated. Try a different password.",
        },
        400,
      );
    return response({ ok: true });
  }
  if (!email || !password)
    return response({ error: "Email and password are required." }, 400);
  let result;
  try {
    result =
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
  } catch {
    return response(
      { error: "We could not reach the sign-in service. Please try again." },
      503,
    );
  }
  if (action === "signup" && result.error && otpRateLimited(result.error))
    return response(
      {
        error: "Please wait before requesting another code.",
        retryAfter: OTP_RETRY_AFTER,
      },
      429,
      OTP_RETRY_AFTER,
    );
  if (
    action === "signup" &&
    result.error &&
    ["email_exists", "user_already_exists"].includes(result.error.code ?? "")
  )
    return response({
      ok: true,
      needsEmailConfirmation: true,
      retryAfter: OTP_RETRY_AFTER,
    });
  if (result.error)
    return response(
      {
        error:
          action === "login"
            ? "Sign-in failed. Your local profile password is separate from your cloud password. If you have not created a cloud account, create one and confirm your email; otherwise use Forgot your password."
            : "Sign-up could not be completed. Check your details or try again later.",
      },
      400,
    );
  // Workspaces require the existing email-code confirmation step. A
  // project with email confirmation disabled would return a session here;
  // remove it instead of silently treating signup as verified onboarding.
  if (action === "signup" && result.data.session) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Never report successful onboarding when cookie cleanup is unavailable.
    }
    return response(
      {
        error:
          "Email confirmation is required before signup can continue. Please contact Money Nest support.",
        code: "email_confirmation_required",
      },
      503,
    );
  }
  if (action === "login" && !result.data.session)
    return response(
      {
        error:
          "Sign-in failed. Your local profile password is separate from your cloud password. If you have not created a cloud account, create one and confirm your email; otherwise use Forgot your password.",
      },
      400,
    );
  if (result.data.session) {
    try {
      const verified = await supabase.auth.getUser();
      const user = verified.data.user;
      if (
        verified.error ||
        !cloudUserAllowed(user) ||
        user?.id !== result.data.session.user.id ||
        user.email?.trim().toLowerCase() !== email
      ) {
        await supabase.auth.signOut();
        return response(
          { error: "Sign-in is unavailable for this account." },
          403,
        );
      }
    } catch {
      try {
        await supabase.auth.signOut();
      } catch {
        // Authorization still fails if the Auth service cannot clear a session.
      }
      return response(
        { error: "We could not reach the sign-in service. Please try again." },
        503,
      );
    }
  }
  return response({
    ok: true,
    needsEmailConfirmation: action === "signup" && !result.data.session,
    ...(action === "signup" && !result.data.session
      ? { retryAfter: OTP_RETRY_AFTER }
      : {}),
  });
}
