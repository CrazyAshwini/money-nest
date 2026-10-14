import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { commerceDataSchema } from "@/lib/commerce";
import { cloudUserAllowed } from "@/lib/cloud-owner";
import { cloudRequestAllowed } from "@/lib/cloud-request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readCloudFinanceState } from "@/lib/supabase/commerce-store";
import {
  mergePrivateProfileCommerce,
  preparePrivateProfileMerge,
} from "@/lib/private-profile-merge";
import type { WorkspaceData } from "@/lib/types";
import { validateWorkspaceRecord, workspaceRecordSchemas } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });

const bundleSchema = z
  .object({
    format: z.literal("money-nest-private-export"),
    version: z.literal(1),
    profile: z.object({ id: z.string().uuid(), displayName: z.string().trim().min(1).max(100), email: z.email() }).strict(),
    workspace: z.record(z.string(), z.unknown()),
    commerce: z.unknown(),
  })
  .strict();

export async function POST(request: NextRequest) {
  if (!cloudRequestAllowed(request, true))
    return response({ error: "Request origin is not allowed." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return response({ error: "Cloud storage is not configured." }, 503);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous)
    return response({ error: "Sign in before importing your local profile." }, 401);
  if (!cloudUserAllowed(user))
    return response({ error: "This account cannot access the workspace." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 4_000_000)
    return response({ error: "Transfer file exceeds the 4 MB limit." }, 413);
  const parsed = bundleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return response({ error: "Choose a valid Money Nest transfer file." }, 400);
  const bundle = parsed.data;
  if (
    !user.email ||
    bundle.profile.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
  )
    return response({ error: "The transfer file must belong to the signed-in email." }, 403);

  const workspace = {} as WorkspaceData;
  try {
    for (const collection of Object.keys(workspaceRecordSchemas) as (keyof WorkspaceData)[]) {
      const rows = bundle.workspace[collection];
      if (!Array.isArray(rows)) throw new Error();
      const schema = workspaceRecordSchemas[collection];
      const imported = rows.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row) || (row as { userId?: unknown }).userId !== bundle.profile.id)
          throw new Error();
        return schema.parse({ ...row, userId: user.id });
      });
      if (new Set(imported.map((row) => row.id)).size !== imported.length) throw new Error();
      Object.assign(workspace, { [collection]: imported });
    }
    for (const collection of Object.keys(workspaceRecordSchemas) as (keyof WorkspaceData)[])
      for (const row of workspace[collection])
        validateWorkspaceRecord(workspace, collection, row, user.id);
  } catch {
    return response({ error: "The transfer file contains invalid records or broken links." }, 400);
  }

  const commerceResult = commerceDataSchema.safeParse(bundle.commerce);
  if (
    !commerceResult.success ||
    commerceResult.data.orders.some((row) => row.userId !== bundle.profile.id) ||
    commerceResult.data.refunds.some((row) => row.userId !== bundle.profile.id)
  )
    return response({ error: "The transfer file contains invalid order history." }, 400);
  const commerce = {
    ...commerceResult.data,
    orders: commerceResult.data.orders.map((row) => ({ ...row, userId: user.id })),
    refunds: commerceResult.data.refunds.map((row) => ({ ...row, userId: user.id })),
  };

  let current;
  try {
    current = await readCloudFinanceState(supabase, user.id);
  } catch {
    return response({ error: "Your cloud workspace could not be checked. Please retry." }, 503);
  }
  const sourceRows = await supabase
    .from("finance_source_observations")
    .select("record_id,source_system,source_object_id")
    .eq("user_id", user.id)
    .eq("collection", "transactions");
  if (sourceRows.error)
    return response({ error: "Your cloud records could not be compared. Please retry." }, 503);

  let prepared;
  let mergedCommerce;
  try {
    prepared = preparePrivateProfileMerge(current.workspace, workspace, user.id, (sourceRows.data ?? []).map((row) => ({
      recordId: row.record_id,
      sourceSystem: row.source_system,
      sourceObjectId: row.source_object_id,
    })), { current: current.commerce, incoming: commerce });
    for (const collection of Object.keys(workspaceRecordSchemas) as (keyof WorkspaceData)[])
      for (const row of prepared.delta[collection])
        validateWorkspaceRecord(prepared.full, collection, row, user.id);
    mergedCommerce = mergePrivateProfileCommerce(
      current.commerce,
      commerce,
      user.id,
      prepared.transactionIds,
      prepared.accountIds,
    );
  } catch {
    return response({ error: "The transfer contains duplicate sources, invalid links, or conflicting order payments. Review these records before merging." }, 400);
  }
  const imported = await supabase.rpc("merge_private_profile_cloud", {
    p_workspace: prepared.delta,
    p_commerce: mergedCommerce.commerce,
    p_expected_revision: current.revision,
  });
  if (imported.error?.code === "40001")
    return response({ error: "Your cloud profile changed on another device. Reload and retry the merge." }, 409);
  if (imported.error)
    return response({ error: "Your transfer could not be merged. Check the file and retry." }, 400);
  const result = imported.data as { counts?: Record<string, number>; totalAdded?: number } | null;
  const counts = { ...(result?.counts ?? {}), ...mergedCommerce.added };
  const totalAdded = Object.values(counts).reduce((total, count) => total + count, 0);
  return response({ ok: true, merged: true, counts, totalAdded });
}
