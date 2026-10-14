import "server-only";

/** Synthetic browser fixtures require a deliberately isolated, unhosted server. */
export function testFixturesEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (
    env.FINANCE_E2E_FIXTURES !== "1" ||
    env.FINANCE_PRIVATE_ENABLED !== "false"
  )
    return false;

  return ![
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FINANCE_CLOUD_OWNER_ID",
    "FINANCE_CLOUD_OWNER_EMAIL",
  ].some((key) => Boolean(env[key]?.trim()));
}
