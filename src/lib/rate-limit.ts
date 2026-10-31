import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase/server";
import { privateProfileEnabled } from "./private-profile-store";

const limits = { receipt: 10, bot: 20, orders: 10, documents: 20 } as const;
export type RateLimitBucket = keyof typeof limits;
type AuthenticatedIdentity = { ownerId: string; cloud: boolean };
type RateLimitClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;
const WINDOW_MS = 60_000;
const localCounters = new Map<string, { started: number; count: number }>();

export class RouteRateLimitError extends Error {
  constructor(
    public readonly code: "rate_limited" | "rate_limit_unavailable",
    message: string,
    public readonly status: 429 | 503,
    public readonly retryAfter: number,
  ) {
    super(message);
    this.name = "RouteRateLimitError";
  }
}

const unavailable = () =>
  new RouteRateLimitError(
    "rate_limit_unavailable",
    "Request limits could not be checked. Please retry shortly.",
    503,
    5,
  );
const exceeded = (retryAfter: number) =>
  new RouteRateLimitError(
    "rate_limited",
    "Too many requests. Please wait a minute and retry.",
    429,
    retryAfter,
  );

function hostedDeployment() {
  return Boolean(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.VERCEL_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
}

function consumeLocal(bucket: RateLimitBucket, ownerId: string) {
  const now = Date.now();
  for (const [key, counter] of localCounters)
    if (now - counter.started >= WINDOW_MS) localCounters.delete(key);
  const key = JSON.stringify([ownerId, bucket]);
  let counter = localCounters.get(key);
  if (!counter) {
    counter = { started: now, count: 0 };
    localCounters.set(key, counter);
  }
  if (counter.count >= limits[bucket])
    throw exceeded(
      Math.max(1, Math.ceil((counter.started + WINDOW_MS - now) / 1000)),
    );
  counter.count++;
}

/** Run only after authentication, before reading bodies, uploading, or calling AI. */
export async function requireRouteRateLimit(
  bucket: RateLimitBucket,
  identity: AuthenticatedIdentity,
  existingClient?: RateLimitClient,
) {
  if (!identity.ownerId || !Object.hasOwn(limits, bucket)) throw unavailable();
  if (!identity.cloud) {
    // A shared-backend outage must never activate an instance-local fallback.
    if (!privateProfileEnabled() || hostedDeployment()) throw unavailable();
    consumeLocal(bucket, identity.ownerId);
    return;
  }
  let result: unknown;
  try {
    const client = existingClient ?? (await createSupabaseServerClient());
    if (!client) throw unavailable();
    result = await client
      .rpc("consume_finance_rate_limit", { p_bucket: bucket })
      .abortSignal(AbortSignal.timeout(5000));
  } catch {
    throw unavailable();
  }
  if (!result || typeof result !== "object") throw unavailable();
  const { data, error } = result as { data?: unknown; error?: unknown };
  if (error || !data || typeof data !== "object") throw unavailable();
  const decision = data as { allowed?: unknown; retryAfter?: unknown };
  if (
    typeof decision.allowed !== "boolean" ||
    typeof decision.retryAfter !== "number" ||
    !Number.isInteger(decision.retryAfter) ||
    (decision.allowed
      ? decision.retryAfter !== 0
      : decision.retryAfter < 1 || decision.retryAfter > 60)
  )
    throw unavailable();
  if (!decision.allowed) throw exceeded(decision.retryAfter);
}

export function routeRateLimitResponse(error: RouteRateLimitError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    {
      status: error.status,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "Retry-After": String(error.retryAfter),
      },
    },
  );
}
