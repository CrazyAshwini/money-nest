import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyCommerceCommand,
  commerceDataSchema,
  commerceSummary,
  type CommerceData,
} from "@/lib/commerce";
import type { WorkspaceData } from "@/lib/types";
import {
  recordSchemas,
  safeDatabaseError,
  tables,
  toDatabase,
} from "./validation";

export class CloudCommerceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CloudCommerceError";
  }
}

export interface CloudFinanceState {
  workspace: WorkspaceData;
  commerce: CommerceData;
  revision: string;
}

/** One database transaction reads both ledger and order state at the same revision. */
export async function readCloudFinanceState(
  supabase: SupabaseClient,
  userId: string,
): Promise<CloudFinanceState> {
  const response = await supabase.rpc("read_finance_cloud_state");
  if (response.error || !response.data)
    throw new CloudCommerceError(
      "Your cloud workspace is unavailable. Please retry.",
      503,
    );
  const state = response.data as CloudFinanceState;
  if (!/^\d+$/.test(String(state.revision)))
    throw new CloudCommerceError(
      "Your cloud workspace could not be read.",
      503,
    );
  for (const collection of Object.keys(tables) as (keyof WorkspaceData)[]) {
    if (
      !Array.isArray(state.workspace?.[collection]) ||
      state.workspace[collection].some((row) => row.userId !== userId)
    ) {
      throw new CloudCommerceError(
        "Your cloud workspace could not be read.",
        503,
      );
    }
  }
  const commerce = commerceDataSchema.safeParse(state.commerce);
  if (
    !commerce.success ||
    commerce.data.orders.some((row) => row.userId !== userId) ||
    commerce.data.refunds.some((row) => row.userId !== userId)
  ) {
    throw new CloudCommerceError(
      "Your cloud order history could not be read.",
      503,
    );
  }
  return {
    workspace: state.workspace,
    commerce: commerce.data,
    revision: String(state.revision),
  };
}

export async function readCloudCommerce(
  supabase: SupabaseClient,
  userId: string,
) {
  const state = await readCloudFinanceState(supabase, userId);
  return {
    commerce: state.commerce,
    summary: commerceSummary(state.commerce, state.workspace),
  };
}

/** Apply the same exact-decimal rules as local profiles, then atomically compare and save. */
export async function commitCloudCommerce(
  supabase: SupabaseClient,
  userId: string,
  input: unknown,
) {
  // A concurrent phone/desktop edit is recomputed from fresh rows, never overwritten.
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await readCloudFinanceState(supabase, userId);
    const applied = applyCommerceCommand(
      previous.workspace,
      previous.commerce,
      userId,
      input,
    );
    const unchanged =
      JSON.stringify(previous.commerce) === JSON.stringify(applied.commerce);
    if (unchanged)
      return {
        commerce: applied.commerce,
        result: applied.result,
        summary: commerceSummary(applied.commerce, applied.workspace),
      };
    const before = new Map(
      previous.workspace.transactions.map((row) => [
        row.id,
        JSON.stringify(row),
      ]),
    );
    const changed = applied.workspace.transactions.filter(
      (row) => before.get(row.id) !== JSON.stringify(row),
    );
    const transactions = changed.map((row) =>
      recordSchemas.transactions.parse(row),
    );
    const response = await supabase.rpc("commit_finance_commerce", {
      p_expected_revision: previous.revision,
      p_transactions: transactions.map((row) => toDatabase(row, userId)),
      p_commerce: applied.commerce,
    });
    if (response.error?.code === "40001") continue;
    if (response.error)
      throw new CloudCommerceError(
        safeDatabaseError(response.error.code, response.error.message),
      );
    return {
      commerce: applied.commerce,
      result: applied.result,
      summary: commerceSummary(applied.commerce, applied.workspace),
    };
  }
  throw new CloudCommerceError(
    "Your workspace changed on another device. Review the latest details and retry.",
    409,
  );
}
