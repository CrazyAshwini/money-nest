import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceData } from "@/lib/types";

type Trace = {
  table: string;
  filters: [string, unknown][];
  record?: Record<string, unknown>;
};
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  getUser: vi.fn(),
  readState: vi.fn(),
  profile: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  saved: vi.fn(),
  rpc: vi.fn(),
  privateEnabled: vi.fn(),
  privateGET: vi.fn(),
  privatePOST: vi.fn(),
  traces: [] as Trace[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("@/lib/supabase/commerce-store", () => ({
  readCloudFinanceState: mocks.readState,
}));
vi.mock("@/lib/cloud-profile", () => ({ readCloudProfile: mocks.profile }));
vi.mock("@/lib/private-profile-store", () => ({
  privateProfileEnabled: mocks.privateEnabled,
}));
vi.mock("@/lib/private-profile-http", () => ({
  privateWorkspaceGET: mocks.privateGET,
  privateWorkspacePOST: mocks.privatePOST,
}));
import { GET, POST } from "./route";

const origin = "https://money-nest.example";
const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const bankA = "20000000-0000-4000-8000-000000000001";
const bankB = "20000000-0000-4000-8000-000000000002";
function workspace(): WorkspaceData {
  return {
    accounts: [],
    snapshots: [],
    transactions: [],
    bills: [],
    allocations: [],
    fixedDeposits: [],
    loans: [],
    emis: [],
    emiAllocations: [],
    groups: [],
    shares: [],
    settlements: [],
    reminders: [],
    auditEvents: [],
  };
}
function account(userId = a, id = bankA) {
  return {
    id,
    userId,
    name: "Synthetic bank",
    institution: "Imaginary",
    kind: "bank" as const,
    maskedSuffix: "1234",
    active: true,
  };
}
function session(id = a, overrides: Record<string, unknown> = {}) {
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id,
        email: `${id === a ? "alice" : "bob"}@example.test`,
        email_confirmed_at: "2026-01-01T00:00:00Z",
        ...overrides,
      },
    },
    error: null,
  });
}
function request(body?: unknown, query = "") {
  return new NextRequest(`${origin}/api/workspace${query}`, {
    method: body ? "POST" : "GET",
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
  mocks.traces.length = 0;
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("FINANCE_CLOUD_ACCESS_MODE", "public");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", a);
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "alice@example.test");
  mocks.privateEnabled.mockReturnValue(false);
  session();
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  mocks.readState.mockResolvedValue({
    workspace: workspace(),
    commerce: { orders: [], refunds: [], operations: [] },
    revision: "0",
  });
  mocks.profile.mockImplementation(
    async (_client: unknown, user: { id: string }) => ({
      id: user.id,
      displayName: "My profile",
    }),
  );
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.saved.mockResolvedValue({
    data: { id: bankA, user_id: a },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    const trace: Trace = { table, filters: [] };
    mocks.traces.push(trace);
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => {
        trace.filters.push([field, value]);
        return query;
      },
      upsert: (record: Record<string, unknown>, options: unknown) => {
        trace.record = record;
        return mocks.upsert(record, options);
      },
      single: mocks.saved,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated cloud workspace boundary", () => {
  it("starts each confirmed public user with an independent empty workspace without seeding or owner remapping", async () => {
    for (const id of [a, b]) {
      session(id);
      const response = await GET(
        request(undefined, `?userId=${id === a ? b : a}`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        authenticated: true,
        userId: id,
        workspace: workspace(),
        profile: { id },
      });
      expect(mocks.readState).toHaveBeenLastCalledWith(expect.anything(), id);
      expect(mocks.traces.at(-1)?.filters).toContainEqual(["user_id", id]);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([a, b])(
    "saves user %s's record under the authenticated ID and refreshes with both owner and record filters",
    async (id) => {
      session(id);
      const record = account(id, id === a ? bankA : bankB);
      mocks.saved.mockResolvedValue({
        data: { id: record.id, user_id: id },
        error: null,
      });
      const response = await POST(
        request({ collection: "accounts", record, userId: id === a ? b : a }),
      );
      expect(response.status).toBe(200);
      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: id, id: record.id }),
        { onConflict: "id" },
      );
      expect(mocks.traces.at(-1)).toMatchObject({
        table: "api_accounts",
        filters: [
          ["user_id", id],
          ["id", record.id],
        ],
      });
    },
  );
  it("refuses forged ownership before loading or changing either workspace", async () => {
    session(b);
    expect(
      (await POST(request({ collection: "accounts", record: account(a) })))
        .status,
    ).toBe(403);
    expect(mocks.readState).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a guessed foreign account link before attempting an insert", async () => {
    session(b);
    const record = {
      id: "30000000-0000-4000-8000-000000000002",
      userId: b,
      amount: "10.00",
      currency: "INR",
      kind: "expense",
      status: "posted",
      occurredOn: "2026-10-18",
      description: "Synthetic expense",
      fromAccountId: bankA,
      toAccountId: null,
    };
    const response = await POST(
      request({ collection: "transactions", record }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("linked account"),
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not retry or refresh when RLS rejects a guessed foreign record ID", async () => {
    session(b);
    mocks.upsert.mockResolvedValue({
      error: { code: "42501", message: "Private foreign record details" },
    });
    const response = await POST(
      request({ collection: "accounts", record: account(b, bankA) }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "You do not have permission to change this record.",
    });
    expect(mocks.traces).toHaveLength(1);
    expect(mocks.saved).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ email_confirmed_at: undefined }, { is_anonymous: true }])(
    "rejects an unconfirmed or anonymous session before data access: %j",
    async (overrides) => {
      session(b, overrides);
      expect((await GET(request())).status).toBe(
        overrides.is_anonymous ? 401 : 403,
      );
      const input = request({
        collection: "accounts",
        record: account(b, bankB),
      });
      expect((await POST(input)).status).toBe(
        overrides.is_anonymous ? 401 : 403,
      );
      expect(input.bodyUsed).toBe(false);
      expect(mocks.readState).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it("preserves private-profile delegation before cloud session or origin checks", async () => {
    mocks.privateEnabled.mockReturnValue(true);
    const expected = NextResponse.json({ backend: "local" });
    mocks.privateGET.mockResolvedValue(expected);
    const input = request();
    input.headers.delete("host");
    expect(await GET(input)).toBe(expected);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
