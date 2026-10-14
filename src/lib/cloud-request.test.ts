import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canonical = "https://money-nest.example";
const preview = "https://money-nest-current.vercel.app";
const owner = "owner@example.test";
const mocks = vi.hoisted(() => ({
  reset: vi.fn(),
  exchange: vi.fn(),
  getUser: vi.fn(),
  client: vi.fn(),
  fetch: vi.fn(() => {
    throw new Error("Network disabled in origin regression tests");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("@/lib/private-profile-store", () => ({
  privateProfileEnabled: () => false,
}));
vi.mock("@/lib/private-profile-http", () => ({ privateAuthPOST: vi.fn() }));

import { cloudApplicationOrigin, cloudRequestAllowed } from "./cloud-request";
import { POST } from "@/app/api/auth/route";
import { GET } from "@/app/auth/callback/route";

function request(origin = canonical, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/workspace`, {
    headers: { host: new URL(origin).host, origin, ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", canonical);
  vi.stubEnv("VERCEL_URL", new URL(preview).host);
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", owner);
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.reset.mockResolvedValue({ error: null });
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: owner,
        email_confirmed_at: "2026-10-01T00:00:00Z",
      },
    },
    error: null,
  });
  mocks.client.mockResolvedValue({
    auth: {
      resetPasswordForEmail: mocks.reset,
      exchangeCodeForSession: mocks.exchange,
      getUser: mocks.getUser,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  });
});
afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("exact cloud application origins", () => {
  it.each([canonical, preview])(
    "allows same-origin writes and reads on %s",
    (origin) => {
      const input = request(origin);
      expect(cloudApplicationOrigin(input)).toBe(origin);
      expect(cloudRequestAllowed(input, true)).toBe(true);
      input.headers.delete("origin");
      expect(cloudRequestAllowed(input)).toBe(true);
      expect(cloudRequestAllowed(input, true)).toBe(false);
    },
  );
  it("allows only this explicitly configured preview, including without APP_URL", () => {
    vi.stubEnv("APP_URL", "");
    expect(cloudRequestAllowed(request(preview), true)).toBe(true);
    expect(
      cloudRequestAllowed(request("https://money-nest-old.vercel.app"), true),
    ).toBe(false);
    vi.stubEnv("VERCEL_URL", "");
    expect(cloudRequestAllowed(request(preview), true)).toBe(false);
  });
  it.each([canonical, preview])(
    "does not authorize one allowed domain from the other: %s",
    (origin) => {
      expect(
        cloudRequestAllowed(
          request(origin, {
            origin: origin === canonical ? preview : canonical,
          }),
          true,
        ),
      ).toBe(false);
    },
  );
  it.each([
    "",
    "null",
    "https://other.vercel.app",
    "http://money-nest.example",
    "https://money-nest.example:444",
    `${canonical}/`,
  ])("rejects an invalid or different supplied Origin: %s", (origin) => {
    expect(cloudRequestAllowed(request(canonical, { origin }), true)).toBe(
      false,
    );
    expect(cloudRequestAllowed(request(canonical, { origin }))).toBe(false);
  });
  it.each([
    "",
    "evil.example",
    "money-nest.example:444",
    "money-nest.example/path",
    "money-nest.example@evil.example",
    "money-nest.example, evil.example",
    "money-nest.example:0",
  ])("rejects missing, mismatched, or malformed actual Host: %s", (host) => {
    expect(cloudApplicationOrigin(request(canonical, { host }))).toBeNull();
  });
  it("ignores forged forwarded origins, preserving the actual request origin", () => {
    const input = request(preview, {
      "x-forwarded-proto": "https://attacker.example/#",
      "x-forwarded-host": "attacker.example",
    });
    expect(cloudApplicationOrigin(input)).toBe(preview);
    expect(cloudRequestAllowed(input, true)).toBe(true);
    input.headers.set("origin", "https://attacker.example");
    expect(cloudRequestAllowed(input, true)).toBe(false);
  });
  it.each(["cross-site", "same-site"])(
    "retains API Fetch Metadata rejection for %s",
    (site) => {
      expect(
        cloudRequestAllowed(
          request(canonical, { "sec-fetch-site": site }),
          true,
        ),
      ).toBe(false);
    },
  );
  it.each([
    "broken",
    "http://money-nest.example",
    `${canonical}/path`,
    `${canonical}?x=1`,
    `${canonical}#x`,
    "https://u:p@money-nest.example",
    "https://money-nest.example:0",
  ])(
    "fails closed for invalid APP_URL even with a deployment URL: %s",
    (configured) => {
      vi.stubEnv("APP_URL", configured);
      expect(cloudApplicationOrigin(request(preview))).toBeNull();
    },
  );
  it.each([
    "https://money-nest-current.vercel.app",
    "money-nest-current.vercel.app/path",
    "money-nest-current.vercel.app:444",
    "*.vercel.app",
    "money-nest-current.vercel.app,evil.example",
    "user@money-nest-current.vercel.app",
  ])("fails closed for invalid deployment configuration: %s", (host) => {
    vi.stubEnv("VERCEL_URL", host);
    expect(cloudApplicationOrigin(request(preview))).toBeNull();
  });
  it("requires Origin for writes without owner restriction too", () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "");
    const input = request();
    input.headers.delete("origin");
    expect(cloudRequestAllowed(input, true)).toBe(false);
  });
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://localhost",
  ])(
    "preserves an explicit loopback browser alias and complete port: %s",
    (origin) => {
      vi.stubEnv("APP_URL", origin);
      vi.stubEnv("VERCEL_URL", "");
      const input = request(origin);
      expect(cloudApplicationOrigin(input)).toBe(origin);
      expect(cloudRequestAllowed(input, true)).toBe(true);
      input.headers.set("origin", `${origin}:1`);
      expect(cloudRequestAllowed(input, true)).toBe(false);
    },
  );
  it("normalizes only default ports and rejects other ports or loopback aliases", () => {
    vi.stubEnv("APP_URL", "http://127.0.0.1:80");
    vi.stubEnv("VERCEL_URL", "");
    expect(
      cloudRequestAllowed(
        request("http://127.0.0.1", { host: "127.0.0.1:80" }),
        true,
      ),
    ).toBe(true);
    expect(
      cloudRequestAllowed(
        request("http://127.0.0.1", { origin: "http://localhost" }),
        true,
      ),
    ).toBe(false);
    expect(cloudRequestAllowed(request("http://127.0.0.1:3001"), true)).toBe(
      false,
    );
  });
  it("allows unconfigured local development but fails closed for restricted or remote deployments", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "");
    expect(cloudRequestAllowed(request("http://127.0.0.1:3000"), true)).toBe(
      true,
    );
    expect(cloudRequestAllowed(request(canonical), true)).toBe(false);
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", owner);
    expect(cloudRequestAllowed(request("http://127.0.0.1:3000"), true)).toBe(
      false,
    );
  });
});

