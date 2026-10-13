import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cloudUserAllowed } from "@/lib/cloud-owner";
import { cloudRequestAllowed } from "@/lib/cloud-request";
import { readCloudProfile } from "@/lib/cloud-profile";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import {
  privateAuthPOST,
  privateProfileGET,
  privateResponse,
} from "@/lib/private-profile-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (privateProfileEnabled()) return privateProfileGET(request);
  if (!cloudRequestAllowed(request))
    return privateResponse({ error: "Request origin is not allowed." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return privateResponse({ error: "Cloud storage is not configured." }, 503);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous)
    return privateResponse({ error: "Sign in to your profile." }, 401);
  if (!cloudUserAllowed(user))
    return privateResponse(
      { error: "This account cannot access the workspace." },
      403,
    );
  try {
    return privateResponse({
      profile: await readCloudProfile(supabase, user),
      backend: "supabase",
    });
  } catch {
    return privateResponse(
      { error: "Your profile could not be loaded. Please retry." },
      503,
    );
  }
}
export async function POST(request: NextRequest) {
  if (privateProfileEnabled()) return privateAuthPOST(request);
  return privateResponse({ error: "Use the profile update form." }, 405);
}

const update = z
  .object({ displayName: z.string().trim().min(1).max(80) })
  .strict();
export async function PATCH(request: NextRequest) {
  if (privateProfileEnabled())
    return privateResponse(
      { error: "Use the local profile update form." },
      405,
    );
  if (!cloudRequestAllowed(request, true))
    return privateResponse({ error: "Request origin is not allowed." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return privateResponse({ error: "Cloud storage is not configured." }, 503);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous)
    return privateResponse({ error: "Sign in to your profile." }, 401);
  if (!cloudUserAllowed(user))
    return privateResponse(
      { error: "This account cannot access the workspace." },
      403,
    );
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return privateResponse({ error: "Request is too large." }, 413);
  const parsed = update.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return privateResponse(
      { error: "Enter a profile name of 1 to 80 characters." },
      400,
    );
  const saved = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      display_name: parsed.data.displayName,
      currency: "INR",
      timezone: "Asia/Kolkata",
    },
    { onConflict: "user_id" },
  );
  if (saved.error)
    return privateResponse(
      { error: "Your profile could not be saved. Please retry." },
      503,
    );
  try {
    return privateResponse({
      profile: await readCloudProfile(supabase, user),
      backend: "supabase",
    });
  } catch {
    return privateResponse(
      { error: "Profile saved. Reload your workspace to refresh it." },
      503,
    );
  }
}
