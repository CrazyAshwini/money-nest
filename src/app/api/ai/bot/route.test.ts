import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  state: vi.fn(),
  confirm: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai-owner-auth", () => ({
  authenticateAIOwnerRequest: mocks.auth,
  AIOwnerAuthenticationError: class extends Error {},
}));
vi.mock("@/lib/rate-limit", () => ({
  requireRouteRateLimit: async () => {},
  RouteRateLimitError: class extends Error {},
  routeRateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("@/lib/supabase/commerce-store", () => ({
  readCloudFinanceState: mocks.state,
}));
vi.mock("@/lib/private-profile-store", () => ({
  privateProfileEnabled: () => false,
  PrivateProfileError: class extends Error {},
  readPrivateProfile: vi.fn(),
  savePrivateRecord: vi.fn(),
}));
vi.mock("@/lib/ai-receipt-service", () => ({
  readReceiptAIConfiguration: () => null,
}));
vi.mock("@/lib/nestbot-service", () => ({
  confirmTransactionPost: mocks.confirm,
  executeNestBotQuery: vi.fn(),
}));
import { POST } from "./route";

const owner = "11111111-1111-4111-8111-111111111111";
const transaction = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: owner,
  amount: "25.00",
  currency: "INR",
  kind: "expense",
  status: "posted",
  occurredOn: "2026-11-01",
  description: "Synthetic confirmed purchase",
  fromAccountId: null,
  toAccountId: null,
  externalPayer: "Synthetic payer",
};
const request = () =>
  new NextRequest("https://money-nest.example/api/ai/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "confirm_transaction",
      confirmedTransaction: transaction,
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ownerId: owner, cloud: true });
  mocks.client.mockResolvedValue({ from: mocks.from });
  mocks.from.mockReturnValue({ insert: mocks.insert });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.state.mockResolvedValue({ workspace: { transactions: [] } });
  mocks.confirm.mockReturnValue(transaction);
});
describe("confirmed bot transaction insertion", () => {
  it("creates a new record without exposing an upsert overwrite path", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: transaction.id, user_id: owner }),
    );
  });
  it("returns409 for a duplicate ID instead of overwriting or retrying", async () => {
    mocks.insert.mockResolvedValue({
      error: { code: "23505", message: "Private database index details" },
    });
    const result = await POST(request());
    expect(result.status).toBe(409);
    const body = await result.json();
    expect(body.code).toBe("conflict");
    expect(body.error).not.toContain("Private database");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
});
