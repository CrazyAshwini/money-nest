import type { WorkspaceData } from "../types";
import type { HandoffDecision, HandoffPlan } from "./types";
import { createHandoffContext } from "./create-context";
import { planAccountReports } from "./account-reports";
import { planTransactions } from "./transactions";
import { planContracts } from "./contracts";
import { reconcileHandoff } from "./reconciliation";

/** Plans an append/update merge. Uncertain identities never create a second payment. */
export function planHandoffImport(
  input: unknown,
  current: WorkspaceData,
  ownerId: string,
  knownSources: readonly unknown[] = [],
  decisions: HandoffDecision[] = [],
): HandoffPlan {
  const context = createHandoffContext(
    input,
    current,
    ownerId,
    knownSources,
    decisions,
  );
  const reconciliation = planAccountReports(context);
  const transactionRows = planTransactions(context);
  planContracts(context);
  return reconcileHandoff(context, reconciliation, transactionRows);
}
