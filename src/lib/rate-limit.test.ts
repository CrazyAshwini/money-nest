import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  rpc: vi.fn(),
  quotaResult: vi.fn(),
  privateEnabled: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("./private-profile-store", () => ({
  privateProfileEnabled: mocks.privateEnabled,
}));
import {
  requireRouteRateLimit,
  RouteRateLimitError,
  routeRateLimitResponse,
  type RateLimitBucket,
} from "./rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of [
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ])
    vi.stubEnv(key, "");
  mocks.privateEnabled.mockReturnValue(false);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.quotaResult });
  mocks.quotaResult.mockResolvedValue({
    data: { allowed: true, retryAfter: 0 },
    error: null,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("authenticated shared route limits", () => {
  it.each(["receipt", "bot", "orders", "documents"] as const)(
    "consumes the %s bucket without passing a caller owner, quota or time",
    async (bucket) => {
      await expect(
        requireRouteRateLimit(bucket, { ownerId: randomUUID(), cloud: true }),
      ).resolves.toBeUndefined();
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
        "consume_finance_rate_limit",
        { p_bucket: bucket },
      );
      expect(mocks.quotaResult).toHaveBeenCalledWith(expect.any(AbortSignal));
    },
  );

  it("returns the database's bounded retry delay and a private 429 response", async () => {
    mocks.quotaResult.mockResolvedValue({
      data: { allowed: false, retryAfter: 23 },
      error: null,
    });
    const error = await requireRouteRateLimit("receipt", {
      ownerId: randomUUID(),
      cloud: true,
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RouteRateLimitError);
    const response = routeRateLimitResponse(error as RouteRateLimitError);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "rate_limited" });
  });

  it.each([
    null,
    {},
    [],
    { allowed: true },
    { allowed: "true", retryAfter: 0 },
    { allowed: true, retryAfter: 1 },
    { allowed: false, retryAfter: 0 },
    { allowed: false, retryAfter: 61 },
    { allowed: false, retryAfter: 1.5 },
    { allowed: false, retryAfter: "30" },
  ])("fails closed on malformed shared decisions: %j", async (data) => {
    mocks.quotaResult.mockResolvedValue({ data, error: null });
    await expect(
      requireRouteRateLimit("receipt", { ownerId: randomUUID(), cloud: true }),
    ).rejects.toMatchObject({ code: "rate_limit_unavailable", status: 503 });
  });

  it.each([undefined, null])(
    "fails closed on a malformed RPC response envelope: %j",
    async (response) => {
      mocks.quotaResult.mockResolvedValue(response);
      await expect(
        requireRouteRateLimit("receipt", {
          ownerId: randomUUID(),
          cloud: true,
        }),
      ).rejects.toMatchObject({ code: "rate_limit_unavailable", status: 503 });
    },
  );

  it.each(["client missing", "RPC error", "network exception"])(
    "never uses private counters for a hosted %s",
    async (failure) => {
      mocks.privateEnabled.mockReturnValue(true);
      if (failure === "client missing") mocks.client.mockResolvedValue(null);
      if (failure === "RPC error")
        mocks.quotaResult.mockResolvedValue({
          data: null,
          error: { message: "internal" },
        });
      if (failure === "network exception")
        mocks.quotaResult.mockRejectedValue(new Error("internal"));
      await expect(
        requireRouteRateLimit("receipt", {
          ownerId: randomUUID(),
          cloud: true,
        }),
      ).rejects.toMatchObject({ code: "rate_limit_unavailable", status: 503 });
    },
  );

  it.each([
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ])("refuses a private fallback when %s indicates deployment", async (key) => {
    vi.stubEnv(key, key === "VERCEL" ? "1" : "synthetic-deployment");
    mocks.privateEnabled.mockReturnValue(true);
    await expect(
      requireRouteRateLimit("receipt", { ownerId: randomUUID(), cloud: false }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("requires explicit private persistence and a verified identity for local fallback", async () => {
    await expect(
      requireRouteRateLimit("receipt", { ownerId: randomUUID(), cloud: false }),
    ).rejects.toMatchObject({ status: 503 });
    mocks.privateEnabled.mockReturnValue(true);
    await expect(
      requireRouteRateLimit("receipt", { ownerId: "", cloud: false }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    ["receipt", 10],
    ["bot", 20],
    ["orders", 10],
    ["documents", 20],
  ] as const)(
    "limits private %s requests, isolates owners/buckets, and resets after sixty seconds",
    async (bucket, count) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      mocks.privateEnabled.mockReturnValue(true);
      const identity = { ownerId: randomUUID(), cloud: false };
      for (let index = 0; index < count; index++)
        await requireRouteRateLimit(bucket, identity);
      await expect(
        requireRouteRateLimit(bucket, identity),
      ).rejects.toMatchObject({ status: 429, retryAfter: 60 });
      await expect(
        requireRouteRateLimit(bucket, { ...identity, ownerId: randomUUID() }),
      ).resolves.toBeUndefined();
      const otherBucket: RateLimitBucket =
        bucket === "receipt" ? "bot" : "receipt";
      await expect(
        requireRouteRateLimit(otherBucket, identity),
      ).resolves.toBeUndefined();
      vi.advanceTimersByTime(59_001);
      await expect(
        requireRouteRateLimit(bucket, identity),
      ).rejects.toMatchObject({ status: 429, retryAfter: 1 });
      vi.advanceTimersByTime(999);
      await expect(
        requireRouteRateLimit(bucket, identity),
      ).resolves.toBeUndefined();
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );
});
