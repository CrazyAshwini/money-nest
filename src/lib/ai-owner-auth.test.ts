import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_HOSTED_RECEIPT_BYTES, MAX_RECEIPT_BYTES } from "./receipt-scan";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  client: vi.fn(),
  authenticate: vi.fn(),
  readConfiguration: vi.fn(),
  readSettings: vi.fn(),
  readUpload: vi.fn(),
  scanReceipt: vi.fn(),
  scanOrders: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("./private-profile-store", async (original) => ({
  ...(await original<typeof import("./private-profile-store")>()),
  authenticatePrivateProfile: mocks.authenticate,
}));
vi.mock("./ai-receipt-service", async (original) => ({
  ...(await original<typeof import("./ai-receipt-service")>()),
  readReceiptAIConfiguration: mocks.readConfiguration,
  readReceiptAISettings: mocks.readSettings,
  readReceiptUpload: mocks.readUpload,
  scanReceiptBatchWithAI: mocks.scanReceipt,
  scanOrderHistoryWithAI: mocks.scanOrders,
  acquireReceiptScan: mocks.acquire,
}));
import {
  authenticateAIOwnerRequest,
  cloudAIRequestAllowed,
  receiptUploadLimits,
} from "./ai-owner-auth";
import {
  GET as settingsGET,
  POST as settingsPOST,
} from "../app/api/ai/settings/route";
import { POST as receiptPOST } from "../app/api/ai/receipt/route";
import { POST as ordersPOST } from "../app/api/ai/orders/route";

