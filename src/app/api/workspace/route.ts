import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fromDatabase,
  recordSchemas,
  safeDatabaseError,
  tables,
  toDatabase,
  type MutableCollection,
} from "@/lib/supabase/validation";
import type { WorkspaceData } from "@/lib/types";
import { cloudSignupEnabled, cloudUserAllowed } from "@/lib/cloud-owner";
import { cloudRequestAllowed } from "@/lib/cloud-request";
import { readCloudProfile } from "@/lib/cloud-profile";
import {
  readCloudFinanceState,
  type CloudFinanceState,
} from "@/lib/supabase/commerce-store";
import { validateWorkspaceRecord } from "@/lib/validation";
import { assertCommerceTransactionEdit } from "@/lib/commerce";
import type { Transaction } from "@/lib/types";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import {
  privateWorkspaceGET,
  privateWorkspacePOST,
  privateWorkspaceDELETE,
} from "@/lib/private-profile-http";
import { sanitizeWorkspaceTransactions } from "@/lib/workspace-cleaner";

export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET(request: NextRequest) {
  if (privateProfileEnabled()) return privateWorkspaceGET(request);
  if (!cloudRequestAllowed(request))
    return response({ error: "Request origin is not allowed." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return response(
      {
        configured: false,
        authenticated: false,
        signupEnabled: false,
        error: "Supabase is not configured.",
      },
      503,
    );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous)
    return response(
      {
        configured: true,
        authenticated: false,
        signupEnabled: cloudSignupEnabled(),
        error: "Sign in to access your private workspace.",
      },
      401,
    );
  if (!cloudUserAllowed(user))
    return response(
      {
        configured: true,
        authenticated: false,
        signupEnabled: false,
        error: "This account cannot access the workspace.",
      },
      403,
    );
  // A single database snapshot keeps order payment links and the ledger consistent.
  const loaded = await Promise.all([
    readCloudFinanceState(supabase, user.id),
    readCloudProfile(supabase, user),
    supabase
      .from("finance_source_observations")
      .select("record_id,source_object_id")
      .eq("user_id", user.id)
      .eq("collection", "transactions")
      .eq("source_system", "notion"),
  ]).catch(() => null);
  if (!loaded)
    return response(
      {
        configured: true,
        authenticated: true,
        error:
          "Workspace unavailable. Apply the database migration and try again.",
      },
      503,
    );
  return response({
    configured: true,
    authenticated: true,
    backend: "supabase",
    signupEnabled: cloudSignupEnabled(),
    userId: user.id,
    workspace: sanitizeWorkspaceTransactions(loaded[0].workspace),
    profile: loaded[1],
    transactionSourceIds: Object.fromEntries(
      loaded[0].workspace.transactions.map((row) => [
        row.id,
        (loaded[2].data ?? [])
          .filter((source) => source.record_id === row.id)
          .map((source) => source.source_object_id),
      ]),
    ),
  });
}

export async function POST(request: NextRequest) {
  if (privateProfileEnabled()) return privateWorkspacePOST(request);
  if (!cloudRequestAllowed(request, true))
    return response({ error: "Request origin is not allowed." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return response(
      { configured: false, error: "Supabase is not configured." },
      503,
    );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous)
    return response({ error: "Authentication required." }, 401);
  if (!cloudUserAllowed(user))
    return response(
      { error: "This account cannot access the workspace." },
      403,
    );
  if (Number(request.headers.get("content-length") || 0) > 100000)
    return response({ error: "Request is too large." }, 413);
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.collection !== "string" ||
    !Object.hasOwn(recordSchemas, body.collection)
  )
    return response({ error: "Unknown record collection." }, 400);
  const collection = body.collection as MutableCollection;
  const parsed = recordSchemas[collection].safeParse(body.record);
  if (!parsed.success)
    return response(
      { error: parsed.error.issues[0]?.message || "Invalid record." },
      400,
    );
  if (parsed.data.userId !== user.id)
    return response(
      { error: "Record ownership does not match your session." },
      403,
    );
  const record = parsed.data as Record<string, unknown>;
  let state: CloudFinanceState;
  try {
    state = await readCloudFinanceState(supabase, user.id);
  } catch {
    return response(
      { error: "Your workspace could not be checked. Reload and try again." },
      503,
    );
  }
  try {
    validateWorkspaceRecord(
      state.workspace,
      collection,
      parsed.data as WorkspaceData[typeof collection][number],
      user.id,
    );
    if (collection === "transactions")
      assertCommerceTransactionEdit(
        state.commerce,
        state.workspace.transactions.find((row) => row.id === record.id),
        parsed.data as Transaction,
      );
  } catch (failure) {
    return response(
      {
        error:
          failure instanceof Error
            ? failure.message
            : "Check the record details and payment links.",
      },
      400,
    );
  }
  if (
    collection === "reminders" &&
    record.channel !== "in_app" &&
    record.enabled
  )
    return response(
      {
        error:
          "Email and push reminders require an opted-in notification provider. Use in-app reminders for now.",
      },
      400,
    );
  let result;
  if (collection === "allocations")
    result = await supabase.rpc("allocate_bill_payment", {
      p_id: record.id,
      p_bill_id: record.billId,
      p_transaction_id: record.transactionId,
      p_amount: record.amount,
      p_verified: record.verified,
    });
  else if (collection === "emiAllocations")
    result = await supabase.rpc("allocate_emi_payment", {
      p_id: record.id,
      p_emi_id: record.emiId,
      p_transaction_id: record.transactionId,
      p_amount: record.amount,
    });
  else
    result = await supabase
      .from(tables[collection])
      .upsert(toDatabase(record, user.id), { onConflict: "id" });
  if (result.error)
    return response(
      { error: safeDatabaseError(result.error.code, result.error.message) },
      400,
    );
  const saved = await supabase
    .from(`api_${tables[collection]}`)
    .select("*")
    .eq("user_id", user.id)
    .eq("id", record.id)
    .single();
  if (saved.error)
    return response(
      { error: "Change saved, but refresh failed. Reload your workspace." },
      503,
    );
  return response({ record: fromDatabase(saved.data) });
}

export async function DELETE(request: NextRequest) {
  if (privateProfileEnabled()) return privateWorkspaceDELETE(request);
  if (!cloudRequestAllowed(request, true))
    return response({ error: "Request origin is not allowed." }, 403);
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return response(
      { configured: false, error: "Supabase is not configured." },
      503,
    );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous)
    return response({ error: "Authentication required." }, 401);
  if (!cloudUserAllowed(user))
    return response(
      { error: "This account cannot access the workspace." },
      403,
    );
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.collection !== "string" ||
    typeof body.id !== "string" ||
    !Object.hasOwn(recordSchemas, body.collection)
  )
    return response({ error: "Invalid delete parameters." }, 400);

  const collection = body.collection as MutableCollection;
  const result = await supabase
    .from(tables[collection])
    .delete()
    .eq("user_id", user.id)
    .eq("id", body.id);

  if (result.error)
    return response(
      { error: safeDatabaseError(result.error.code, result.error.message) },
      400,
    );

  return response({ ok: true });
}
