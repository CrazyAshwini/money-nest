import Decimal from "decimal.js";
import type {
  Account,
  AccountSnapshot,
  Bill,
  Emi,
  Money,
  Transaction,
  WorkspaceData,
} from "./types";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
const ZERO = new Decimal(0);
const dec = (value: Money | number | null | undefined) =>
  new Decimal(value ?? 0);
export const money = (value: Money | number | Decimal) =>
  new Decimal(value).toFixed(2);
export function sumMoney(values: Iterable<Money | null | undefined>): Money {
  return Array.from(values)
    .reduce<Decimal>((total, value) => total.plus(dec(value)), ZERO)
    .toFixed(2);
}
export const addMoney = (a: Money, b: Money) => dec(a).plus(b).toFixed(2);
export const subtractMoney = (a: Money, b: Money) => dec(a).minus(b).toFixed(2);
export const compareMoney = (a: Money, b: Money) => dec(a).comparedTo(b);
export function formatMoney(
  value: Money | number | null | undefined,
  options: { compact?: boolean; decimals?: boolean | number } | boolean = {},
): string {
  const amount = dec(value);
  const opts = typeof options === "boolean" ? { compact: options } : options;
  const sign = amount.isNegative() ? "−" : "";
  const absolute = amount.abs();
  if (opts.compact) {
    const scale = absolute.gte(10000000)
      ? ([10000000, "Cr"] as const)
      : absolute.gte(100000)
        ? ([100000, "L"] as const)
        : absolute.gte(1000)
          ? ([1000, "K"] as const)
          : null;
    if (scale)
      return `${sign}₹${absolute.div(scale[0]).toFixed(1).replace(/\.0$/, "")}${scale[1]}`;
  }
  const decimalPlaces =
    typeof opts.decimals === "number"
      ? Math.max(0, Math.min(2, Math.floor(opts.decimals)))
      : opts.decimals === false
        ? 0
        : 2;
  const [whole, cents] = absolute.toFixed(decimalPlaces).split(".");
  const grouped =
    whole.length > 3
      ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}`
      : whole;
  return `${sign}₹${grouped}${cents === undefined ? "" : `.${cents}`}`;
}
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
/** Interpret timestamp cutoffs in the workspace timezone, including near midnight. */
export function localDateISO(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function formatDate(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "Not confirmed";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "Not confirmed";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...options,
    timeZone: "Asia/Kolkata",
  }).format(date);
}
/** Direction follows recorded account links, regardless of transaction classification. */
export function transactionDirection(
  transaction: Pick<Transaction, "fromAccountId" | "toAccountId">,
): "incoming" | "outgoing" | "between_accounts" | "unknown" {
  if (transaction.fromAccountId && transaction.toAccountId)
    return "between_accounts";
  if (transaction.toAccountId) return "incoming";
  if (transaction.fromAccountId) return "outgoing";
  return "unknown";
}

/** Only stable Notion page identities can produce a clickable source link. */
export function transactionNotionUrl(
  transaction: Pick<Transaction, "sourceSystem" | "sourceObjectId">,
): string | null {
  if (transaction.sourceSystem !== "notion" || !transaction.sourceObjectId)
    return null;
  const pageId = transaction.sourceObjectId.replaceAll("-", "");
  return /^[a-f0-9]{32}$/i.test(pageId)
    ? `https://www.notion.so/${pageId}`
    : null;
}
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}
export function latestSnapshot(
  data: WorkspaceData,
  accountId: string,
  asOf = todayISO(),
): AccountSnapshot | undefined {
  const account = data.accounts.find((a) => a.id === accountId);
  return data.snapshots
    .filter(
      (s) =>
        s.accountId === accountId &&
        s.userId === account?.userId &&
        localDateISO(s.asOf) <= localDateISO(asOf),
    )
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))[0];
}
export const isDebtAccount = (account: Pick<Account, "kind">) =>
  account.kind === "credit_card" || account.kind === "pay_later";