const configuration = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  apiKey: "synthetic-owner-key-not-a-real-credential",
};
function request(
  body?: string,
  headers: Record<string, string> = {},
  url = "https://money-nest.example/api/ai/receipt",
) {
  return new NextRequest(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      host: "money-nest.example",
      origin: "https://money-nest.example",
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FINANCE_PRIVATE_ENABLED", "false");
  vi.stubEnv("APP_URL", "https://money-nest.example");
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("FINANCE_CLOUD_OWNER_ID", OWNER);
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: OWNER, is_anonymous: false } },
    error: null,
  });
  mocks.authenticate.mockResolvedValue({ ownerId: OWNER });
  mocks.readConfiguration.mockReturnValue(configuration);
  mocks.readSettings.mockReturnValue({
    configured: true,
    provider: "Google Gemini",
    model: configuration.model,
    requiresRedaction: true,
  });
  mocks.acquire.mockReturnValue(mocks.release);
  mocks.readUpload.mockImplementation(async () => ({
    images: [Buffer.from([1, 2, 3])],
    fingerprint: "synthetic-image-fingerprint",
    redacted: true,
  }));
  mocks.scanReceipt.mockResolvedValue([
    {
      amount: "12.34",
      description: "Synthetic purchase",
      occurredOn: "2026-10-13",
      merchant: null,
      externalReference: null,
    },
  ]);
  mocks.scanOrders.mockResolvedValue({ orders: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("hosted owner-only receipt AI", () => {
  it("verifies the owner with getUser and keeps server keys and identity out of settings", async () => {
    const response = await settingsGET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const metadata = await response.json();
    expect(metadata).toMatchObject({
      ownerManaged: true,
      configured: true,
      provider: "Google Gemini",
      maxUploadBytes: MAX_HOSTED_RECEIPT_BYTES,
    });
    expect(JSON.stringify(metadata)).not.toContain(configuration.apiKey);
    expect(JSON.stringify(metadata)).not.toContain(OWNER);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    { user: null, error: null },
    { user: { id: OTHER, is_anonymous: false }, error: null },
    { user: { id: OWNER, is_anonymous: true }, error: null },
    {
      user: { id: OWNER, is_anonymous: false },
      error: { message: "internal auth details" },
    },
  ])(
    "blocks invalid sessions before reading metadata, uploads or spending credits: %j",
    async ({ user, error }) => {
      mocks.getUser.mockResolvedValue({ data: { user }, error });
      for (const handler of [receiptPOST, ordersPOST, settingsPOST]) {
        const denied = request("body that must stay unread");
        const response = await handler(denied);
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain("internal auth details");
        expect(denied.bodyUsed).toBe(false);
      }
      expect((await settingsGET(request())).status).toBe(403);
      expect(mocks.readConfiguration).not.toHaveBeenCalled();
      expect(mocks.readSettings).not.toHaveBeenCalled();
      expect(mocks.readUpload).not.toHaveBeenCalled();
      expect(mocks.acquire).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "", "not-a-uuid"])(
    "fails closed without a valid owner configuration: %s",
    async (owner) => {
      vi.stubEnv("FINANCE_CLOUD_OWNER_ID", owner);
      expect((await settingsGET(request())).status).toBe(403);
      const denied = request("not read");
      expect((await receiptPOST(denied)).status).toBe(403);
      expect(denied.bodyUsed).toBe(false);
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.readSettings).not.toHaveBeenCalled();
      expect(mocks.readConfiguration).not.toHaveBeenCalled();
    },
  );

  it.each<Record<string, string>>([
    { host: "evil.example" },
    { host: "" },
    { origin: "https://evil.example" },
    { origin: "" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ])(
    "blocks untrusted cloud request headers before authentication: %j",
    async (headers) => {
      const denied = request("not read", headers);
      expect((await receiptPOST(denied)).status).toBe(403);
      expect(denied.bodyUsed).toBe(false);
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    "",
    "http://money-nest.example",
    "https://money-nest.example/path",
    "https://money-nest.example?next=evil",
    "https://user:pass@money-nest.example",
    "https://money-nest.example:0",
    "broken",
  ])("rejects missing or unsafe canonical URLs: %s", async (url) => {
    vi.stubEnv("APP_URL", url);
    expect((await receiptPOST(request("not read"))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("ignores forwarded origins and requires the actual URL to match the canonical host", () => {
    expect(
      cloudAIRequestAllowed(
        request("body", {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "http",
        }),
        true,
      ),
    ).toBe(true);
    expect(
      cloudAIRequestAllowed(
        request("body", {}, "https://evil.example/api/ai/receipt"),
        true,
      ),
    ).toBe(false);
    expect(
      cloudAIRequestAllowed(
        request("body", {}, "http://money-nest.example/api/ai/receipt"),
        true,
      ),
    ).toBe(false);
  });

  it("authenticates the owner on the exact current preview and rejects other Vercel domains before upload", async () => {
    const origin = "https://money-nest-current.vercel.app";
    vi.stubEnv("VERCEL_URL", new URL(origin).host);
    const preview = request("body", { host: new URL(origin).host, origin }, `${origin}/api/ai/receipt`);
    await expect(authenticateAIOwnerRequest(preview)).resolves.toEqual({ ownerId: OWNER, cloud: true });
    mocks.client.mockClear();
    const denied = request("not read", { host: new URL(origin).host, origin: "https://other.vercel.app" }, `${origin}/api/ai/receipt`);
    expect((await receiptPOST(denied)).status).toBe(403);
    expect(denied.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("permits same-host settings GET without Origin but never a write without it", async () => {
    const read = request();
    read.headers.delete("origin");
    expect((await settingsGET(read)).status).toBe(200);
    const write = request("not read");
    write.headers.delete("origin");
    expect((await receiptPOST(write)).status).toBe(403);
  });

  it("supports explicit loopback APP_URL for isolated tests without allowing remote hosts", async () => {
    vi.stubEnv("APP_URL", "http://127.0.0.1:3007");
    const local = request(
      "body",
      { host: "127.0.0.1:3007", origin: "http://127.0.0.1:3007" },
      "http://127.0.0.1:3007/api/ai/receipt",
    );
    await expect(authenticateAIOwnerRequest(local)).resolves.toEqual({
      ownerId: OWNER,
      cloud: true,
    });
    local.headers.set("host", "evil.example:3007");
    expect(cloudAIRequestAllowed(local, true)).toBe(false);
  });

  it("keeps local mode bound to the private loopback cookie and the existing 5 MB cap", async () => {
    vi.stubEnv("FINANCE_PRIVATE_ENABLED", "true");
    const local = request(
      "body",
      {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        cookie: "finance-os-private-session=synthetic-local-session",
      },
      "http://127.0.0.1:3000/api/ai/receipt",
    );
    await expect(authenticateAIOwnerRequest(local)).resolves.toEqual({
      ownerId: OWNER,
      cloud: false,
    });
    expect(mocks.authenticate).toHaveBeenCalledWith("synthetic-local-session");
    expect(mocks.client).not.toHaveBeenCalled();
    expect(receiptUploadLimits(false).maxImageBytes).toBe(MAX_RECEIPT_BYTES);
    expect((await receiptPOST(request("not read"))).status).toBe(403);
  });

  it("passes the hosted cap, verified owner and redaction through both scanners and releases their buffers", async () => {
    const receiptResponse = await receiptPOST(
      request("mocked-redacted-upload"),
    );
    expect(receiptResponse.status).toBe(200);
    const ordersResponse = await ordersPOST(request("mocked-redacted-upload"));
    expect(ordersResponse.status).toBe(200);
    const limits = receiptUploadLimits(true);
    expect(limits.maxMultipartBytes).toBeLessThan(4.5 * 1_000_000);
    expect(
      mocks.readUpload.mock.calls.every(
        (call) => call[2].maxImageBytes === MAX_HOSTED_RECEIPT_BYTES,
      ),
    ).toBe(true);
    expect(mocks.acquire.mock.calls).toEqual([[OWNER], [OWNER]]);
    expect(mocks.scanOrders).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER, redacted: true }),
    );
    expect(mocks.scanReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ redacted: true }),
    );
    for (const result of mocks.readUpload.mock.results) {
      const upload = await result.value;
      expect([...upload.images[0]]).toEqual([0, 0, 0]);
    }
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it("never reads or persists a user's AI configuration even for the cloud owner", async () => {
    const write = request(
      JSON.stringify({ apiKey: "synthetic-user-submission" }),
    );
    const response = await settingsPOST(write);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "owner_managed" });
    expect(write.bodyUsed).toBe(false);
    expect(mocks.readConfiguration).not.toHaveBeenCalled();
  });
});
