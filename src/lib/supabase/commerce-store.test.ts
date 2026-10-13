import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { commitCloudCommerce, readCloudFinanceState } from "./commerce-store";
import { emptyCommerce, type ReviewedOrderDraft } from "../commerce";
import type { WorkspaceData } from "../types";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const bank = "33333333-3333-4333-8333-333333333333";
function workspace(): WorkspaceData {
  return {
    accounts: [
      {
        id: bank,
        userId: owner,
        name: "Synthetic bank",
        institution: "Imaginary",
        kind: "bank",
        maskedSuffix: "1234",
        active: true,
      },
    ],
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
function command() {
  const draft: ReviewedOrderDraft = {
    candidateId: "synthetic-card",
    sourceType: "manual",
    platform: "Synthetic store",
    merchant: "Synthetic seller",
    description: "Synthetic purchase",
    orderReferenceHash: null,
    orderReferenceMasked: null,
    occurredOn: "2026-10-09",
    status: "completed",
    amount: "100.10",
    amountRole: "amount_paid",
    currency: "INR",
    paymentStatus: "successful",
    financialEvent: "purchase",
    category: "Shopping",
    items: [],
    sourceImageIndices: [],
    confidence: "high",
    warnings: [],
    expectedRefundAmount: null,
    expectedRefundBy: null,
    action: "create",
    confirmed: true,
    fromAccountId: bank,
    externalPayer: null,
    matchedTransactionId: null,
    confirmedDistinct: false,
    sourceFingerprint: null,
  };
  return {
    action: "commit_orders",
    idempotencyKey: "a".repeat(64),
    orders: [draft],
  };
}
function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient;
}
const state = () => ({
  workspace: workspace(),
  commerce: emptyCommerce(),
  revision: "1",
});

describe("cloud commerce application boundary", () => {
  it("sends changed ledger entries and validated orders in one exact-decimal compare-and-save operation", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: state(), error: null })
      .mockResolvedValueOnce({ data: { saved: true }, error: null });
    const saved = await commitCloudCommerce(client(rpc), owner, command());
    expect(saved.result.transactionsCreated).toBe(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "commit_finance_commerce",
      expect.objectContaining({
        p_expected_revision: "1",
        p_transactions: [
          expect.objectContaining({
            user_id: owner,
            amount: "100.10",
            platform: "Synthetic store",
          }),
        ],
        p_commerce: expect.objectContaining({
          orders: [expect.objectContaining({ userId: owner })],
        }),
      }),
    );
  });

  it("recomputes after a concurrent phone edit and preserves the updated account state", async () => {
    const refreshed = state();
    refreshed.revision = "2";
    refreshed.workspace.accounts[0].name = "Synthetic phone edit";
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: state(), error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "40001", message: "Internal revision details" },
      })
      .mockResolvedValueOnce({ data: refreshed, error: null })
      .mockResolvedValueOnce({ data: { saved: true }, error: null });
    await commitCloudCommerce(client(rpc), owner, command());
    expect(rpc).toHaveBeenNthCalledWith(
      4,
      "commit_finance_commerce",
      expect.objectContaining({ p_expected_revision: "2" }),
    );
    expect(rpc.mock.calls[3][1]).not.toHaveProperty("p_accounts");
  });

  it("stops after bounded conflicting retries without exposing provider details", async () => {
    const rpc = vi
      .fn()
      .mockImplementation(async (name: string) =>
        name === "read_finance_cloud_state"
          ? { data: state(), error: null }
          : {
              data: null,
              error: { code: "40001", message: "private row metadata" },
            },
      );
    await expect(
      commitCloudCommerce(client(rpc), owner, command()),
    ).rejects.toMatchObject({
      status: 409,
      message:
        "Your workspace changed on another device. Review the latest details and retry.",
    });
    expect(rpc).toHaveBeenCalledTimes(6);
  });

  it("uses the persisted idempotency key to avoid another debit after a lost response", async () => {
    const previous = state();
    previous.commerce.operations.push({
      key: "a".repeat(64),
      completedAt: "2026-10-09T12:00:00Z",
    });
    const rpc = vi.fn().mockResolvedValue({ data: previous, error: null });
    const saved = await commitCloudCommerce(client(rpc), owner, command());
    expect(saved.result.duplicate).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign-owner workspace or malformed commerce before considering a mutation", async () => {
    const foreign = state();
    foreign.workspace.accounts[0].userId = other;
    await expect(
      readCloudFinanceState(
        client(vi.fn().mockResolvedValue({ data: foreign, error: null })),
        owner,
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      readCloudFinanceState(
        client(
          vi
            .fn()
            .mockResolvedValue({
              data: { ...state(), commerce: { orders: "bad" } },
              error: null,
            }),
        ),
        owner,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("sanitizes database failures and never reports a successful write", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: state(), error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "private row metadata and token" },
      });
    await expect(
      commitCloudCommerce(client(rpc), owner, command()),
    ).rejects.toThrow("The database could not save this change.");
  });
});
