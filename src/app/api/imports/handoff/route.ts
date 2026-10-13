import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cloudUserAllowed } from "@/lib/cloud-owner";
import { cloudRequestAllowed } from "@/lib/cloud-request";
import { readCloudFinanceState } from "@/lib/supabase/commerce-store";
import { planHandoffImport } from "@/lib/handoff-import";
import { fromDatabase, recordSchemas } from "@/lib/supabase/validation";
import type { WorkspaceData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
const decision = z
  .object({
    sourceObjectId: z.string().min(1).max(250),
    action: z.enum(["match", "create", "skip"]),
    recordId: z.uuid().optional(),
    confirmCorrections: z.boolean().optional(),
  })
  .strict();
const input = z
  .object({
    action: z.enum(["preview", "commit"]),
    batchId: z.uuid().optional(),
    manifest: z.record(z.string(), z.unknown()).optional(),
    decisions: z.array(decision).max(3000).optional(),
  })
  .strict();

async function authenticate(request: NextRequest, write = false) {
  if (!cloudRequestAllowed(request, write))
    return { error: reply({ error: "Request origin is not allowed." }, 403) };
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return { error: reply({ error: "Cloud storage is not configured." }, 503) };
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user)
    return {
      error: reply({ error: "Sign in before reviewing your handoff." }, 401),
    };
  if (!cloudUserAllowed(user))
    return {
      error: reply({ error: "This account cannot access the workspace." }, 403),
    };
  return { supabase, user };
}
async function readBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Choose a valid handoff file.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 4_000_000) {
      await reader.cancel();
      throw new Error("Handoff exceeds the 4 MB limit.");
    }
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const result = await auth.supabase
    .from("finance_handoff_batches")
    .select("id,preview,state,decisions,created_at")
    .eq("user_id", auth.user.id)
    .neq("state", "complete")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (result.error)
    return reply(
      { error: "Saved handoff reviews could not be loaded. Please retry." },
      503,
    );
  return reply({ batches: (result.data ?? []).map(fromDatabase) });
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request, true);
  if (auth.error) return auth.error;
  const parsed = input.safeParse(await readBody(request).catch(() => null));
  if (!parsed.success)
    return reply(
      { error: "Choose a valid handoff file or saved review." },
      400,
    );
  const { action, batchId, decisions = [] } = parsed.data;
  let batch: Record<string, unknown> | undefined;
  let manifest = parsed.data.manifest;
  if (batchId) {
    const saved = await auth.supabase
      .from("finance_handoff_batches")
      .select("*")
      .eq("id", batchId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (saved.error || !saved.data)
      return reply({ error: "This saved review was not found." }, 404);
    batch = saved.data;
    manifest = saved.data.manifest as Record<string, unknown>;
  }
  if (!manifest || (action === "commit" && !batch))
    return reply({ error: "Preview the handoff before merging." }, 400);
  const sourceRows = await auth.supabase
    .from("finance_source_observations")
    .select(
      "collection,record_id,source_system,source_object_id,evidence,confirmation_state",
    )
    .eq("user_id", auth.user.id);
  if (sourceRows.error)
    return reply(
      { error: "Source identities could not be checked. Please retry." },
      503,
    );
  try {
    const current = await readCloudFinanceState(auth.supabase, auth.user.id);
    const sources = (sourceRows.data ?? []).map(fromDatabase);
    const plan = planHandoffImport(
      manifest,
      current.workspace,
      auth.user.id,
      sources,
      decisions,
    );
    const preview = {
      counters: plan.counters,
      checks: plan.checks,
      reviewItems: plan.reviewItems,
      warnings: plan.warnings ?? [],
    };
    if (action === "preview") {
      const inputHash = createHash("sha256")
        .update(JSON.stringify(manifest))
        .digest("hex");
      const staged = await auth.supabase
        .from("finance_handoff_batches")
        .upsert(
          {
            ...(batchId ? { id: batchId } : {}),
            user_id: auth.user.id,
            input_hash: inputHash,
            manifest,
            decisions,
            preview,
            expected_revision: current.revision,
            state: "staged",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,input_hash" },
        )
        .select("id")
        .single();
      if (staged.error)
        return reply(
          { error: "Your preview could not be saved. Please retry." },
          503,
        );
      return reply({ batchId: staged.data.id, preview });
    }
    if (String(batch!.expected_revision) !== current.revision)
      return reply(
        {
          error:
            "The workspace changed on another device. Update the preview before merging.",
        },
        409,
      );
    if (JSON.stringify(batch!.decisions ?? []) !== JSON.stringify(decisions))
      return reply(
        { error: "Update the preview to save your decisions before merging." },
        409,
      );
    // Revalidate every changed record against the normalized database contract.
    const changes: Partial<WorkspaceData> = {};
    for (const [key, rows] of Object.entries(plan.changes)) {
      if (!rows.length) continue;
      const collection = key as keyof typeof recordSchemas;
      if (!Object.hasOwn(recordSchemas, collection))
        throw new Error("Unsupported handoff collection.");
      Object.assign(changes, {
        [key]: rows.map((row: unknown) => recordSchemas[collection].parse(row)),
      });
    }
    const committed = await auth.supabase.rpc("merge_finance_handoff", {
      p_batch_id: batchId,
      p_expected_revision: current.revision,
      p_changes: changes,
      p_sources: plan.sources,
      p_preview: preview,
    });
    if (committed.error)
      return reply(
        {
          error:
            committed.error.code === "40001"
              ? "The workspace changed. Update the preview before merging."
              : "The merge could not be saved. Your existing records were preserved; update the preview and retry.",
        },
        committed.error.code === "40001" ? 409 : 400,
      );
    return reply({
      ok: true,
      counters: plan.counters,
      checks: plan.checks,
      needsReview: plan.counters.needsConfirmation,
      preview,
    });
  } catch {
    return reply(
      {
        error:
          "This handoff could not be reconciled. Check its format and confirmed details, then retry.",
      },
      400,
    );
  }
}
