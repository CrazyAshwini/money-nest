import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_EMAIL = "owner@example.test";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  privateProfileEnabled: vi.fn(),
  privateAuthPOST: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("@/lib/private-profile-store", () => ({
  privateProfileEnabled: mocks.privateProfileEnabled,
}));
vi.mock("@/lib/private-profile-http", () => ({
  privateAuthPOST: mocks.privateAuthPOST,
}));

import { POST } from "./route";

function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://money-nest.example/api/auth", {
    method: "POST",
    headers: {
      host: "money-nest.example",
      origin: "https://money-nest.example",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "https://money-nest.example");
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
  vi.stubEnv("FINANCE_PRIVATE_ENABLED", "false");
  mocks.privateProfileEnabled.mockReturnValue(false);
  mocks.client.mockResolvedValue({
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      verifyOtp: mocks.verifyOtp,
      resend: mocks.resend,
    },
  });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: OWNER_ID,
        email: OWNER_EMAIL,
        email_confirmed_at: "2026-10-01T00:00:00.000Z",
      },
    },
    error: null,
  });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.signInWithPassword.mockResolvedValue({
    data: { user: ownerUser(), session: ownerSession() },
    error: null,
  });
  mocks.signUp.mockResolvedValue({
    data: { user: ownerUser(), session: null },
    error: null,
  });
  mocks.verifyOtp.mockResolvedValue({
    data: { user: ownerUser(), session: ownerSession() },
    error: null,
  });
  mocks.resend.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

