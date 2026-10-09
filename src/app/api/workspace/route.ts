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
import { privateProfileEnabled } from "@/lib/private-profile-store";
import {
  privateWorkspaceGET,
  privateWorkspacePOST,
} from "@/lib/private-profile-http";

export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET(request: NextRequest) {
  if (privateProfileEnabled()) return privateWorkspaceGET(request);
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return response(
      {
        configured: false,
        authenticated: false,
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
        error: "Sign in to access your private workspace.",
      },
      401,
    );
  const entries = await Promise.all(
    Object.entries(tables).map(async ([collection, table]) => {
      // Paginate through every owned row; PostgREST defaults to a 1000 row cap.
      const records: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await supabase
          .from(`api_${table}`)
          .select("*")
          .eq("user_id", user.id)
          .order("id")
          .range(offset, offset + 999);
        if (result.error) throw new Error("WORKSPACE_DATABASE_UNAVAILABLE");
        records.push(...result.data.map(fromDatabase));
        if (result.data.length < 1000) break;
      }
      return [collection, records] as const;
    }),
  ).catch(() => null);
  if (!entries)
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
    userId: user.id,
    workspace: Object.fromEntries(entries) as unknown as WorkspaceData,
  });
}

export async function POST(request: NextRequest) {
  if (privateProfileEnabled()) return privateWorkspacePOST(request);
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== request.nextUrl.origin
  )
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
  if (Number(request.headers.get("content-length") || 0) > 100000)
    return response({ error: "Request is too large." }, 413);
  const body = await request.json().catch(() => null);
  if (
    body?.collection === "groups" &&
    body?.record?.kind === "contribution_pool"
  )
    return response(
      {
        error:
          "Contribution pools are currently available in private local profiles.",
      },
      400,
    );
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
