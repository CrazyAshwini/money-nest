import { z } from "zod";
import { validateWorkspaceRecord } from "../validation";
import type { Account, Transaction, WorkspaceData } from "../types";
import type {
  HandoffCollection,
  HandoffConfirmationState,
  HandoffDecision,
  HandoffPlan,
  HandoffSource,
  Raw,
} from "./types";
import {
  asRaw,
  cleanOptionalFields,
  date,
  stableId,
  text,
} from "./normalization";

export function createHandoffContext(
  input: unknown,
  current: WorkspaceData,
  ownerId: string,
  knownSources: readonly unknown[],
  decisions: HandoffDecision[],
) {
  if (!z.string().uuid().safeParse(ownerId).success)
    throw new Error("The handoff needs a valid workspace owner.");
  const manifest = asRaw(input);
  if (manifest.currency !== "INR")
    throw new Error("The handoff currency must be INR.");
  const asOf = date(manifest.as_of);
  if (!asOf) throw new Error("The handoff needs its snapshot date.");
  for (const collection of Object.keys(current) as (keyof WorkspaceData)[]) {
    if (
      !Array.isArray(current[collection]) ||
      current[collection].some((row) => row.userId !== ownerId)
    )
      throw new Error("The handoff workspace ownership is invalid.");
  }
  const workspace = structuredClone(current);
  const changes = Object.fromEntries(
    Object.keys(current).map((key) => [key, []]),
  ) as unknown as WorkspaceData;
  const plan: HandoffPlan = {
    workspace,
    changes,
    sources: [],
    reviewItems: [],
    counters: {
      created: 0,
      matched: 0,
      updated: 0,
      ignored: 0,
      needsConfirmation: 0,
      transactionsCreated: 0,
    },
    checks: [],
    warnings: [],
  };
  const decisionById = new Map<string, HandoffDecision>();
  for (const decision of decisions) {
    if (decisionById.has(decision.sourceObjectId))
      throw new Error("A handoff source has conflicting decisions.");
    decisionById.set(decision.sourceObjectId, decision);
  }
  const sourceIndex = new Map<string, HandoffSource>();
  for (const inputSource of knownSources) {
    const raw = asRaw(inputSource);
    if (
      !(text(raw.collection) in current) ||
      raw.collection === "auditEvents" ||
      !z.string().uuid().safeParse(raw.recordId).success ||
      !text(raw.sourceSystem) ||
      !text(raw.sourceObjectId) ||
      ![
        "confirmed",
        "partially_confirmed",
        "needs_confirmation",
        "failed_attempt",
        "rejected",
      ].includes(text(raw.confirmationState))
    )
      throw new Error("A known handoff source is invalid.");
    const source = raw as unknown as HandoffSource;
    const key = `${source.collection}:${source.sourceSystem}:${source.sourceObjectId}`;
    const previous = sourceIndex.get(key);
    if (previous && previous.recordId !== source.recordId)
      throw new Error("A source identity maps to conflicting records.");
    sourceIndex.set(key, source);
  }
  const seenSourceIds = new Set<string>();
  const observed = (
    collection: HandoffCollection,
    recordId: string,
    sourceId: string,
    evidence: Raw,
    state: HandoffConfirmationState = "confirmed",
    sourceSystem = "notion",
  ) => {
    const source: HandoffSource = {
      collection,
      recordId,
      sourceSystem,
      sourceObjectId: sourceId,
      evidence,
      confirmationState: state,
    };
    plan.sources.push(source);
    sourceIndex.set(`${collection}:${sourceSystem}:${sourceId}`, source);
  };
  const exact = <K extends HandoffCollection>(
    collection: K,
    sourceId: string,
    sourceSystem = "notion",
  ): WorkspaceData[K][number] | undefined => {
    const recorded = sourceIndex.get(
      `${collection}:${sourceSystem}:${sourceId}`,
    );
    if (recorded) {
      const found = workspace[collection].find(
        (row) => row.id === recorded.recordId,
      );
      if (!found)
        throw new Error("A handoff source refers to a missing record.");
      return found;
    }
    const id = stableId(ownerId, collection, `${sourceSystem}:${sourceId}`);
    return workspace[collection].find(
      (row) =>
        row.id === id ||
        (collection === "transactions" &&
          (row as Transaction).sourceSystem === sourceSystem &&
          (row as Transaction).sourceObjectId === sourceId),
    );
  };
  const review = (
    collection: HandoffCollection,
    sourceId: string,
    incoming: object,
    reason: string,
    candidates: { id: string }[] = [],
    currentRow?: object,
  ) => {
    plan.reviewItems.push({
      collection,
      sourceObjectId: sourceId,
      reason,
      candidateIds: candidates.map((row) => row.id),
      incoming: incoming as Raw,
      ...(currentRow ? { current: currentRow as Raw } : {}),
    });
    plan.counters.needsConfirmation++;
  };
  const add = <K extends HandoffCollection>(
    collection: K,
    record: WorkspaceData[K][number],
  ) => {
    const target = workspace[collection] as WorkspaceData[K][number][];
    const output = changes[collection] as WorkspaceData[K][number][];
    target.push(record);
    output.push(record);
    plan.counters.created++;
    if (collection === "transactions") plan.counters.transactionsCreated++;
  };
  const replace = <K extends HandoffCollection>(
    collection: K,
    inputRecord: WorkspaceData[K][number],
  ) => {
    const record = cleanOptionalFields(inputRecord);
    const target = workspace[collection] as WorkspaceData[K][number][];
    const output = changes[collection] as WorkspaceData[K][number][];
    const index = target.findIndex((row) => row.id === record.id);
    if (index < 0)
      throw new Error("The matched handoff record no longer exists.");
    if (
      JSON.stringify(cleanOptionalFields(target[index])) ===
      JSON.stringify(record)
    )
      return;
    // Validate against the previous record so allocated payments cannot silently change.
    validateWorkspaceRecord(workspace, collection, record, ownerId);
    target[index] = record;
    output.push(record);
    plan.counters.updated++;
  };
  const owned = (collection: string, sourceId: string, system = "notion") => ({
    id: stableId(ownerId, collection, `${system}:${sourceId}`),
    userId: ownerId,
  });
  const accounts = new Map<string, Account>();
  const accountSourceIds = new Map<string, string>();
  return {
    manifest,
    current,
    ownerId,
    asOf,
    workspace,
    changes,
    plan,
    decisionById,
    seenSourceIds,
    observed,
    exact,
    review,
    add,
    replace,
    owned,
    accounts,
    accountSourceIds,
  };
}

export type HandoffContext = ReturnType<typeof createHandoffContext>;
