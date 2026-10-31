import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceData } from "@/lib/types";

type Trace = {
  table: string;
  operation?: "insert" | "update" | "delete";
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
  mutation: vi.fn(),
  saved: vi.fn(),
  rpc: vi.fn(),
  privateEnabled: vi.fn(),
  privateGET: vi.fn(),
  privatePOST: vi.fn(),
  privateDELETE: vi.fn(),
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
  privateWorkspaceDELETE: mocks.privateDELETE,
}));
import { DELETE, GET, POST } from "./route";

const origin = "https://money-nest.example";
const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const bankA = "20000000-0000-4000-8000-000000000001";
const bankB = "20000000-0000-4000-8000-000000000002";
const originalVersion = "2026-11-01T00:00:00.123456+00:00";
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
function request(body?: unknown, query = "", method = body ? "POST" : "GET") {
  return new NextRequest(`${origin}/api/workspace${query}`, {
    method,
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
  mocks.mutation.mockResolvedValue({ data: [{id:bankA}], error: null });
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
      insert: (record: Record<string, unknown>) => {
        trace.operation = "insert";
        trace.record = record;
        return query;
      },
      update: (record: Record<string, unknown>) => {
        trace.operation = "update";
        trace.record = record;
        return query;
      },
      delete: () => { trace.operation = "delete"; return query; },
      single: mocks.saved,
      then: (resolve: (value: unknown) => unknown) =>
        mocks.mutation(trace).then(resolve),
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated cloud workspace boundary", () => {
  it("uses the exact original timestamp in an owner-scoped atomic update and never writes client timestamps", async () => {
    const state = workspace(); state.accounts=[{...account(),updatedAt:originalVersion}];
    mocks.readState.mockResolvedValue({workspace:state,commerce:{orders:[],refunds:[],operations:[]},revision:"0"});
    const result = await POST(request({collection:"accounts",record:{...account(),updatedAt:"2026-11-02T00:00:00Z"},expectedUpdatedAt:originalVersion}));
    expect(result.status).toBe(200);
    expect(mocks.traces[0]).toMatchObject({operation:"update",table:"accounts",filters:[
      ["id",bankA],["user_id",a],["updated_at",originalVersion],
    ]});
    expect(mocks.traces[0].record).not.toHaveProperty("updated_at");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("returns409 on a conditional update that found no current row without attempting insertion or refresh", async () => {
    const state = workspace(); state.accounts=[{...account(),updatedAt:originalVersion}];
    mocks.readState.mockResolvedValue({workspace:state,commerce:{orders:[],refunds:[],operations:[]},revision:"0"});
    mocks.mutation.mockResolvedValue({data:[],error:null});
    const result = await POST(request({collection:"accounts",record:account(),expectedUpdatedAt:originalVersion}));
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({code:"conflict"});
    expect(mocks.traces).toHaveLength(1);
    expect(mocks.traces[0].operation).toBe("update");
    expect(mocks.saved).not.toHaveBeenCalled();
  });
  it("rejects duplicate create IDs instead of retrying as an update", async () => {
    mocks.mutation.mockResolvedValue({error:{code:"23505",message:"Private index detail"}});
    const result = await POST(request({collection:"accounts",record:account()}));
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({code:"conflict"});
    expect(mocks.traces.map((trace) => trace.operation)).toEqual(["insert"]);
    expect(mocks.saved).not.toHaveBeenCalled();
  });
  it.each([null,"bad timestamp",123])("rejects invalid cloud update expectations before database writes: %s", async (expectedUpdatedAt) => {
    expect((await POST(request({collection:"accounts",record:account(),expectedUpdatedAt}))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("requires an original version for deletion and returns409 when that version no longer exists", async () => {
    const body = {collection:"accounts",id:bankA};
    expect((await DELETE(request(body,"","DELETE"))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.mutation.mockResolvedValue({data:[],error:null});
    const result = await DELETE(request({...body,expectedUpdatedAt:originalVersion},"","DELETE"));
    expect(result.status).toBe(409);
    expect(mocks.traces[0]).toMatchObject({operation:"delete",filters:[
      ["user_id",a],["id",bankA],["updated_at",originalVersion],
    ]});
  });
  it.each(["allocations","emiAllocations"] as const)("forwards the original version into %s RPC and maps atomic stale errors to409", async (collection) => {
    const state = workspace();
    state.accounts=[account(),{...account(a,bankB),kind:"credit_card"}];
    const transactionId="30000000-0000-4000-8000-000000000001";
    const targetId="40000000-0000-4000-8000-000000000001";
    const allocationId="50000000-0000-4000-8000-000000000001";
    const loanId="60000000-0000-4000-8000-000000000001";
    state.transactions=[{id:transactionId,userId:a,amount:"100.00",currency:"INR",kind:"bill_payment",status:"posted",occurredOn:"2026-10-18",description:"Synthetic repayment",fromAccountId:bankA,toAccountId:bankB}];
    if (collection === "emiAllocations") state.transactions[0].toAccountId = null;
    state.bills=[{id:targetId,userId:a,accountId:bankB,statementAmount:"100.00",statementDate:"2026-10-01",dueDate:"2026-10-25",periodStart:"2026-09-01",periodEnd:"2026-09-30"}];
    state.loans=[{id:loanId,userId:a,name:"Synthetic loan",lender:"Synthetic",kind:"institutional",contractualPrincipal:null,netDisbursed:null,reportedOutstanding:null,reportedAsOf:null,repaymentAccountId:bankA,disbursedOn:null}];
    state.emis=[{id:targetId,userId:a,loanId,number:1,dueDate:"2026-10-25",amount:"100.00"}];
    mocks.readState.mockResolvedValue({workspace:state,commerce:{orders:[],refunds:[],operations:[]},revision:"1"});
    mocks.rpc.mockResolvedValue({error:{code:"40001"}});
    const record=collection==="allocations"?{id:allocationId,userId:a,billId:targetId,transactionId,amount:"25.00",verified:false}:{id:allocationId,userId:a,emiId:targetId,transactionId,amount:"25.00"};
    if (collection === "allocations") state.allocations=[{...record, billId:targetId, verified:false, updatedAt:originalVersion}];
    else state.emiAllocations=[{...record, emiId:targetId, updatedAt:originalVersion}];
    const result=await POST(request({collection,record,expectedUpdatedAt:originalVersion}));
    expect(result.status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith(collection==="allocations"?"allocate_bill_payment":"allocate_emi_payment",expect.objectContaining({p_expected_updated_at:originalVersion}));
    expect(mocks.saved).not.toHaveBeenCalled();
  });
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
      expect(mocks.traces[0]).toMatchObject({operation:"insert",record:{user_id:id,id:record.id}});
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(mocks.traces.at(-1)).toMatchObject({
        table: "api_accounts",
        filters: [
          ["user_id", id],
          ["id", record.id],
        ],
      });
    },
  );
  it("returns stored accounts, reports and transactions unchanged without saving repairs during GET", async () => {
    const stored = workspace();
    stored.accounts = [{ ...account(), notes: "Keep the recorded account note.", active: true }];
    stored.transactions = [1, 2].map((n) => ({
      id: `30000000-0000-4000-8000-00000000000${n}`,
      userId: a,
      amount: "32990.00",
      currency: "INR",
      kind: "expense" as const,
      status: "posted" as const,
      occurredOn: "2026-10-18",
      description: "Two separately recorded synthetic purchases",
      merchant: "DAWNTECH synthetic merchant example",
      fromAccountId: bankA,
      toAccountId: null,
      notes: `Keep source evidence ${n}.`,
      updatedAt: "2028-03-10T12:00:00.123456+00:00",
    }));
    stored.snapshots = [{
      id: "40000000-0000-4000-8000-000000000001", userId: a,
      accountId: bankA, asOf: "2028-03-10T12:00:00Z", reportedBalance: "456.78",
      source: "user_report", verifiedByUser: false,
    }];
    const before = structuredClone(stored);
    mocks.readState.mockResolvedValue({
      workspace: stored, commerce: { orders: [], refunds: [], operations: [] }, revision: "12",
    });
    for (let read = 0; read < 2; read++) {
      const result = await GET(request());
      expect(result.status).toBe(200);
      expect((await result.json()).workspace).toEqual(before);
    }
    expect(stored).toEqual(before);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
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
    mocks.mutation.mockResolvedValue({
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
  it("serves fully populated demo workspace for active demo session", async () => {
    const demoReq = new NextRequest(`${origin}/api/workspace`, {
      method: "GET",
      headers: {
        host: new URL(origin).host,
        origin,
        cookie: "money-nest-demo-session=1",
      },
    });
    const res = await GET(demoReq);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      configured: true,
      authenticated: true,
      backend: "demo",
      userId: a,
      profile: {
        displayName: "AI Agent Demo Account",
        email: "demo@moneynest.com",
      },
    });
    expect(body.workspace.accounts.length).toBeGreaterThan(0);
    expect(body.workspace.transactions.length).toBeGreaterThan(0);
    expect(body.workspace.loans.length).toBeGreaterThan(0);
    expect(body.workspace.emis.length).toBeGreaterThan(0);
  });

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
