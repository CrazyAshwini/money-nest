import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import { privateAuthPOST } from "@/lib/private-profile-http";

const input = z.object({
  action: z.enum(["login", "signup", "logout"]),
  email: z.email().optional(),
  password: z.string().min(8).max(128).optional(),
});
export async function POST(request: NextRequest) {
  if (privateProfileEnabled()) return privateAuthPOST(request);
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== request.nextUrl.origin
  )
    return NextResponse.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json(
      {
        configured: false,
        error:
          "Supabase is not configured. Add your project URL and public key to .env.local.",
      },
      { status: 503 },
    );
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Enter a valid email and a password of at least 8 characters." },
      { status: 400 },
    );
  const { action, email, password } = parsed.data;
  if (action === "logout") {
    const { error } = await supabase.auth.signOut();
    return NextResponse.json(
      error ? { error: "Could not sign out. Try again." } : { ok: true },
      { status: error ? 400 : 200 },
    );
  }
  if (!email || !password)
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  const result =
    action === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
  if (result.error)
    return NextResponse.json(
      {
        error:
          action === "login"
            ? "Sign-in failed. Check your credentials and email confirmation."
            : "Sign-up could not be completed. Check your details or try again later.",
      },
      { status: 400 },
    );
  return NextResponse.json(
    {
      ok: true,
      needsEmailConfirmation: action === "signup" && !result.data.session,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