function ownerUser(overrides: Record<string, unknown> = {}) {
  return {
    id: OWNER_ID,
    email: OWNER_EMAIL,
    email_confirmed_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function ownerSession(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "synthetic-session-token",
    refresh_token: "synthetic-refresh-token",
    user: ownerUser(),
    ...overrides,
  };
}

function verifyRequest(overrides: Record<string, unknown> = {}) {
  return request({
    action: "verify-signup-otp",
    email: OWNER_EMAIL,
    token: "012345",
    ...overrides,
  });
}

describe("cloud signup and existing authentication", () => {
  it("keeps unconfirmed signup outside an authenticated session", async () => {
    const result = await POST(
      request({
        action: "signup",
        email: OWNER_EMAIL,
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      ok: true,
      needsEmailConfirmation: true,
      retryAfter: 60,
    });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: OWNER_EMAIL,
      password: "cloud-password",
      options: { emailRedirectTo: "https://money-nest.example/auth/callback" },
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("continues denying signup for unrelated email addresses", async () => {
    const result = await POST(
      request({
        action: "signup",
        email: "other@example.test",
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(403);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("keeps new signup disabled when an owner ID has been configured", async () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", OWNER_ID);
    const result = await POST(
      request({
        action: "signup",
        email: OWNER_EMAIL,
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(403);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("keeps signup closed when no owner email is configured", async () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "");
    const result = await POST(
      request({
        action: "signup",
        email: OWNER_EMAIL,
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(403);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("preserves existing confirmed-owner password login", async () => {
    const result = await POST(
      request({
        action: "login",
        email: OWNER_EMAIL,
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      ok: true,
      needsEmailConfirmation: false,
    });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: OWNER_EMAIL,
      password: "cloud-password",
    });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("continues denying password login without a session", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    const result = await POST(
      request({
        action: "login",
        email: OWNER_EMAIL,
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("keeps logout on the existing cookie-aware client", async () => {
    const result = await POST(request({ action: "logout" }));

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("normalizes provider signup rate limits without leaking provider details", async () => {
    mocks.signUp.mockResolvedValueOnce({
      error: { status: 429, message: "private provider detail" },
    });
    const result = await POST(
      request({
        action: "signup",
        email: OWNER_EMAIL,
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("60");
    expect(await result.json()).toEqual({
      error: "Please wait before requesting another code.",
      retryAfter: 60,
    });
  });

  it("handles unavailable signup services without logging secrets", async () => {
    mocks.signUp.mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await POST(
      request({
        action: "signup",
        email: OWNER_EMAIL,
        password: "cloud-password",
      }),
    );

    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      error: "We could not reach the sign-in service. Please try again.",
    });
  });
});

describe("cloud signup OTP verification", () => {
  it("verifies six digits including leading zeros and freshly authenticates the confirmed owner", async () => {
    const result = await POST(
      verifyRequest({
        email: ` ${OWNER_EMAIL.toUpperCase()} `,
        token: "0 12 345\n",
      }),
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      ok: true,
      authenticated: true,
      redirectTo: "/dashboard",
    });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: OWNER_EMAIL,
      token: "012345",
      type: "email",
    });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("allows a pending configured email to verify after its matching owner ID is configured", async () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", OWNER_ID);
    const result = await POST(verifyRequest());

    expect(result.status).toBe(200);
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("bases authorization on fresh getUser rather than the verify response user", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({
      data: {
        user: ownerUser({ email: "untrusted-response@example.test" }),
        session: ownerSession(),
      },
      error: null,
    });
    const result = await POST(verifyRequest());

    expect(result.status).toBe(200);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getUser.mock.invocationCallOrder[0],
    );
    expect(await result.text()).not.toContain("synthetic-session-token");
  });

  it.each([123456, "", "01234", "0123456", "12a456", "12-3456", null])(
    "rejects malformed code %j before contacting Supabase",
    async (token) => {
      const result = await POST(verifyRequest({ token }));

      expect(result.status).toBe(400);
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("rejects password and unexpected fields on OTP requests", async () => {
    const result = await POST(verifyRequest({ password: "cloud-password" }));

    expect(result.status).toBe(400);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each(["other@example.test", "invalid-email"])(
    "does not verify an unrelated or invalid email %s",
    async (email) => {
      const result = await POST(verifyRequest({ email }));

      expect(result.status).toBe(400);
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("does not verify without configured owner email, even when an owner ID exists", async () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "");
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", OWNER_ID);
    const result = await POST(verifyRequest());

    expect(result.status).toBe(400);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each(["otp_expired", "invalid_credentials"])(
    "handles invalid, expired or reused codes generically (%s)",
    async (code) => {
      mocks.verifyOtp.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { status: 403, code, message: "sensitive provider detail" },
      });
      const result = await POST(verifyRequest());

      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({
        error:
          "This code is invalid or has expired. Request a new code and try again.",
      });
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["unconfirmed", { email_confirmed_at: undefined }],
    ["anonymous", { is_anonymous: true }],
    ["unrelated email", { email: "other@example.test" }],
    [
      "different session identity",
      { id: "20000000-0000-4000-8000-000000000002" },
    ],
  ])(
    "rejects freshly checked %s users despite a successful verify response",
    async (_, overrides) => {
      mocks.getUser.mockResolvedValueOnce({
        data: { user: ownerUser(overrides) },
        error: null,
      });
      const result = await POST(verifyRequest());

      expect(result.status).toBe(403);
      expect(mocks.signOut).toHaveBeenCalledOnce();
      expect(await result.json()).toEqual({
        error: "Email verification is unavailable for this account.",
      });
    },
  );

  it("does not accept an unconfirmed matching owner ID", async () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", OWNER_ID);
    mocks.getUser.mockResolvedValueOnce({
      data: { user: ownerUser({ email_confirmed_at: "" }) },
      error: null,
    });
    const result = await POST(verifyRequest());

    expect(result.status).toBe(403);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("enforces the configured owner ID rather than accepting an email match alone", async () => {
    vi.stubEnv(
      "FINANCE_CLOUD_OWNER_ID",
      "20000000-0000-4000-8000-000000000002",
    );
    const result = await POST(verifyRequest());

    expect(result.status).toBe(403);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: ownerUser() }, error: { message: "fresh check failed" } },
  ])(
    "fails closed when getUser cannot authenticate the new session",
    async (verified) => {
      mocks.getUser.mockResolvedValueOnce(verified);
      const result = await POST(verifyRequest());

      expect(result.status).toBe(403);
      expect(mocks.signOut).toHaveBeenCalledOnce();
    },
  );

  it.each([
    null,
    ownerSession({ access_token: "" }),
    ownerSession({ refresh_token: "" }),
    ownerSession({ user: null }),
    ownerSession({ access_token: 123456 }),
  ])("rejects missing or incomplete session state", async (session) => {
    mocks.verifyOtp.mockResolvedValueOnce({
      data: { user: ownerUser(), session },
      error: null,
    });
    const result = await POST(verifyRequest());

    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "session_unavailable" });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("returns provider-enforced verification throttling with safe retry advice", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ error: { status: 429 } });
    const result = await POST(verifyRequest());

    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("60");
    expect(await result.json()).toEqual({
      error: "Too many code attempts. Please wait and try again.",
      retryAfter: 60,
    });
  });

  it.each(["verifyOtp", "getUser"] as const)(
    "fails safely when %s throws during verification",
    async (method) => {
      mocks[method].mockRejectedValueOnce(new Error("provider unavailable"));
      mocks.signOut.mockRejectedValueOnce(new Error("signout unavailable"));
      const result = await POST(verifyRequest());

      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({
        error: "We could not verify this code. Please try again.",
      });
      expect(mocks.signOut).toHaveBeenCalledOnce();
    },
  );
});

describe("cloud signup OTP resend", () => {
  it.each(["", OWNER_ID])(
    "resends only to the configured owner email with safe callback (owner ID %s)",
    async (ownerId) => {
      vi.stubEnv("FINANCE_CLOUD_OWNER_ID", ownerId);
      const result = await POST(
        request({
          action: "resend-signup-otp",
          email: OWNER_EMAIL.toUpperCase(),
        }),
      );

      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ ok: true, retryAfter: 60 });
      expect(mocks.resend).toHaveBeenCalledWith({
        type: "signup",
        email: OWNER_EMAIL,
        options: {
          emailRedirectTo: "https://money-nest.example/auth/callback",
        },
      });
      expect(mocks.signUp).not.toHaveBeenCalled();
    },
  );

  it("keeps unrelated addresses indistinguishable and never sends them mail", async () => {
    const result = await POST(
      request({ action: "resend-signup-otp", email: "other@example.test" }),
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, retryAfter: 60 });
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it("keeps resend closed without an allowlisted email even when the owner ID exists", async () => {
    vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "");
    vi.stubEnv("FINANCE_CLOUD_OWNER_ID", OWNER_ID);
    const result = await POST(
      request({ action: "resend-signup-otp", email: OWNER_EMAIL }),
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, retryAfter: 60 });
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it.each([
    { status: 429 },
    { status: 422, code: "over_email_send_rate_limit" },
    { status: 422, code: "over_request_rate_limit" },
  ])(
    "preserves provider-enforced rate limits and normalizes retry responses",
    async (error) => {
      mocks.resend.mockResolvedValueOnce({ error });
      const result = await POST(
        request({ action: "resend-signup-otp", email: OWNER_EMAIL }),
      );

      expect(result.status).toBe(429);
      expect(result.headers.get("retry-after")).toBe("60");
      expect(await result.json()).toEqual({
        error: "Please wait before requesting another code.",
        retryAfter: 60,
      });
    },
  );

  it.each([false, true])(
    "handles provider failures without exposing account details (throws %s)",
    async (throws) => {
      if (throws)
        mocks.resend.mockRejectedValueOnce(
          new Error("private provider detail"),
        );
      else
        mocks.resend.mockResolvedValueOnce({
          error: { status: 500, message: "private provider detail" },
        });
      const result = await POST(
        request({ action: "resend-signup-otp", email: OWNER_EMAIL }),
      );

      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({
        error: "We could not send a code. Please try again later.",
      });
    },
  );
});

describe("OTP request boundaries", () => {
  it.each(["verify-signup-otp", "resend-signup-otp"])(
    "rejects cross-origin %s before creating the Supabase client",
    async (action) => {
      const result = await POST(
        request(
          { action, email: OWNER_EMAIL, token: "012345" },
          { origin: "https://attacker.example" },
        ),
      );

      expect(result.status).toBe(403);
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );

  it("rejects spoofed hosts even when forwarded headers claim the configured origin", async () => {
    const result = await POST(
      request(
        { action: "verify-signup-otp", email: OWNER_EMAIL, token: "012345" },
        {
          host: "attacker.example",
          "x-forwarded-host": "money-nest.example",
          "x-forwarded-proto": "https",
        },
      ),
    );

    expect(result.status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([{}, { "content-length": "1" }] as Record<string, string>[])(
    "bounds streamed request bytes independently of Content-Length %j",
    async (headers) => {
      const result = await POST(
        request(
          {
            action: "verify-signup-otp",
            email: OWNER_EMAIL,
            token: "1".repeat(9000),
          },
          headers,
        ),
      );

      expect(result.status).toBe(413);
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
      expect(await result.json()).toEqual({ error: "Request is too large." });
    },
  );

  it("rejects oversized declared requests before consuming the body", async () => {
    const result = await POST(
      request(
        { action: "verify-signup-otp", email: OWNER_EMAIL, token: "012345" },
        { "content-length": "9000" },
      ),
    );

    expect(result.status).toBe(413);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("preserves private-profile delegation without creating a cloud client", async () => {
    mocks.privateProfileEnabled.mockReturnValueOnce(true);
    mocks.privateAuthPOST.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid private action." }), {
        status: 400,
      }),
    );
    const incoming = verifyRequest();
    const result = await POST(incoming);

    expect(result.status).toBe(400);
    expect(mocks.privateAuthPOST).toHaveBeenCalledWith(incoming);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("cloud password recovery", () => {
  it("sends recovery only to the configured owner email with the safe callback", async () => {
    const response = await POST(
      request({ action: "reset", email: OWNER_EMAIL.toUpperCase() }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
    const [, options] = mocks.resetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    const redirect = new URL(options.redirectTo);
    expect(redirect.origin).toBe("https://money-nest.example");
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.searchParams.get("next")).toBe("/reset-password");
  });

  it("keeps other email addresses indistinguishable and does not send them mail", async () => {
    const response = await POST(
      request({ action: "reset", email: "other@example.test" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("changes the password only for a verified owner session", async () => {
    const response = await POST(
      request({ action: "update-password", password: "new-cloud-password" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "new-cloud-password",
    });
  });

  it("rejects a non-owner session and signs it out", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: {
        user: {
          id: OWNER_ID,
          email: "other@example.test",
          email_confirmed_at: "2026-10-01T00:00:00.000Z",
        },
      },
      error: null,
    });

    const response = await POST(
      request({ action: "update-password", password: "new-cloud-password" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
