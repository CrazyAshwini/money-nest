import type { WorkspaceData } from "../types";

export type Raw = Record<string, unknown>;
export type HandoffCollection = Exclude<keyof WorkspaceData, "auditEvents">;
export type HandoffConfirmationState =
  | "confirmed"
  | "partially_confirmed"
  | "needs_confirmation"
  | "failed_attempt"
  | "rejected";
export interface HandoffSource {
  collection: HandoffCollection;
  recordId: string;
  sourceSystem: string;
  sourceObjectId: string;
  evidence: Raw;
  confirmationState: HandoffConfirmationState;
}
export interface HandoffDecision {
  sourceObjectId: string;
  action: "match" | "create" | "skip";
  recordId?: string;
  /** A separate, explicit confirmation of changed financial fields. */
  confirmCorrections?: boolean;
}
export interface HandoffReviewItem {
  sourceObjectId: string;
  collection: HandoffCollection;
  reason: string;
  candidateIds: string[];
  incoming: Raw;
  current?: Raw;
}
export interface HandoffCheck {
  name: string;
  passed: boolean;
  expected: string | number;
  actual: string | number;
}
export interface HandoffPlan {
  workspace: WorkspaceData;
  changes: WorkspaceData;
  sources: HandoffSource[];
  reviewItems: HandoffReviewItem[];
  counters: {
    created: number;
    matched: number;
    updated: number;
    ignored: number;
    needsConfirmation: number;
    transactionsCreated: number;
  };
  checks: HandoffCheck[];
  warnings: string[];
}
