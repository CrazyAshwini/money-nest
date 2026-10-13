import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffPlan } from "@/lib/handoff-import";
import type { WorkspaceData } from "@/lib/types";

type QueryResult = {
  data: unknown;
  error: null | { code?: string; message?: string };
};
type QueryTrace = {
  table: string;
  selection: string | null;
  filters: [string, string, unknown][];
  upsert?: unknown;
  conflict?: unknown;
  limit?: number;
};
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  readState: vi.fn(),
  plan: vi.fn(),
  lookup: vi.fn(),
  stage: vi.fn(),
  list: vi.fn(),
  sources: vi.fn(),
  traces: [] as QueryTrace[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("@/lib/supabase/commerce-store", () => ({
  readCloudFinanceState: mocks.readState,
}));
vi.mock("@/lib/handoff-import", () => ({ planHandoffImport: mocks.plan }));
import { GET, POST } from "./route";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_EMAIL = "owner@example.test";
const BATCH_ID = "20000000-0000-4000-8000-000000000002";
const ACCOUNT_ID = "30000000-0000-4000-8000-000000000003";
const TRANSACTION_ID = "40000000-0000-4000-8000-000000000004";
const SOURCE_ID = "50000000-0000-4000-8000-000000000005";
const syntheticManifest = {
  currency: "INR",
  as_of: "2026-01-03",
  transactions: [],
};

class MockQuery implements PromiseLike<QueryResult> {
  constructor(readonly trace: QueryTrace) {}
  select(value: string) {
    this.trace.selection = value;
    return this;
  }
  eq(field: string, value: unknown) {
    this.trace.filters.push(["eq", field, value]);
    return this;
  }
  neq(field: string, value: unknown) {
    this.trace.filters.push(["neq", field, value]);
    return this;
  }
  order() {
    return this;
  }
  limit(value: number) {
    this.trace.limit = value;
    return this;
  }
  upsert(value: unknown, conflict: unknown) {
    this.trace.upsert = value;
    this.trace.conflict = conflict;
    return this;
  }
  async maybeSingle(): Promise<QueryResult> {
    return mocks.lookup();
  }
  async single(): Promise<QueryResult> {
    return mocks.stage();
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const response =
      this.trace.table === "finance_source_observations"
        ? mocks.sources()
        : mocks.list();
    return Promise.resolve(response).then(onfulfilled, onrejected);
  }
}
function emptyWorkspace(): WorkspaceData {
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
function populatedWorkspace(): WorkspaceData {
  return {
    ...emptyWorkspace(),
    accounts: [
      {
        id: ACCOUNT_ID,
        userId: OWNER_ID,
        name: "Synthetic bank",
        institution: "Imaginary",
        kind: "bank",
        maskedSuffix: "1234",
        active: true,
      },
    ],
  };
}
function plan(): HandoffPlan {
  return {
    workspace: populatedWorkspace(),
    changes: {
      ...emptyWorkspace(),
      transactions: [
        {
          id: TRANSACTION_ID,
          userId: OWNER_ID,
          amount: "10.00",
          currency: "INR",
          kind: "expense",
          status: "posted",
          occurredOn: "2026-01-02",
          description: "Synthetic expense",
          fromAccountId: ACCOUNT_ID,
          toAccountId: null,
          sourceSystem: "notion",
          sourceObjectId: SOURCE_ID,
        },
      ],
    },
    sources: [
      {
        collection: "transactions",
        recordId: TRANSACTION_ID,
        sourceSystem: "notion",
        sourceObjectId: SOURCE_ID,
        evidence: { row: 1 },
        confirmationState: "confirmed",
      },
    ],
    reviewItems: [],
    counters: {
      created: 1,
      matched: 0,
      updated: 0,
      ignored: 0,
      needsConfirmation: 0,
      transactionsCreated: 1,
    },
    checks: [],
    warnings: [],
  };
}
function request(
  body?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://money-nest.example/api/imports/handoff", {
    method: body ? "POST" : "GET",
    headers: {
      host: "money-nest.example",
      origin: "https://money-nest.example",
      "content-type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function savedBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    user_id: OWNER_ID,
    manifest: syntheticManifest,
    decisions: [],
    expected_revision: "7",
    preview: {},
    state: "staged",
    ...overrides,
  };
}
function trace(table: string) {
  return mocks.traces.find((entry) => entry.table === table);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.traces.length = 0;
  vi.stubEnv("APP_URL", "https://money-nest.example");
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: OWNER_ID,
        email: OWNER_EMAIL,
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
    },
    error: null,
  });
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  mocks.from.mockImplementation((table: string) => {
    const queryTrace: QueryTrace = { table, selection: null, filters: [] };
    mocks.traces.push(queryTrace);
    return new MockQuery(queryTrace);
  });
  mocks.lookup.mockReturnValue({ data: savedBatch(), error: null });
  mocks.stage.mockReturnValue({ data: { id: BATCH_ID }, error: null });
  mocks.list.mockReturnValue({
    data: [
      {
        id: BATCH_ID,
        preview: {},
        state: "staged",
        decisions: [],
        created_at: "2026-01-03T00:00:00.000Z",
      },
    ],
    error: null,
  });
  mocks.sources.mockReturnValue({ data: [], error: null });
  mocks.readState.mockResolvedValue({
    workspace: populatedWorkspace(),
    commerce: { orders: [], refunds: [], operations: [] },
    revision: "7",
  });
  mocks.plan.mockReturnValue(plan());
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated private handoff route", () => {
  it("returns saved reviews with private no-store headers and owner filters, without raw manifest selection", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await response.json()).toMatchObject({
      batches: [
        {
          id: BATCH_ID,
          state: "staged",
          createdAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    });
    expect(trace("finance_handoff_batches")).toMatchObject({
      selection: "id,preview,state,decisions,created_at",
      filters: [
        ["eq", "user_id", OWNER_ID],
        ["neq", "state", "complete"],
      ],
      limit: 5,
    });
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation before authenticating or reading financial data", async () => {
    const response = await POST(
      request(
        { action: "preview", manifest: syntheticManifest },
        { origin: "https://untrusted.example" },
      ),
    );
    expect(response.status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a verified session before reading or planning a handoff", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(
      request({ action: "preview", manifest: syntheticManifest }),
    );
    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.readState).not.toHaveBeenCalled();
  });

  it.each([
    {
      email: "another@example.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    {
      email: OWNER_EMAIL,
      is_anonymous: true,
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    { email: OWNER_EMAIL },
  ])(
    "rejects a session that is not the confirmed permitted owner: %j",
    async (user) => {
      mocks.getUser.mockResolvedValue({
        data: { user: { id: OWNER_ID, ...user } },
        error: null,
      });
      const response = await POST(
        request({ action: "preview", manifest: syntheticManifest }),
      );
      expect(response.status).toBe(403);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.plan).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("cannot commit a supplied manifest without a saved owned stage", async () => {
    const response = await POST(
      request({ action: "commit", manifest: syntheticManifest }),
    );
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("filters saved batch by both ID and owner and refuses a missing or foreign stage", async () => {
    mocks.lookup.mockReturnValue({ data: null, error: null });
    const response = await POST(
      request({
        action: "commit",
        batchId: BATCH_ID,
        manifest: syntheticManifest,
      }),
    );
    expect(response.status).toBe(404);
    expect(trace("finance_handoff_batches")?.filters).toEqual([
      ["eq", "id", BATCH_ID],
      ["eq", "user_id", OWNER_ID],
    ]);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses saved stage evidence rather than a client manifest override and validates RPC records", async () => {
    const injected = {
      ...syntheticManifest,
      transactions: [{ description: "Unreviewed replacement" }],
    };
    const response = await POST(
      request({ action: "commit", batchId: BATCH_ID, manifest: injected }),
    );
    expect(response.status).toBe(200);
    expect(mocks.plan.mock.calls[0][0]).toEqual(syntheticManifest);
    expect(mocks.plan.mock.calls[0][0]).not.toEqual(injected);
    expect(trace("finance_source_observations")?.filters).toEqual([
      ["eq", "user_id", OWNER_ID],
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "merge_finance_handoff",
      expect.objectContaining({
        p_batch_id: BATCH_ID,
        p_expected_revision: "7",
        p_changes: {
          transactions: [
            expect.objectContaining({
              id: TRANSACTION_ID,
              userId: OWNER_ID,
              amount: "10.00",
            }),
          ],
        },
        p_sources: plan().sources,
      }),
    );
    expect(mocks.traces.every((entry) => !entry.upsert)).toBe(true);
  });

  it("rejects a stale saved revision before calling the atomic RPC", async () => {
    mocks.lookup.mockReturnValue({
      data: savedBatch({ expected_revision: "6" }),
      error: null,
    });
    const response = await POST(
      request({ action: "commit", batchId: BATCH_ID }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("another device"),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.traces.every((entry) => !entry.upsert)).toBe(true);
  });

  it("requires changed decisions to be saved in a preview before commit", async () => {
    const decisions = [{ sourceObjectId: SOURCE_ID, action: "skip" }];
    const response = await POST(
      request({ action: "commit", batchId: BATCH_ID, decisions }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("save your decisions"),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    const updatedPreview = await POST(
      request({ action: "preview", batchId: BATCH_ID, decisions }),
    );
    expect(updatedPreview.status).toBe(200);
    expect(mocks.traces.find((entry) => entry.upsert)?.upsert).toMatchObject({
      id: BATCH_ID,
      user_id: OWNER_ID,
      decisions,
      expected_revision: "7",
    });
    mocks.lookup.mockReturnValue({
      data: savedBatch({ decisions }),
      error: null,
    });
    expect(
      (await POST(request({ action: "commit", batchId: BATCH_ID, decisions })))
        .status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("stages on a nonempty workspace without modifying financial rows", async () => {
    const response = await POST(
      request({ action: "preview", manifest: syntheticManifest }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      batchId: BATCH_ID,
      preview: { counters: { created: 1 } },
    });
    expect(mocks.plan).toHaveBeenCalledWith(
      syntheticManifest,
      populatedWorkspace(),
      OWNER_ID,
      [],
      [],
    );
    const staged = mocks.traces.find((entry) => entry.upsert);
    expect(staged).toMatchObject({
      table: "finance_handoff_batches",
      conflict: { onConflict: "user_id,input_hash" },
      upsert: {
        user_id: OWNER_ID,
        manifest: syntheticManifest,
        decisions: [],
        expected_revision: "7",
        state: "staged",
      },
    });
    expect((staged?.upsert as { input_hash: string }).input_hash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.traces.map((entry) => entry.table)).toEqual([
      "finance_source_observations",
      "finance_handoff_batches",
    ]);
  });

  it.each([
    { code: "40001", status: 409 },
    { code: "23503", status: 400 },
  ])(
    "reports atomic RPC refusal without writing a fallback after $code",
    async ({ code, status }) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code, message: "Private internal database details" },
      });
      const response = await POST(
        request({ action: "commit", batchId: BATCH_ID }),
      );
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(JSON.stringify(body)).not.toContain(
        "Private internal database details",
      );
      expect(body).not.toHaveProperty("ok");
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expect(mocks.traces.every((entry) => !entry.upsert)).toBe(true);
    },
  );

  it("refuses an invalid changed financial record before the merge RPC", async () => {
    const invalid = plan();
    invalid.changes.transactions[0].amount = "10.001";
    mocks.plan.mockReturnValue(invalid);
    const response = await POST(
      request({ action: "commit", batchId: BATCH_ID }),
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
