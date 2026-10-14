import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canonical = "https://money-nest.example";
const preview = "https://money-nest-current.vercel.app";
const owner = "10000000-0000-4000-8000-000000000001";
const documentId = "20000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  client: vi.fn(), getUser: vi.fn(), from: vi.fn(), lookup: vi.fn(), insert: vi.fn(), saved: vi.fn(),
  bucket: vi.fn(), upload: vi.fn(), remove: vi.fn(),
  fetch: vi.fn(() => { throw new Error("Network disabled in document route tests"); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));

import { POST } from "./route";

function request(origin = canonical, headers: Record<string, string> = {}, file = new File(["synthetic content\n"], "synthetic.csv", { type: "text/csv" })) {
  const form = new FormData(); form.set("file", file);
  return new NextRequest(origin + "/api/documents", {
    method: "POST", headers: { host: new URL(origin).host, origin, ...headers }, body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("APP_URL", canonical);
  vi.stubEnv("VERCEL_URL", new URL(preview).host);
  vi.stubEnv("FINANCE_CLOUD_OWNER_EMAIL", "owner@example.test");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", "");
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: mocks.from, storage: { from: mocks.bucket } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner, is_anonymous: false } }, error: null });
  mocks.lookup.mockResolvedValue({ data: null, error: null });
  mocks.saved.mockResolvedValue({ data: { id: documentId, user_id: owner }, error: null });
  mocks.from.mockImplementation((table: string) => table === "api_documents"
    ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) }) }
    : { insert: mocks.insert });
  mocks.insert.mockReturnValue({ select: () => ({ single: mocks.saved }) });
  mocks.bucket.mockReturnValue({ upload: mocks.upload, remove: mocks.remove });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
});
afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("private document upload cloud origins", () => {
  it.each([
    ["unrelated Vercel Origin", preview, { origin: "https://other.vercel.app" }],
    ["mismatched Host", canonical, { host: "attacker.example" }],
    ["cross-site Fetch Metadata", canonical, { "sec-fetch-site": "cross-site" }],
    ["unconfigured deployment", "https://old.vercel.app", {}],
  ] as const)("rejects %s before authentication or reading upload bytes", async (_case, origin, headers) => {
    const input = request(origin, headers);
    expect((await POST(input)).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects a missing write Origin before authentication or parsing multipart data", async () => {
    const input = request(); input.headers.delete("origin");
    expect((await POST(input)).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([canonical, preview, "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "stores a validated document under its owner at exact origin %s", async (origin) => {
      if (origin.startsWith("http:")) vi.stubEnv("APP_URL", origin);
      const response = await POST(request(origin));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ document: { id: documentId, userId: owner } });
      expect(mocks.bucket).toHaveBeenCalledWith("finance-documents");
      const [path] = mocks.upload.mock.calls[0];
      expect(path).toMatch(new RegExp("^" + owner + "/[0-9a-f-]{36}$"));
      expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: owner, secure_storage_path: path, file_name: "synthetic.csv" }));
    },
  );
  it("retains verified-session authorization before reading upload bytes", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const input = request();
    expect((await POST(input)).status).toBe(401);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("retains content-signature validation before storing a document", async () => {
    const file = new File(["not a PDF"], "synthetic.pdf", { type: "application/pdf" });
    expect((await POST(request(canonical, {}, file))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("retains duplicate detection without uploading a second object", async () => {
    mocks.lookup.mockResolvedValue({ data: { id: documentId, user_id: owner }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ document: { id: documentId, userId: owner }, duplicate: true });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("retains cleanup when document metadata cannot be saved", async () => {
    mocks.saved.mockResolvedValue({ data: null, error: { code: "synthetic" } });
    expect((await POST(request())).status).toBe(400);
    const [path] = mocks.upload.mock.calls[0];
    expect(mocks.remove).toHaveBeenCalledWith([path]);
  });
});
