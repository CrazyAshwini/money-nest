import "server-only";
import { NextRequest } from "next/server";
import {
  AIOwnerAuthenticationError,
  authenticateAIOwnerRequest,
} from "@/lib/ai-owner-auth";
import { privateResponse } from "@/lib/private-profile-http";
import {
  PrivateProfileError,
  privateProfileEnabled,
  readPrivateProfile,
  savePrivateRecord,
} from "@/lib/private-profile-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readCloudFinanceState } from "@/lib/supabase/commerce-store";
import { toDatabase } from "@/lib/supabase/validation";
import { readReceiptAIConfiguration } from "@/lib/ai-receipt-service";
import {
  confirmTransactionPost,
  executeNestBotQuery,
} from "@/lib/nestbot-service";
import type { BotRequestPayload } from "@/lib/nestbot-types";
import type { WorkspaceData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    await authenticateAIOwnerRequest(request, false);
    const configuration = readReceiptAIConfiguration();
    return privateResponse({
      configured: Boolean(configuration),
      provider: configuration?.provider || "Google Gemini",
      model: configuration?.model || "gemini-2.5-flash",
    });
  } catch (error) {
    if (error instanceof AIOwnerAuthenticationError) {
      return privateResponse(
        { error: error.message, code: error.code },
        error.status,
      );
    }
    return privateResponse(
      { error: "NestBot is unavailable.", code: "bot_unavailable" },
      503,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as BotRequestPayload | null;
    if (!body || typeof body !== "object") {
      return privateResponse({ error: "Invalid request payload." }, 400);
    }

    const isWrite = body.action === "confirm_transaction";
    const { ownerId, cloud } = await authenticateAIOwnerRequest(request, isWrite);

    let workspace: WorkspaceData;
    let supabaseClient: Awaited<ReturnType<typeof createSupabaseServerClient>> = null;
    const sessionToken = request.cookies.get("finance-os-private-session")?.value ?? "";

    if (!cloud || privateProfileEnabled()) {
      const privateData = await readPrivateProfile(sessionToken);
      if (!privateData) {
        throw new PrivateProfileError("auth", "Sign in to access your profile.");
      }
      workspace = privateData.workspace;
    } else {
      supabaseClient = await createSupabaseServerClient();
      if (!supabaseClient) {
        return privateResponse({ error: "Cloud storage is unavailable." }, 503);
      }
      const state = await readCloudFinanceState(supabaseClient, ownerId);
      workspace = state.workspace;
    }

    // Confirmation of transaction mutation
    if (isWrite) {
      if (!body.confirmedTransaction) {
        return privateResponse({ error: "Missing transaction confirmation draft." }, 400);
      }

      const transaction = confirmTransactionPost(
        workspace,
        ownerId,
        body.confirmedTransaction,
      );

      if (!cloud || privateProfileEnabled()) {
        await savePrivateRecord(sessionToken, "transactions", transaction);
      } else if (supabaseClient) {
        const dbRecord = toDatabase(transaction as unknown as Record<string, unknown>, ownerId);
        const { error: upsertErr } = await supabaseClient
          .from("transactions")
          .upsert(dbRecord, { onConflict: "id" });
        if (upsertErr) {
          return privateResponse(
            { error: `Database error: ${upsertErr.message}` },
            400,
          );
        }
      }

      return privateResponse({
        configured: Boolean(readReceiptAIConfiguration()),
        reply: `Transaction recorded: ₹${transaction.amount} for "${transaction.description}" on ${transaction.occurredOn}.`,
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Posted successfully! Transaction ID: ${transaction.id}. Amount: ₹${transaction.amount}.`,
          createdAt: new Date().toISOString(),
          confirmedTransactionId: transaction.id,
        },
        confirmedTransactionId: transaction.id,
      });
    }

    // Chat query execution
    const result = await executeNestBotQuery(workspace, ownerId, body);
    return privateResponse(result);
  } catch (error) {
    if (error instanceof AIOwnerAuthenticationError) {
      return privateResponse(
        { error: error.message, code: error.code },
        error.status,
      );
    }
    if (error instanceof PrivateProfileError && error.code === "auth") {
      return privateResponse(
        { error: "Sign in to your profile.", code: "authentication_required" },
        401,
      );
    }
    return privateResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "An error occurred while processing your request.",
        code: "bot_error",
      },
      500,
    );
  }
}
