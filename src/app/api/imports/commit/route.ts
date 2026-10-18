import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  safeDatabaseError,
  transactionSchema,
} from "@/lib/supabase/validation";
import { privateProfileEnabled } from "@/lib/private-profile-store";
import { privateImportPOST } from "@/lib/private-profile-http";
import { cloudRequestAllowed } from "@/lib/cloud-request";
import { cloudUserAllowed } from "@/lib/cloud-owner";

const input = z.object({
  transactions: z.array(transactionSchema).min(1).max(1000),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileName: z.string().min(1).max(255),
});
export async function POST(request: NextRequest) {
  if (privateProfileEnabled()) return privateImportPOST(request);
  if (!cloudRequestAllowed(request, true))
    return NextResponse.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json(
      { configured: false, error: "Supabase is not configured." },
      { status: 503 },
    );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  if (!cloudUserAllowed(user))
    return NextResponse.json(
      { error: "This account cannot access the workspace." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") || 0) > 3000000)
    return NextResponse.json(
      { error: "Import exceeds request size limit." },
      { status: 413 },
    );
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid reviewed import." },
      { status: 400 },
    );
  if (parsed.data.transactions.some((t) => t.userId !== user.id))
    return NextResponse.json(
      { error: "Import ownership does not match your session." },
      { status: 403 },
    );
  const { data, error: dbError } = await supabase.rpc(
    "commit_reviewed_import",
    {
      p_input_hash: parsed.data.inputHash,
      p_file_name: parsed.data.fileName,
      p_transactions: parsed.data.transactions,
    },
  );
  if (dbError)
    return NextResponse.json(
      { error: safeDatabaseError(dbError.code, dbError.message) },
      { status: 400 },
    );
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
