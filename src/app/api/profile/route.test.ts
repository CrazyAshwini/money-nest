import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  privateEnabled: vi.fn(),
  privateGET: vi.fn(),
  privatePOST: vi.fn(),
  filters: [] as [string, unknown][],
  writes: [] as Record<string, unknown>[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("@/lib/private-profile-store", () => ({
  privateProfileEnabled: mocks.privateEnabled,
}));
vi.mock("@/lib/private-profile-http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/private-profile-http")>()),
  privateProfileGET: mocks.privateGET,
  privateAuthPOST: mocks.privatePOST,
}));
import { GET, PATCH } from "./route";

const origin = "https://money-nest.example";
const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const profiles = new Map<string, Record<string, unknown>>();
function session(id: string) {
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id,
        email: `${id === a ? "alice" : "bob"}@example.test`,
        email_confirmed_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    },
    error: null,
  });
}
function request(body?: Record<string, unknown>, query = "") {
  return new NextRequest(`${origin}/api/profile${query}`, {
    method: body ? "PATCH" : "GET",
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters.length = 0;
  mocks.writes.length = 0;
  profiles.clear();
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "public");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", a);
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "alice@example.test");
  mocks.privateEnabled.mockReturnValue(false);
  session(a);
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  });
  mocks.from.mockImplementation(() => {
    let selected: string;
    const query = {
      select: () => query,
      eq: (field: string, value: string) => {
        mocks.filters.push([field, value]);
        selected = value;
        return query;
      },
      maybeSingle: async () => ({
        data: profiles.get(selected) ?? null,
        error: null,
      }),
      upsert: async (row: Record<string, unknown>) => {
        mocks.writes.push(row);
        profiles.set(row.user_id as string, row);
        return { error: null };
      },
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("public cloud profiles are session scoped", () => {
  it("returns each new user's own empty profile and email without seeding any financial data", async () => {
    for (const id of [a, b]) {
      session(id);
      const response = await GET(
        request(undefined, `?userId=${id === a ? b : a}`),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        profile: {
          id,
          displayName: "My profile",
          email: `${id === a ? "alice" : "bob"}@example.test`,
        },
      });
      expect(mocks.filters.at(-1)).toEqual(["user_id", id]);
    }
    expect(mocks.writes).toEqual([]);
  });
  it("updates two names independently without changing the other user's profile", async () => {
    for (const [id, displayName] of [
      [a, "Alice"],
      [b, "Bob"],
    ]) {
      session(id);
      const response = await PATCH(request({ displayName }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        profile: { id, displayName },
      });
      expect(mocks.writes.at(-1)).toMatchObject({
        user_id: id,
        display_name: displayName,
      });
    }
    session(a);
    expect(await (await GET(request())).json()).toMatchObject({
      profile: { id: a, displayName: "Alice" },
    });
    expect(profiles.get(b)?.display_name).toBe("Bob");
  });
  it("rejects client-supplied user ownership fields rather than updating another profile", async () => {
    session(b);
    expect(
      (await PATCH(request({ displayName: "Forged", userId: a }))).status,
    ).toBe(400);
    expect(mocks.writes).toEqual([]);
  });
  it("does not reveal foreign profile data even if the database unexpectedly returns it", async () => {
    profiles.set(b, { user_id: a, display_name: "Private Alice" });
    session(b);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "Private Alice",
    );
  });
  it("keeps public profile access disabled when owner-only mode is retained", async () => {
    vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "owner");
    session(b);
    expect((await GET(request())).status).toBe(403);
    expect((await PATCH(request({ displayName: "Bob" }))).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