describe("real auth handlers with synthetic provider responses", () => {
  it("rejects HTTP previews and malformed deployment config on canonical requests too", () => {
    expect(
      cloudRequestAllowed(request(preview.replace("https:", "http:")), true),
    ).toBe(false);
    vi.stubEnv("VERCEL_URL", "https://attacker.example/#");
    expect(cloudRequestAllowed(request(canonical), true)).toBe(false);
  });
  it("does not enter the workspace when the callback code cannot be exchanged", async () => {
    mocks.exchange.mockResolvedValueOnce({
      error: { message: "Synthetic invalid code" },
    });
    const response = await GET(
      new NextRequest(`${canonical}/auth/callback?code=invalid-code`, {
        headers: { host: new URL(canonical).host },
      }),
    );
    expect(response.headers.get("location")).toBe(
      `${canonical}/login?auth_error=confirmation`,
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("requires the verified owner after exchanging the callback code", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "20000000-0000-4000-8000-000000000002",
          email: "other@example.test",
          email_confirmed_at: "2026-10-01T00:00:00Z",
        },
      },
      error: null,
    });
    const response = await GET(
      new NextRequest(`${canonical}/auth/callback?code=synthetic-code`, {
        headers: { host: new URL(canonical).host },
      }),
    );
    expect(response.headers.get("location")).toBe(
      `${canonical}/login?auth_error=confirmation`,
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
  it("keeps a reset callback on the configured current deployment despite forwarding-header injection", async () => {
    const response = await POST(
      new NextRequest(`${preview}/api/auth`, {
        method: "POST",
        headers: {
          host: new URL(preview).host,
          origin: preview,
          "x-forwarded-proto": "https://attacker.example/#",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "reset", email: owner }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith(owner, {
      redirectTo: `${preview}/auth/callback?next=/reset-password`,
    });
  });
  it("rejects cross-origin reset before invoking auth or sending an email", async () => {
    const input = new NextRequest(`${preview}/api/auth`, {
      method: "POST",
      headers: {
        host: new URL(preview).host,
        origin: "https://other.vercel.app",
      },
      body: JSON.stringify({ action: "reset", email: owner }),
    });
    expect((await POST(input)).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(input.bodyUsed).toBe(false);
  });
  it.each([
    canonical,
    preview,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])(
    "exchanges a legitimate email callback and preserves destination origin: %s",
    async (origin) => {
      if (origin.startsWith("http:")) vi.stubEnv("APP_URL", origin);
      const input = new NextRequest(
        `${origin}/auth/callback?code=synthetic-code&next=/reset-password`,
        {
          headers: {
            host: new URL(origin).host,
            "sec-fetch-site": "cross-site",
            "x-forwarded-proto": "https://attacker.example/#",
          },
        },
      );
      const response = await GET(input);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${origin}/reset-password`);
      expect(mocks.exchange).toHaveBeenCalledWith("synthetic-code");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("rejects callback Host mismatch before consuming the auth code", async () => {
    const response = await GET(
      new NextRequest(`${canonical}/auth/callback?code=synthetic-code`, {
        headers: { host: "attacker.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
