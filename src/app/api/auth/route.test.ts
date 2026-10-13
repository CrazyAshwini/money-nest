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

function request(body: Record<string, unknown>) {
  return new NextRequest("https://money-nest.example/api/auth", {
    method: "POST",
    headers: {
      host: "money-nest.example",
      origin: "https://money-nest.example",
      "content-type": "application/json",
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
});

afterEach(() => vi.unstubAllEnvs());

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
