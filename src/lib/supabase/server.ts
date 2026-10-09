import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

export async function createSupabaseServerClient() {
  const config = supabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        // Route handlers can set cookies. Server components rely on proxy refresh.
        try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {
          // Server Components cannot set cookies; proxy.ts refreshes them instead.
        }
      },
    },
  });
}
