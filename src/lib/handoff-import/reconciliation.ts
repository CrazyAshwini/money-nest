import Decimal from "decimal.js";
import { validateWorkspaceRecord } from "../validation";
import type { WorkspaceData } from "../types";
import type { HandoffContext } from "./create-context";
import type { HandoffPlan, Raw } from "./types";
import {
  asRaw,
  date,
  kinds,
  money,
  requiredMoney,
  text,
} from "./normalization";

export function reconcileHandoff(
  context: HandoffContext,
  reconciliation: Raw | null,
  transactionRows: Raw[],
): HandoffPlan {
  const { manifest, workspace, ownerId, changes, plan, accounts } = context;
  if (reconciliation) {
    const bank = accounts.get(text(reconciliation.account));
    const periodStart = date(reconciliation.statement_period_start),
      periodEnd = date(reconciliation.statement_period_end);
    if (!bank || !periodStart || !periodEnd)
      throw new Error(
        "The statement reconciliation has invalid account or dates.",
      );
    const check = (
      name: string,
      actual: string | number,
      expected: string | number,
    ) =>
      plan.checks.push({ name, actual, expected, passed: actual === expected });
    const actualOpening = money(reconciliation.opening_inr),
      expectedClosing = money(reconciliation.closing_inr);
    if (actualOpening == null || expectedClosing == null)
      throw new Error(
        "The statement reconciliation needs opening and closing values.",
      );
    const sum = (values: string[]) =>
      values
        .reduce((value, amount) => value.plus(amount), new Decimal(0))
        .toFixed(2);
    const posted = transactionRows.filter(
      (row) =>
        row.date &&
        String(row.date) >= periodStart &&
        String(row.date) <= periodEnd,
    );
    const debits = posted.filter(
        (row) => row.from_account === reconciliation.account,
      ),
      credits = posted.filter(
        (row) => row.to_account === reconciliation.account,
      );
    check(
      "statementDebitCount",
      debits.length,
      Number(reconciliation.debit_count),
    );
    check(
      "statementCreditCount",
      credits.length,
      Number(reconciliation.credit_count),
    );
    check(
      "statementDebitTotal",
      sum(debits.map((row) => requiredMoney(row.amount_inr))),
      money(reconciliation.debit_total_inr)!,
    );
    check(
      "statementCreditTotal",
      sum(credits.map((row) => requiredMoney(row.amount_inr))),
      money(reconciliation.credit_total_inr)!,
    );
    check(
      "statementClosingBalance",
      new Decimal(actualOpening)
        .plus(sum(credits.map((row) => requiredMoney(row.amount_inr))))
        .minus(sum(debits.map((row) => requiredMoney(row.amount_inr))))
        .toFixed(2),
      expectedClosing,
    );
  }
  const counts =
    manifest.counts && typeof manifest.counts === "object"
      ? asRaw(manifest.counts)
      : null;
  if (counts?.transactions != null)
    plan.checks.push({
      name: "manifestTransactionCount",
      actual: transactionRows.length,
      expected: Number(counts.transactions),
      passed: transactionRows.length === Number(counts.transactions),
    });
  if (counts) {
    for (const kind of Object.keys(kinds)) {
      if (counts[kind] != null) {
        const actual = transactionRows.filter(
          (row) => row.type === kind,
        ).length;
        plan.checks.push({
          name: `manifestTypeCount:${kind}`,
          actual,
          expected: Number(counts[kind]),
          passed: actual === Number(counts[kind]),
        });
      }
    }
    if (counts.undated != null) {
      const actual = transactionRows.filter((row) => row.date == null).length;
      plan.checks.push({
        name: "manifestUndatedCount",
        actual,
        expected: Number(counts.undated),
        passed: actual === Number(counts.undated),
      });
    }
  }
  if (manifest.face_amount_totals_inr != null) {
    const claimedTotals = asRaw(manifest.face_amount_totals_inr);
    for (const kind of Object.keys(kinds)) {
      if (claimedTotals[kind] != null) {
        const expected = money(claimedTotals[kind])!;
        const actual = transactionRows
          .filter((row) => row.type === kind)
          .reduce(
            (total, row) => total.plus(requiredMoney(row.amount_inr)),
            new Decimal(0),
          )
          .toFixed(2);
        plan.checks.push({
          name: `manifestFaceTotal:${kind}`,
          actual,
          expected,
          passed: actual === expected,
        });
      }
    }
  }
  if (plan.checks.some((check) => !check.passed))
    throw new Error(
      "The handoff does not satisfy its supplied ledger counts and statement reconciliation.",
    );
  if (plan.reviewItems.length)
    plan.warnings.push(
      "Some identities or financial details need review; held observations do not create duplicate payments.",
    );
  for (const collection of Object.keys(changes) as (keyof WorkspaceData)[]) {
    for (const row of changes[collection])
      validateWorkspaceRecord(workspace, collection, row, ownerId);
  }
  return plan;
}