/** Latest usable cash baseline, independent of newer reports of other fields. */
export function latestBalanceSnapshot(
  data: WorkspaceData,
  accountId: string,
  asOf = todayISO(),
): AccountSnapshot | undefined {
  const account = data.accounts.find((row) => row.id === accountId);
  if (!account || isDebtAccount(account)) return undefined;
  return latestSnapshot(
    {
      ...data,
      snapshots: data.snapshots.filter((row) => row.reportedBalance != null),
    },
    accountId,
    asOf,
  );
}
export function ledgerBalance(
  data: WorkspaceData,
  accountId: string,
  asOf = todayISO(),
): Money | null {
  const account = data.accounts.find((a) => a.id === accountId);
  const cutoff = localDateISO(asOf);
  if (
    !account ||
    account.openingBalance == null ||
    !account.openingBalanceDate ||
    account.openingBalanceDate > cutoff
  )
    return null;
  let balance = dec(account.openingBalance);
  for (const transaction of data.transactions) {
    if (
      transaction.userId !== account.userId ||
      transaction.status !== "posted" ||
      !transaction.occurredOn ||
      transaction.occurredOn < account.openingBalanceDate ||
      transaction.occurredOn > cutoff
    )
      continue;
    // Cash outflows reduce assets; card purchases increase liabilities.
    const polarity = isDebtAccount(account) ? -1 : 1;
    if (transaction.fromAccountId === accountId)
      balance = balance.minus(dec(transaction.amount).times(polarity));
    if (transaction.toAccountId === accountId)
      balance = balance.plus(dec(transaction.amount).times(polarity));
  }
  return balance.toFixed(2);
}
export interface AccountBalance {
  reported: Money | null;
  calculated: Money | null;
  difference: Money | null;
  /** Asset balance from the last known baseline and subsequent posted movements. */
  current: Money | null;
  currentAsOf: string | null;
  currentBaselineAsOf: string | null;
  currentSource: "snapshot" | "opening" | "unknown";
  movementsSinceSnapshot: number;
  asOf: string | null;
  calculatedAsOf: string;
  reconciliation: "matched" | "difference" | "unknown";
  snapshot?: AccountSnapshot;
}
export function accountBalance(
  data: WorkspaceData,
  accountId: string,
  asOf = todayISO(),
): AccountBalance {
  const account = data.accounts.find((a) => a.id === accountId);
  const snapshot = latestSnapshot(data, accountId, asOf);
  const reported =
    account && isDebtAccount(account)
      ? (snapshot?.reportedOutstanding ?? null)
      : (snapshot?.reportedBalance ?? null);
  // Reconcile the ledger to the actual snapshot date, never today's ledger to an old report.
  const calculatedAsOf = snapshot
    ? localDateISO(snapshot.asOf)
    : localDateISO(asOf);
  let calculated = ledgerBalance(data, accountId, calculatedAsOf);
  if (
    account &&
    !isDebtAccount(account) &&
    snapshot?.reportedBalance != null &&
    calculated !== null
  ) {
    let atSnapshot = dec(calculated);
    for (const transaction of data.transactions) {
      if (
        transaction.userId !== account.userId ||
        transaction.status !== "posted" ||
        transaction.occurredOn !== calculatedAsOf
      )
        continue;
      // These confirmed movements occurred outside this exact report, although
      // their date-only ledger entries share its calendar day.
      if (
        transaction.fromAccountId === accountId &&
        transaction.fromBalanceSnapshotId === snapshot.id
      )
        atSnapshot = atSnapshot.plus(dec(transaction.amount));
      if (
        transaction.toAccountId === accountId &&
        transaction.toBalanceSnapshotId === snapshot.id
      )
        atSnapshot = atSnapshot.minus(dec(transaction.amount));
    }
    calculated = atSnapshot.toFixed(2);
  }
  const difference =
    reported !== null && calculated !== null
      ? subtractMoney(reported, calculated)
      : null;
  const cutoff = localDateISO(asOf);
  let current = reported;
  let currentAsOf = snapshot?.asOf ?? null;
  let currentBaselineAsOf = reported !== null ? (snapshot?.asOf ?? null) : null;
  let currentSource: AccountBalance["currentSource"] =
    reported === null ? "unknown" : "snapshot";
  let movementsSinceSnapshot = 0;
  if (account && !isDebtAccount(account)) {
    // A newer report of another field must not erase a known cash baseline.
    // Reconciliation above still uses the newest snapshot without substitution.
    const balanceSnapshot = latestBalanceSnapshot(data, accountId, asOf);
    if (balanceSnapshot?.reportedBalance != null) {
      let updated = dec(balanceSnapshot.reportedBalance);
      const snapshotDate = localDateISO(balanceSnapshot.asOf);
      currentSource = "snapshot";
      currentAsOf = balanceSnapshot.asOf;
      currentBaselineAsOf = balanceSnapshot.asOf;
      for (const transaction of data.transactions) {
        if (
          transaction.userId !== account.userId ||
          transaction.status !== "posted" ||
          !transaction.occurredOn ||
          transaction.occurredOn < snapshotDate ||
          transaction.occurredOn > cutoff
        )
          continue;
        // Same-day movements are covered unless explicitly confirmed outside
        // this exact report. Entry timestamps never establish payment order.
        const afterSnapshotDay = transaction.occurredOn > snapshotDate;
        const fromMovement =
          transaction.fromAccountId === accountId &&
          (afterSnapshotDay ||
            transaction.fromBalanceSnapshotId === balanceSnapshot.id);
        const toMovement =
          transaction.toAccountId === accountId &&
          (afterSnapshotDay ||
            transaction.toBalanceSnapshotId === balanceSnapshot.id);
        if (!fromMovement && !toMovement) continue;
        if (fromMovement) updated = updated.minus(dec(transaction.amount));
        if (toMovement) updated = updated.plus(dec(transaction.amount));
        movementsSinceSnapshot++;
      }
      current = updated.toFixed(2);
      if (movementsSinceSnapshot > 0) currentAsOf = cutoff;
    } else {
      current = ledgerBalance(data, accountId, cutoff);
      currentSource = current === null ? "unknown" : "opening";
      currentAsOf = current === null ? null : cutoff;
      currentBaselineAsOf =
        current === null ? null : (account.openingBalanceDate ?? null);
    }
  }
  return {
    reported,
    calculated,
    difference,
    current,
    currentAsOf,
    currentBaselineAsOf,
    currentSource,
    movementsSinceSnapshot,
    asOf: snapshot?.asOf ?? null,
    calculatedAsOf,
    reconciliation:
      difference === null
        ? "unknown"
        : dec(difference).isZero()
          ? "matched"
          : "difference",
    snapshot,
  };
}
export interface MonthlySummary {
  gross: Money;
  refunds: Money;
  unexplainedRefunds: Money;
  net: Money;
  income: Money;
  expenseCount: number;
}
export function monthlySummary(
  data: WorkspaceData,
  month: string,
): MonthlySummary {
  const posted = data.transactions.filter(
    (t) => t.status === "posted" && t.occurredOn?.startsWith(`${month}-`),
  );
  const expenses = posted.filter((t) => t.kind === "expense");
  // A returned transfer is cash movement, not a refund of spending. Only matched purchase refunds reduce spend.
  const refunds = data.transactions
    .filter(
      (t) =>
        t.status === "posted" &&
        t.occurredOn &&
        t.kind === "refund" &&
        t.refundOfTransactionId,
    )
    .sort(
      (a, b) =>
        a.occurredOn!.localeCompare(b.occurredOn!) || a.id.localeCompare(b.id),
    );
  const alreadyMatched = new Map<string, Decimal>();
  let matchedThisMonth = ZERO;
  let unexplainedThisMonth = ZERO;
  for (const refund of refunds) {
    const original = data.transactions.find(
      (t) =>
        t.id === refund.refundOfTransactionId &&
        t.userId === refund.userId &&
        t.kind === "expense" &&
        t.status === "posted" &&
        t.occurredOn,
    );
    if (!original) continue;
    const previous = alreadyMatched.get(original.id) ?? ZERO;
    const matched = Decimal.min(
      dec(refund.amount),
      Decimal.max(0, dec(original.amount).minus(previous)),
    );
    alreadyMatched.set(original.id, previous.plus(matched));
    if (refund.occurredOn!.startsWith(`${month}-`)) {
      matchedThisMonth = matchedThisMonth.plus(matched);
      unexplainedThisMonth = unexplainedThisMonth.plus(
        dec(refund.amount).minus(matched),
      );
    }
  }
  const gross = sumMoney(expenses.map((t) => t.amount));
  const refundTotal = matchedThisMonth.toFixed(2);
  return {
    gross,
    refunds: refundTotal,
    unexplainedRefunds: unexplainedThisMonth.toFixed(2),
    net: subtractMoney(gross, refundTotal),
    income: sumMoney(
      posted.filter((t) => t.kind === "income").map((t) => t.amount),
    ),
    expenseCount: expenses.length,
  };
}
export function spendingByCategory(
  data: WorkspaceData,
  month: string,
): { category: string; amount: Money; percentage: number; count: number }[] {
  const totals = new Map<string, { amount: Money; count: number }>();
  for (const transaction of data.transactions) {
    if (
      transaction.status !== "posted" ||
      transaction.kind !== "expense" ||
      !transaction.occurredOn?.startsWith(`${month}-`)
    )
      continue;
    const category = transaction.category || "Other";
    const current = totals.get(category) ?? { amount: "0.00", count: 0 };
    totals.set(category, {
      amount: addMoney(current.amount, transaction.amount),
      count: current.count + 1,
    });
  }
  const gross = dec(sumMoney(Array.from(totals.values()).map((v) => v.amount)));
  return Array.from(totals, ([category, total]) => ({
    category,
    ...total,
    percentage: gross.isZero()
      ? 0
      : dec(total.amount).div(gross).times(100).toNumber(),
  })).sort((a, b) => compareMoney(b.amount, a.amount));
}
export function monthlyTrend(
  data: WorkspaceData,
  months: string[],
): ({ month: string; label: string } & MonthlySummary)[] {
  return months.map((month) => ({
    month,
    label: new Intl.DateTimeFormat("en-IN", {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${month}-01T00:00:00Z`)),
    ...monthlySummary(data, month),
  }));
}
export function dailySpending(
  data: WorkspaceData,
  month: string,
  options: { net?: boolean } = {},
): { date: string; day: number; amount: Money; cumulative: Money }[] {
  const days = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  let cumulative = "0.00";
  return Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const next = options.net
      ? monthlySummary(
          {
            ...data,
            transactions: data.transactions.filter(
              (t) => !t.occurredOn || t.occurredOn <= date,
            ),
          },
          month,
        ).net
      : addMoney(
          cumulative,
          sumMoney(
            data.transactions
              .filter(
                (t) =>
                  t.kind === "expense" &&
                  t.status === "posted" &&
                  t.occurredOn === date,
              )
              .map((t) => t.amount),
          ),
        );
    const amount = subtractMoney(next, cumulative);
    cumulative = next;
    return { date, day: index + 1, amount, cumulative };
  });
}

export interface AllocationValidation {
  valid: boolean;
  error: string | null;
}
const invalid = (error: string): AllocationValidation => ({
  valid: false,
  error,
});
const valid: AllocationValidation = { valid: true, error: null };
const positiveMoney = (amount: string) =>
  /^\d{1,12}(\.\d{1,2})?$/.test(amount) && dec(amount).gt(0);
function transactionAllocated(
  data: WorkspaceData,
  transactionId: string,
  excludingId?: string,
): Money {
  return sumMoney(
    [...data.allocations, ...data.emiAllocations]
      .filter((a) => a.transactionId === transactionId && a.id !== excludingId)
      .map((a) => a.amount),
  );
}
function paymentSource(
  data: WorkspaceData,
  transaction: Transaction,
  userId: string,
): boolean {
  const source = data.accounts.find(
    (a) => a.id === transaction.fromAccountId && a.userId === userId,
  );
  return Boolean(
    source && (source.kind === "bank" || source.kind === "wallet"),
  );
}
export function validateBillAllocation(
  data: WorkspaceData,
  billId: string,
  transactionId: string,
  amount: Money,
  excludingId?: string,
): AllocationValidation {
  if (!positiveMoney(amount))
    return invalid("Enter a positive amount with at most two decimal places.");
  const bill = data.bills.find((b) => b.id === billId);
  const transaction = data.transactions.find((t) => t.id === transactionId);
  if (!bill || !transaction || bill.userId !== transaction.userId)
    return invalid("The bill and payment must belong to the same workspace.");
  if (
    transaction.status !== "posted" ||
    !transaction.occurredOn ||
    !["bill_payment", "transfer"].includes(transaction.kind)
  )
    return invalid("Choose an existing posted and dated payment or transfer.");
  const account = data.accounts.find(
    (a) => a.id === bill.accountId && a.userId === bill.userId,
  );
  if (
    !account ||
    !isDebtAccount(account) ||
    !paymentSource(data, transaction, bill.userId) ||
    transaction.toAccountId !== bill.accountId
  )
    return invalid(
      "Payment must move from a bank or wallet to this bill's card or Pay Later account.",
    );
  if (
    dec(transactionAllocated(data, transactionId, excludingId))
      .plus(amount)
      .gt(transaction.amount)
  )
    return invalid("Allocations cannot exceed the payment transaction amount.");
  const billAllocated = sumMoney(
    data.allocations
      .filter((a) => a.billId === billId && a.id !== excludingId)
      .map((a) => a.amount),
  );
  if (
    dec(billAllocated)
      .plus(amount)
      .plus(dec(bill.statementCredits))
      .gt(bill.statementAmount)
  )
    return invalid("The allocation exceeds this statement's remaining amount.");
  return valid;
}
export function validateEmiAllocation(
  data: WorkspaceData,
  emiId: string,
  transactionId: string,
  amount: Money,
  excludingId?: string,
): AllocationValidation {
  if (!positiveMoney(amount))
    return invalid("Enter a positive amount with at most two decimal places.");
  const emi = data.emis.find((e) => e.id === emiId);
  const loan = data.loans.find((l) => l.id === emi?.loanId);
  const transaction = data.transactions.find((t) => t.id === transactionId);
  if (
    !emi ||
    !loan ||
    !transaction ||
    emi.userId !== transaction.userId ||
    loan.userId !== emi.userId
  )
    return invalid(
      "The installment and payment must belong to the same workspace.",
    );
  if (
    transaction.status !== "posted" ||
    !transaction.occurredOn ||
    !["bill_payment", "transfer"].includes(transaction.kind)
  )
    return invalid(
      "Choose an existing posted and dated repayment or transfer.",
    );
  if (
    !loan.repaymentAccountId ||
    transaction.fromAccountId !== loan.repaymentAccountId ||
    !paymentSource(data, transaction, loan.userId)
  )
    return invalid(
      "The debit must come from this loan's confirmed repayment account.",
    );
  if (
    transaction.toAccountId &&
    data.accounts.some(
      (a) => a.id === transaction.toAccountId && a.userId === loan.userId,
    )
  )
    return invalid(
      "A transfer to another tracked account cannot also repay an external loan.",
    );
  if (
    dec(transactionAllocated(data, transactionId, excludingId))
      .plus(amount)
      .gt(transaction.amount)
  )
    return invalid("Allocations cannot exceed the payment transaction amount.");
  const emiAllocated = sumMoney(
    data.emiAllocations
      .filter((a) => a.emiId === emiId && a.id !== excludingId)
      .map((a) => a.amount),
  );
  if (dec(emiAllocated).plus(amount).gt(emi.amount))
    return invalid(
      "The allocation exceeds this installment's remaining amount.",
    );
  return valid;
}
export interface BillSummary {
  statement: Money;
  paid: Money;
  credits: Money;
  remaining: Money;
  provisional: Money;
  status: "paid" | "partial" | "unpaid" | "overdue" | "unknown";
}
export function billSummary(
  data: WorkspaceData,
  billOrId: Bill | string,
  today = todayISO(),
): BillSummary {
  const bill =
    typeof billOrId === "string"
      ? data.bills.find((b) => b.id === billOrId)
      : billOrId;
  if (!bill)
    return {
      statement: "0.00",
      paid: "0.00",
      credits: "0.00",
      remaining: "0.00",
      provisional: "0.00",
      status: "unknown",
    };
  const allocations = data.allocations.filter(
    (a) =>
      a.billId === bill.id &&
      a.userId === bill.userId &&
      validateBillAllocation(data, bill.id, a.transactionId, a.amount, a.id)
        .valid,
  );
  const paid = sumMoney(
    allocations.filter((a) => a.verified).map((a) => a.amount),
  );
  const provisional = sumMoney(
    allocations.filter((a) => !a.verified).map((a) => a.amount),
  );
  const credits = money(bill.statementCredits ?? "0");
  const remaining = Decimal.max(
    0,
    dec(bill.statementAmount).minus(paid).minus(credits),
  ).toFixed(2);
  const status = dec(remaining).isZero()
    ? "paid"
    : !bill.dueDate
      ? "unknown"
      : bill.dueDate < today
        ? "overdue"
        : dec(paid).gt(0) || dec(credits).gt(0)
          ? "partial"
          : "unpaid";
  return {
    statement: bill.statementAmount,
    paid,
    credits,
    remaining,
    provisional,
    status,
  };
}
export interface EmiSummary {
  amount: Money;
  paid: Money;
  remaining: Money;
  status: "paid" | "partial" | "upcoming" | "due_today" | "overdue";
}
export function emiSummary(
  data: WorkspaceData,
  emiOrId: Emi | string,
  today = todayISO(),
): EmiSummary {
  const emi =
    typeof emiOrId === "string"
      ? data.emis.find((e) => e.id === emiOrId)
      : emiOrId;
  if (!emi) throw new Error("Installment not found.");
  const paid = sumMoney(
    data.emiAllocations
      .filter(
        (a) =>
          a.emiId === emi.id &&
          a.userId === emi.userId &&
          validateEmiAllocation(data, emi.id, a.transactionId, a.amount, a.id)
            .valid,
      )
      .map((a) => a.amount),
  );
  const remaining = Decimal.max(0, dec(emi.amount).minus(paid)).toFixed(2);
  const status = dec(remaining).isZero()
    ? "paid"
    : emi.dueDate < today
      ? "overdue"
      : emi.dueDate === today
        ? "due_today"
        : dec(paid).gt(0)
          ? "partial"
          : "upcoming";
  return { amount: emi.amount, paid, remaining, status };
}
export function dashboardMetrics(
  data: WorkspaceData,
  month: string,
  today = todayISO(),
) {
  const banks = data.accounts.filter((a) => a.kind === "bank" && a.active);
  const cards = data.accounts.filter(
    (a) => a.kind === "credit_card" && a.active,
  );
  const payLater = data.accounts.filter(
    (a) => a.kind === "pay_later" && a.active,
  );
  const bankBalances = banks.map((a) => accountBalance(data, a.id, today));
  const cardSnapshots = cards.map((a) => latestSnapshot(data, a.id, today));
  const payLaterSnapshots = payLater.map((a) =>
    latestSnapshot(data, a.id, today),
  );
  const spending = monthlySummary(data, month);
  const bankDates = bankBalances
    .map((balance) =>
      balance.currentAsOf ? localDateISO(balance.currentAsOf) : undefined,
    )
    .filter((v): v is string => Boolean(v));
  return {
    bankBalance: sumMoney(bankBalances.map((balance) => balance.current)),
    bankAsOf: bankDates.length ? [...bankDates].sort()[0] : null,
    reportedBankCount: bankBalances.filter(
      (balance) => balance.reported !== null,
    ).length,
    knownBankCount: bankBalances.filter((balance) => balance.current !== null)
      .length,
    updatedBankCount: bankBalances.filter(
      (balance) => balance.movementsSinceSnapshot > 0,
    ).length,
    openingBankCount: bankBalances.filter(
      (balance) => balance.currentSource === "opening",
    ).length,
    totalBankCount: banks.length,
    monthSpending: spending.gross,
    netSpending: spending.net,
    expenseCount: spending.expenseCount,
    cardOutstanding: sumMoney(cardSnapshots.map((s) => s?.reportedOutstanding)),
    cardUsage: sumMoney(cardSnapshots.map((s) => s?.reportedUtilized)),
    reportedCardCount: cardSnapshots.filter(
      (s) => s?.reportedOutstanding != null,
    ).length,
    totalCardCount: cards.length,
    payLaterOutstanding: sumMoney(
      payLaterSnapshots.map((s) => s?.reportedOutstanding),
    ),
    reportedPayLaterCount: payLaterSnapshots.filter(
      (s) => s?.reportedOutstanding != null,
    ).length,
    totalPayLaterCount: payLater.length,
    reviewCount: data.transactions.filter((t) => t.status === "pending_review")
      .length,
    upcomingDue: sumMoney(
      data.bills
        .filter((b) => !b.dueDate || b.dueDate >= today)
        .map((b) => billSummary(data, b, today).remaining),
    ),
  };
}
export function groupSummary(data: WorkspaceData, groupId: string) {
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) throw new Error("Group not found.");
  const shares = data.shares.filter(
    (s) => s.groupId === groupId && s.userId === group.userId,
  );
  const settlements = data.settlements.filter(
    (s) =>
      s.groupId === groupId &&
      s.userId === group.userId &&
      positiveMoney(s.amount) &&
      data.transactions.some(
        (t) =>
          t.id === s.transactionId &&
          t.userId === group.userId &&
          t.status === "posted" &&
          Boolean(t.occurredOn) &&
          ["transfer", "refund"].includes(t.kind) &&
          dec(s.amount).lte(t.amount) &&
          (s.direction === "incoming"
            ? Boolean(t.toAccountId)
            : Boolean(t.fromAccountId)) &&
          dec(
            sumMoney(
              data.settlements
                .filter((other) => other.transactionId === t.id)
                .map((other) => other.amount),
            ),
          ).lte(t.amount),
      ),
  );
  const incoming = sumMoney(
    settlements.filter((s) => s.direction === "incoming").map((s) => s.amount),
  );
  const outgoing = sumMoney(
    settlements.filter((s) => s.direction === "outgoing").map((s) => s.amount),
  );
  const ownerShare = sumMoney(
    shares.filter((s) => s.isOwner).map((s) => s.amount),
  );
  const isContributionPool = group.kind === "contribution_pool";
  const ownerShareKnown = !isContributionPool || shares.some((s) => s.isOwner);
  const poolRemaining = isContributionPool
    ? dec(incoming).minus(outgoing).minus(group.totalCost).toFixed(2)
    : null;
  const allocated = sumMoney(shares.map((s) => s.amount));
  const unallocated = Decimal.max(
    0,
    dec(group.totalCost).minus(allocated),
  ).toFixed(2);
  // Incoming contributions never become income, even where they exceed known payouts.
  const matchedContributions = sumMoney(
    shares
      .filter((s) => !s.isOwner)
      .map((share) =>
        Decimal.min(
          dec(share.amount),
          dec(
            sumMoney(
              settlements
                .filter(
                  (settlement) =>
                    settlement.direction === "incoming" &&
                    settlement.counterparty === share.participant,
                )
                .map((settlement) => settlement.amount),
            ),
          ),
        ).toFixed(2),
      ),
  );
  const unmatchedContributions = Decimal.max(
    0,
    dec(incoming).minus(matchedContributions),
  ).toFixed(2);
  const receivable =
    !isContributionPool && group.paidBy === "You"
      ? Decimal.max(
          0,
          dec(
            sumMoney(shares.filter((s) => !s.isOwner).map((s) => s.amount)),
          ).minus(matchedContributions),
        ).toFixed(2)
      : "0.00";
  const payable =
    !isContributionPool && group.paidBy !== "You"
      ? Decimal.max(0, dec(ownerShare).minus(outgoing)).toFixed(2)
      : "0.00";
  return {
    isContributionPool,
    total: group.totalCost,
    ownerShare,
    ownerShareKnown,
    poolRemaining,
    allocated,
    unallocated,
    sharesComplete: dec(allocated).eq(group.totalCost),
    incoming,
    outgoing,
    unmatchedContributions,
    receivable,
    payable,
  };
}
export function estimatedFdValue(
  principal: Money,
  annualRate: string | null | undefined,
  openingDate: string | null,
  maturityDate: string | null,
  asOf = todayISO(),
): Money | null {
  if (!annualRate || !openingDate || !maturityDate) return null;
  const start = Date.parse(`${openingDate}T00:00:00Z`);
  const maturity = Date.parse(`${maturityDate}T00:00:00Z`);
  const end = Math.min(Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`), maturity);
  if (!Number.isFinite(start) || !Number.isFinite(end) || maturity < start)
    return null;
  const days = Math.max(0, Math.floor((end - start) / 86400000));
  // Explicit simple-interest estimate only; contractual compounding is never invented.
  return dec(principal)
    .plus(dec(principal).times(annualRate).div(100).times(days).div(365))
    .toFixed(2);
}
