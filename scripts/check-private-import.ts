/** Private local verification: logs counts and pass/fail only, never source contents. */
import { readFile } from "node:fs/promises";
import { mapPrivateFinanceExport } from "../src/lib/private-import";
import {
  accountBalance,
  groupSummary,
  monthlySummary,
} from "../src/lib/finance";
import Decimal from "decimal.js";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Pass the absolute private export path.");
const source = JSON.parse(await readFile(inputPath, "utf8"));
const result = mapPrivateFinanceExport(
  source,
  "20000000-0000-4000-8000-000000000001",
);
const month = String(source.export_as_of).slice(0, 7);
const monthly = monthlySummary(result.workspace, month);
const bank = result.workspace.accounts.find(
  (account) => account.kind === "bank" && account.openingBalance !== null,
);
const balance = bank
  ? accountBalance(result.workspace, bank.id, source.export_as_of)
  : null;
const checks = {
  allSavedTransactions:
    result.counts.transactions === source.coverage?.total_saved_records,
  datedExpenseCount:
    monthly.expenseCount === source.coverage?.dated_october_expenses,
  exactGrossSpending:
    monthly.gross === source.coverage?.dated_october_gross_spending,
  bankLedgerMatchesStatement: balance?.reconciliation === "matched",
  allAccountsPreserved: result.counts.accounts === source.accounts.length,
  allFixedDepositsPreserved:
    result.counts.fixedDeposits === source.fixed_deposits.length,
  allInstallmentsPreserved: result.counts.emis === source.emis.length,
  undatedPurchasesPending:
    result.workspace.transactions.filter(
      (transaction) =>
        transaction.kind === "expense" &&
        transaction.status === "pending_review" &&
        !transaction.occurredOn,
    ).length === source.coverage?.undated_purchase_count,
  noInventedPaymentAllocations:
    result.counts.allocations === 0 && result.counts.emiAllocations === 0,
  noInventedLoanOutstanding: result.workspace.loans.every(
    (loan) => loan.reportedOutstanding === null,
  ),
  allSplitPoolsPreserved: result.counts.groups === source.splits.length,
  poolBalancesMatchSource: result.workspace.groups.every((group, index) =>
    new Decimal(
      groupSummary(result.workspace, group.id).poolRemaining ?? "0",
    ).eq(source.splits[index].unallocated_difference),
  ),
  noInventedPersonalShares: result.workspace.groups.every(
    (group) => !groupSummary(result.workspace, group.id).ownerShareKnown,
  ),
};
console.log(
  JSON.stringify(
    { counts: result.counts, warningCount: result.warnings.length, checks },
    null,
    2,
  ),
);
if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
