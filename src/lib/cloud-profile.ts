import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { UserProfile } from "./profile-types";

export async function readCloudProfile(
  supabase: SupabaseClient,
  user: User,
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,display_name,created_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error("CLOUD_PROFILE_UNAVAILABLE");
  return {
    id: user.id,
    displayName:
      typeof data?.display_name === "string" && data.display_name.trim()
        ? data.display_name.trim()
        : "My profile",
    ...(user.email ? { email: user.email } : {}),
    currency: "INR",
    timezone: "Asia/Kolkata",
    createdAt: data?.created_at ?? user.created_at,
  };
}
