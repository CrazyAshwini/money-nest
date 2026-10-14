import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canonical = "https://money-nest.example";
const preview = "https://money-nest-current.vercel.app";
const owner = "10000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  client: vi.fn(), getUser: vi.fn(), rpc: vi.fn(),
  privateEnabled: vi.fn(), privateImport: vi.fn(),
  fetch: vi.fn(() => { throw new Error("Network disabled in import route tests"); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/private-profile-store", () => ({ privateProfileEnabled: mocks.privateEnabled }));
vi.mock("@/lib/private-profile-http", () => ({ privateImportPOST: mocks.privateImport }));

import { POST } from "./route";

function reviewedImport() {
  return {
    transactions: [{
      id: "20000000-0000-4000-8000-000000000001", userId: owner,
      amount: "1.00", currency: "INR", kind: "expense", status: "posted",
      occurredOn: "2026-10-14", description: "Synthetic import",
      fromAccountId: "30000000-0000-4000-8000-000000000001", toAccountId: null,
      sourceSystem: "csv", sourceObjectId: "synthetic-source-1",
    }],
    inputHash: "a".repeat(64), fileName: "synthetic.csv",
  };
}
function request(origin = canonical, headers: Record<string, string> = {}, body: unknown = reviewedImport()) {
  return new NextRequest(origin + "/api/imports/commit", {
    method: "POST",
    headers: { host: new URL(origin).host, origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("APP_URL", canonical);
  vi.stubEnv("VERCEL_URL", new URL(preview).host);
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "owner@example.test");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
  mocks.privateEnabled.mockReturnValue(false);
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner, is_anonymous: false } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { count: 1 }, error: null });
});
afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reviewed cloud import request origins", () => {
  it.each([
    ["unrelated Vercel Origin", preview, { origin: "https://other.vercel.app" }],
    ["mismatched Host", canonical, { host: "attacker.example" }],
    ["cross-site Fetch Metadata", canonical, { "sec-fetch-site": "cross-site" }],
    ["unconfigured deployment", "https://old.vercel.app", {}],
  ] as const)("rejects %s before authentication or reading imported records", async (_case, origin, headers) => {
    const input = request(origin, headers);
    expect((await POST(input)).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a missing write Origin before authentication or parsing", async () => {
    const input = request(); input.headers.delete("origin");
    expect((await POST(input)).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([canonical, preview, "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "commits a reviewed owner import at its exact configured origin %s", async (origin) => {
      if (origin.startsWith("http:")) vi.stubEnv("APP_URL", origin);
      const response = await POST(request(origin));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, count: 1 });
      expect(mocks.rpc).toHaveBeenCalledWith("commit_reviewed_import", {
        p_input_hash: "a".repeat(64), p_file_name: "synthetic.csv", p_transactions: reviewedImport().transactions,
      });
    },
  );
  it("retains verified-session authorization", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const input = request();
    expect((await POST(input)).status).toBe(401);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains imported-record ownership validation", async () => {
    const body = reviewedImport(); body.transactions[0].userId = "10000000-0000-4000-8000-000000000002";
    expect((await POST(request(canonical, {}, body))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains reviewed-import body validation", async () => {
    expect((await POST(request(canonical, {}, {}))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves delegation to private imports before the cloud policy", async () => {
    mocks.privateEnabled.mockReturnValue(true);
    const delegated = NextResponse.json({ ok: true, private: true });
    mocks.privateImport.mockResolvedValue(delegated);
    const input = request(); input.headers.delete("origin");
    expect(await POST(input)).toBe(delegated);
    expect(mocks.privateImport).toHaveBeenCalledWith(input);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(input.bodyUsed).toBe(false);
  });
});
