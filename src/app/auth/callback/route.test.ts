import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("@/lib/private-profile-store", () => ({
  privateProfileEnabled: () => false,
}));

import { GET } from "./route";

const origin = "https://money-nest.example";
const users = [
  {
    id: "20000000-0000-4000-8000-000000000002",
    email: "alice@example.test",
    email_confirmed_at: "2026-10-18T01:00:00Z",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    email: "bob@example.test",
    email_confirmed_at: "2026-10-18T02:00:00Z",
  },
];

function callback(query: string, extra: Record<string, string> = {}) {
  return new NextRequest(`${origin}/auth/callback?${query}`, {
    headers: {
      host: "money-nest.example",
      "sec-fetch-site": "cross-site",
      ...extra,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "public");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "10000000-0000-4000-8000-000000000001");
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "owner@example.test");
  mocks.client.mockResolvedValue({ auth: mocks });
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: users[0] }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("confirmed public account callbacks", () => {
  it.each(users)(
    "accepts a legitimate cross-site code link for $email using fresh Auth",
    async (user) => {
      mocks.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      const result = await GET(callback("code=synthetic-auth-code"));
      expect(result.headers.get("location")).toBe(`${origin}/dashboard`);
      expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith(
        "synthetic-auth-code",
      );
      expect(mocks.getUser).toHaveBeenCalledOnce();
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it.each(users)(
    "retains token-hash email fallback and password recovery for $email",
    async (user) => {
      mocks.getUser.mockResolvedValue({ data: { user }, error: null });
      const hash = "synthetic-email-token-hash";
      const email = await GET(callback(`token_hash=${hash}&type=email`));
      const recovery = await GET(
        callback(`token_hash=${hash}&type=recovery&next=/reset-password`),
      );
      expect(email.headers.get("location")).toBe(`${origin}/dashboard`);
      expect(recovery.headers.get("location")).toBe(`${origin}/reset-password`);
      expect(mocks.verifyOtp).toHaveBeenNthCalledWith(1, {
        token_hash: hash,
        type: "email",
      });
      expect(mocks.verifyOtp).toHaveBeenNthCalledWith(2, {
        token_hash: hash,
        type: "recovery",
      });
      expect(mocks.getUser).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { email_confirmed_at: undefined },
    { email_confirmed_at: "" },
    { is_anonymous: true },
    { email: undefined },
    { id: "not-a-uuid" },
  ])("rejects unconfirmed or malformed fresh identity %j", async (changes) => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { ...users[0], ...changes } },
      error: null,
    });
    const result = await GET(callback("code=synthetic-auth-code"));
    expect(result.headers.get("location")).toBe(
      `${origin}/login?auth_error=confirmation`,
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it.each(["owner", "PUBLIC"])(
    "does not admit public user when the rollout mode is %s",
    async (mode) => {
      vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", mode);
      const result = await GET(callback("code=synthetic-auth-code"));
      expect(result.headers.get("location")).toBe(
        `${origin}/login?auth_error=confirmation`,
      );
      expect(mocks.signOut).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "https://untrusted.example/steal",
    "//untrusted.example/steal",
    "/auth/callback",
    "/api/workspace",
  ])("does not follow an unsafe next destination %s", async (next) => {
    const result = await GET(
      callback(`code=synthetic-auth-code&next=${encodeURIComponent(next)}`),
    );
    expect(result.headers.get("location")).toBe(`${origin}/dashboard`);
  });

  it("rejects spoofed hosts before exchanging a public user's code", async () => {
    const result = await GET(
      callback("code=synthetic-auth-code", {
        host: "untrusted.example",
        "x-forwarded-host": "money-nest.example",
      }),
    );
    expect(result.status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
