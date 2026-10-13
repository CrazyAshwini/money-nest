/** Server/CLI only. A private handoff is evidence, never a public seed. */
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { isoDateSchema, validateWorkspaceRecord } from "./validation";
import type { Account, Transaction, WorkspaceData } from "./types";

type Raw = Record<string, unknown>;
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

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const normalized = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const asRaw = (value: unknown): Raw => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The handoff contains an invalid object.");
  return value as Raw;
};
const rows = (source: Raw, key: string) => {
  const value = source[key] ?? [];
  if (!Array.isArray(value) || value.length > 10000)
    throw new Error(`The handoff ${key} collection is invalid.`);
  return value.map(asRaw);
};
const money = (value: unknown): string | null => {
  if (value == null) return null;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value))
  )
    throw new Error("The handoff has an invalid monetary amount.");
  return new Decimal(value).toFixed(2);
};
const requiredMoney = (value: unknown) => {
  const amount = money(value);
  if (amount == null || new Decimal(amount).lte(0))
    throw new Error("A handoff transaction needs a positive amount.");
  return amount;
};
const date = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  const parsed = isoDateSchema.safeParse(value);
  if (!parsed.success) throw new Error("The handoff has an invalid date.");
  return parsed.data;
};
const notionId = (value: unknown): string => {
  const found = text(value).match(
    /(?:^|\/)([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:[?#]|$)/i,
  )?.[1];
  if (!found)
    throw new Error("A handoff source needs a stable Notion page identity.");
  const compact = found.replace(/-/g, "").toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
};
const stableId = (owner: string, collection: string, source: string) => {
  const hash = createHash("sha256")
    .update(`money-nest-handoff:v1:${owner}:${collection}:${source}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const note = (value: string, limit = 500) => value.slice(0, limit);
const cleanOptionalFields = <T extends object>(record: T): T => {
  const clean = { ...record } as Raw;
  // SQL uses NULL for absent optional metadata; the shared client model uses omission.
  if (clean.notes == null) delete clean.notes;
  if (clean.accent == null) delete clean.accent;
  return clean as T;
};
const withSourceNote = (
  existing: string | null | undefined,
  sourceId: string,
): string | undefined => {
  const pointer = `Notion: https://www.notion.so/${sourceId.replace(/-/g, "")}`;
  if (existing?.includes(pointer)) return existing;
  if (existing && existing.length + pointer.length + 1 > 2000) return existing;
  return existing ? `${existing}\n${pointer}` : pointer;
};
const suffix = (value: unknown) =>
  text(value).match(/(?:[•·]|\bXX)\s*(\d{1,4})\b/i)?.[1] ??
  text(value).match(/\b(\d{4})$/)?.[1] ??
  "";
const bankReference = (value: unknown) => {
  const candidate = text(value);
  if (/^\d{6,30}$/.test(candidate)) return candidate;
  return (
    candidate.match(
      /\b(?:UPI|IMPS|UTR|RRN|bank reference)\s*[:#-]?\s*(\d{6,30})\b/i,
    )?.[1] ?? null
  );
};
const kinds: Record<string, Transaction["kind"]> = {
  Expense: "expense",
  Income: "income",
  Transfer: "transfer",
  Refund: "refund",
  "Bill Payment": "bill_payment",
  Adjustment: "adjustment",
};
const accountKinds: Record<string, Account["kind"]> = {
  Bank: "bank",
  Wallet: "wallet",
  "Credit Card": "credit_card",
  "Pay Later": "pay_later",
};
const identityFields = [
  "amount",
  "currency",
  "kind",
  "status",
  "occurredOn",
  "fromAccountId",
  "toAccountId",
] as const;

/** Plans an append/update merge. Uncertain identities never create a second payment. */
export function planHandoffImport(
  input: unknown,
  current: WorkspaceData,
  ownerId: string,
  knownSources: readonly unknown[] = [],
  decisions: HandoffDecision[] = [],
): HandoffPlan {
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
  for (const raw of rows(manifest, "accounts")) {
    const sourceId = notionId(raw.url);
    const code = text(raw.code);
    const name = text(raw.name);
    const kind = accountKinds[text(raw.type)];
    if (!code || !name || !kind || accounts.has(code))
      throw new Error("A handoff account is invalid or duplicated.");
    const incoming: Account = {
      ...owned("accounts", sourceId),
      name,
      institution: name.split(/[•·]/)[0].trim(),
      kind,
      maskedSuffix: suffix(name),
      active: true,
      creditLimit: money(raw.limit_inr),
      openingBalance: null,
      openingBalanceDate: null,
      notes:
        "Imported dated account report; current provider balance may differ.",
    };
    const candidates = workspace.accounts.filter((row) => {
      if (row.kind !== kind) return false;
      const a = normalized(row.name),
        b = normalized(name.split(/[•·]/)[0]);
      const nameMatches =
        a === b ||
        (a.length > 7 && b.length > 7 && (a.startsWith(b) || b.startsWith(a)));
      return (
        nameMatches ||
        (incoming.maskedSuffix &&
          row.maskedSuffix === incoming.maskedSuffix &&
          normalized(row.institution).split(" ")[0] &&
          a.slice(0, 4) === b.slice(0, 4))
      );
    });
    const matched =
      exact("accounts", sourceId) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!matched && candidates.length > 1) {
      review(
        "accounts",
        sourceId,
        incoming,
        "Several existing accounts could match this account report.",
        candidates,
      );
      continue;
    }
    let account = incoming;
    if (matched) {
      plan.counters.matched++;
      account = cleanOptionalFields({
        ...matched,
        creditLimit: matched.creditLimit ?? incoming.creditLimit,
      });
      if (
        matched.creditLimit != null &&
        incoming.creditLimit != null &&
        !new Decimal(matched.creditLimit).eq(incoming.creditLimit)
      )
        review(
          "accounts",
          sourceId,
          incoming,
          "The reported limit conflicts with the existing account limit.",
          [matched],
          matched,
        );
      replace("accounts", account);
    } else add("accounts", account);
    accounts.set(code, account);
    accountSourceIds.set(code, sourceId);
    observed("accounts", account.id, sourceId, raw);
  }
  const reconciliation =
    manifest.statement_reconciliation == null
      ? null
      : asRaw(manifest.statement_reconciliation);
  for (const raw of rows(manifest, "accounts")) {
    const code = text(raw.code),
      account = accounts.get(code);
    if (!account) continue;
    const snapshotDate = date(raw.snapshot_as_of);
    const confirmedBank =
      reconciliation && text(reconciliation.account) === code;
    const reportedBalance = confirmedBank
      ? money(reconciliation.closing_inr)
      : null;
    const values = {
      reportedBalance,
      reportedOutstanding: money(raw.reported_outstanding_inr),
      reportedUtilized: null,
      reportedAvailable: money(raw.reported_available_inr),
      reportedUnbilled: money(raw.reported_unbilled_inr),
    };
    if (!Object.values(values).some((value) => value != null)) continue;
    const day = confirmedBank
      ? date(reconciliation.statement_period_end)
      : snapshotDate;
    if (!day) {
      review(
        "snapshots",
        accountSourceIds.get(code)!,
        values,
        "The report has no confirmed as-of date.",
      );
      continue;
    }
    const sourceId = `${accountSourceIds.get(code)}:${day}`;
    const timestamp = `${day}T23:59:59+05:30`;
    const incoming = {
      ...owned("snapshots", sourceId, "notion_manifest_snapshot"),
      accountId: account.id,
      asOf: timestamp,
      ...values,
      source: confirmedBank ? ("bank_statement" as const) : ("import" as const),
      verifiedByUser: Boolean(confirmedBank),
    };
    const candidates = workspace.snapshots.filter(
      (row) => row.accountId === account.id && row.asOf.slice(0, 10) === day,
    );
    const same = candidates.find((row) =>
      Object.entries(values).every(
        ([key, value]) =>
          value == null ||
          ((row as unknown as Raw)[key] != null &&
            new Decimal(String((row as unknown as Raw)[key])).eq(value)),
      ),
    );
    const matched =
      exact("snapshots", sourceId, "notion_manifest_snapshot") ?? same;
    if (matched) {
      plan.counters.matched++;
      observed(
        "snapshots",
        matched.id,
        sourceId,
        raw,
        "confirmed",
        "notion_manifest_snapshot",
      );
    } else if (candidates.length)
      review(
        "snapshots",
        sourceId,
        incoming,
        "A report for the same account and day has different amounts.",
        candidates,
      );
    else {
      add("snapshots", incoming);
      observed(
        "snapshots",
        incoming.id,
        sourceId,
        raw,
        "confirmed",
        "notion_manifest_snapshot",
      );
    }
  }
  const transactionRows = rows(manifest, "transactions");
  for (const raw of transactionRows) {
    const sourceId = notionId(raw.notion_page_id ?? raw.notion_url);
    if (seenSourceIds.has(sourceId))
      throw new Error("The handoff repeats a transaction identity.");
    seenSourceIds.add(sourceId);
    const decision =
      decisionById.get(sourceId) ?? decisionById.get(text(raw.notion_page_id));
    if (decision?.action === "skip") {
      plan.counters.ignored++;
      continue;
    }
    if (
      raw.status === "failed_attempt" ||
      raw.confirmation_state === "failed_attempt"
    ) {
      plan.counters.ignored++;
      continue;
    }
    const kind = kinds[text(raw.type)],
      occurredOn = date(raw.date);
    if (!kind || !text(raw.description))
      throw new Error(
        "A handoff transaction has an invalid type or description.",
      );
    const fromCode = text(raw.from_account),
      toCode = text(raw.to_account);
    if (
      (fromCode && !accounts.has(fromCode)) ||
      (toCode && !accounts.has(toCode))
    ) {
      review(
        "transactions",
        sourceId,
        raw,
        "A payment account still needs to be matched.",
      );
      continue;
    }
    const fromAccountId = accounts.get(fromCode)?.id ?? null,
      toAccountId = accounts.get(toCode)?.id ?? null;
    const incomplete = !occurredOn || (!fromAccountId && !toAccountId);
    const incoming: Transaction = {
      ...owned("transactions", sourceId),
      amount: requiredMoney(raw.amount_inr),
      currency: "INR",
      kind,
      status: incomplete ? "pending_review" : "posted",
      occurredOn,
      description: text(raw.description).slice(0, 200),
      fromAccountId,
      toAccountId,
      category: kind === "expense" ? text(raw.category) || "Other" : null,
      merchant: text(raw.merchant) || null,
      platform: text(raw.platform) || null,
      externalPayer: text(raw.external_payer) || null,
      externalReference: note(text(raw.reference), 100) || null,
      sourceSystem: "notion",
      sourceObjectId: sourceId,
      notes: withSourceNote(
        incomplete
          ? "Confirmed historical record with incomplete date or payment source; review before posting."
          : undefined,
        sourceId,
      ),
      createdAt: `${asOf}T23:59:59+05:30`,
      updatedAt: `${asOf}T23:59:59+05:30`,
    };
    const reference = bankReference(raw.reference);
    const referenceCandidates = reference
      ? workspace.transactions.filter(
          (row) =>
            bankReference(row.externalReference) === reference &&
            row.fromAccountId === fromAccountId &&
            row.toAccountId === toAccountId,
        )
      : [];
    // Different Notion pages within this verified manifest stay distinct. Match
    // fuzzy evidence only against the pre-existing ledger, never sibling rows.
    const fuzzy = current.transactions.filter((row) => {
      if (
        row.amount !== incoming.amount ||
        (row.occurredOn && occurredOn && row.occurredOn !== occurredOn)
      )
        return false;
      if (
        (!row.occurredOn || !occurredOn) &&
        row.fromAccountId !== fromAccountId &&
        row.toAccountId !== toAccountId
      )
        return false;
      // Opposite flow is distinct even for a same-day reversal of the same amount.
      if (
        row.fromAccountId === toAccountId &&
        row.toAccountId === fromAccountId &&
        (fromAccountId || toAccountId)
      )
        return false;
      return true;
    });
    let matched =
      exact("transactions", sourceId) ??
      (referenceCandidates.length === 1 ? referenceCandidates[0] : undefined);
    if (decision?.action === "match") {
      matched = workspace.transactions.find(
        (row) => row.id === decision.recordId,
      );
      if (!matched)
        throw new Error("The selected handoff match was not found.");
    }
    if (matched) {
      plan.counters.matched++;
      const conflict = identityFields.filter(
        (field) => matched![field] !== incoming[field],
      );
      const confirmCorrections =
        decision?.action === "match" && decision.confirmCorrections === true;
      if (conflict.length && !confirmCorrections) {
        review(
          "transactions",
          sourceId,
          incoming,
          `Confirmed source identity matches, but financial fields differ: ${conflict.join(", ")}.`,
          [matched],
          matched,
        );
        observed(
          "transactions",
          matched.id,
          sourceId,
          raw,
          "needs_confirmation",
        );
        continue;
      }
      const next = confirmCorrections
        ? {
            ...matched,
            ...incoming,
            id: matched.id,
            userId: ownerId,
            sourceSystem: matched.sourceSystem,
            sourceObjectId: matched.sourceObjectId,
            createdAt: matched.createdAt,
            externalPayer: incoming.externalPayer ?? matched.externalPayer,
            notes: withSourceNote(matched.notes, sourceId),
          }
        : {
            ...matched,
            category: matched.category ?? incoming.category,
            externalReference:
              matched.externalReference ?? incoming.externalReference,
            notes: withSourceNote(matched.notes, sourceId),
          };
      replace("transactions", next);
      observed(
        "transactions",
        matched.id,
        sourceId,
        raw,
        incomplete ? "partially_confirmed" : "confirmed",
      );
    } else if (
      decision?.action !== "create" &&
      (referenceCandidates.length > 1 || fuzzy.length)
    ) {
      review(
        "transactions",
        sourceId,
        incoming,
        referenceCandidates.length > 1
          ? "The bank reference identifies several existing records."
          : "Similar existing records need an explicit identity decision; date and amount alone are insufficient.",
        referenceCandidates.length ? referenceCandidates : fuzzy,
      );
    } else {
      add("transactions", incoming);
      observed(
        "transactions",
        incoming.id,
        sourceId,
        raw,
        incomplete ? "partially_confirmed" : "confirmed",
      );
      if (incomplete)
        review(
          "transactions",
          sourceId,
          incoming,
          "The historical row is retained as a draft until its missing date or payment source is confirmed.",
          [incoming],
        );
    }
  }
  for (const raw of rows(manifest, "fixed_deposits")) {
    const sourceId = notionId(raw.url),
      openingDate = date(raw.opening_date),
      maturityDate = date(raw.maturity_date);
    const linked = accounts.get(text(raw.linked_card));
    const incoming = {
      ...owned("fixedDeposits", sourceId),
      name: text(raw.name),
      institution: text(raw.bank),
      maskedSuffix: suffix(raw.name),
      principal: requiredMoney(raw.principal_inr),
      openingDate,
      maturityDate,
      maturityAmount: money(raw.maturity_amount_inr),
      annualRate:
        raw.annual_rate_pct == null ? null : String(raw.annual_rate_pct),
      payoutMethod: "Unconfirmed",
      maturityInstruction: "unconfirmed" as const,
      pledged: linked ? true : null,
      backingAccountId: linked?.id ?? null,
      payoutAccountId: null,
      reportedEncashmentValue: null,
      reportedAsOf: null,
      notes: note(
        !openingDate || !maturityDate
          ? "Funding is recorded separately; contractual opening and maturity details remain unconfirmed."
          : "Historical contract details imported; current encashment value unconfirmed.",
      ),
    };
    const candidates = workspace.fixedDeposits.filter(
      (row) =>
        row.principal === incoming.principal &&
        row.openingDate === openingDate &&
        row.maturityDate === maturityDate &&
        normalized(row.institution) === normalized(incoming.institution),
    );
    const matched =
      exact("fixedDeposits", sourceId) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (matched) {
      plan.counters.matched++;
      observed(
        "fixedDeposits",
        matched.id,
        sourceId,
        raw,
        !openingDate || !maturityDate ? "partially_confirmed" : "confirmed",
      );
    } else if (candidates.length > 1)
      review(
        "fixedDeposits",
        sourceId,
        incoming,
        "Several deposits match the contract details.",
        candidates,
      );
    else {
      add("fixedDeposits", incoming);
      observed(
        "fixedDeposits",
        incoming.id,
        sourceId,
        raw,
        !openingDate || !maturityDate ? "partially_confirmed" : "confirmed",
      );
    }
    if (!openingDate || !maturityDate)
      review(
        "fixedDeposits",
        sourceId,
        incoming,
        "The funded deposit needs confirmed contractual opening and maturity dates.",
        matched ? [matched] : [incoming],
      );
  }
  for (const raw of rows(manifest, "loan_and_emi")) {
    const sourceId = notionId(raw.url),
      disbursedOn = date(raw.disbursement_date),
      netDisbursed = requiredMoney(raw.disbursement_inr);
    const incoming = {
      ...owned("loans", sourceId),
      name: text(raw.name),
      lender: text(raw.name),
      kind: "institutional" as const,
      contractualPrincipal: null,
      netDisbursed,
      reportedOutstanding: null,
      reportedAsOf: null,
      annualRate: null,
      scheduledTotal: null,
      repaymentAccountId: null,
      disbursedOn,
      notes:
        "Loan proceeds are a transfer; scheduled installments are not confirmed payments.",
    };
    const candidates = workspace.loans.filter(
      (row) =>
        (normalized(row.name) === normalized(incoming.name) ||
          normalized(row.name).startsWith(normalized(incoming.name)) ||
          normalized(incoming.name).startsWith(normalized(row.name))) &&
        row.netDisbursed === netDisbursed &&
        row.disbursedOn === disbursedOn,
    );
    const matched =
      exact("loans", sourceId) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!matched && candidates.length > 1) {
      review(
        "loans",
        sourceId,
        incoming,
        "Several existing loans match this report.",
        candidates,
      );
      continue;
    }
    const loan = matched ?? incoming;
    if (matched) plan.counters.matched++;
    else add("loans", incoming);
    observed("loans", loan.id, sourceId, raw, "partially_confirmed");
    if (!Array.isArray(raw.emi_due_dates) || raw.emi_due_dates.length > 1200)
      throw new Error("The handoff installment schedule is invalid.");
    raw.emi_due_dates.forEach((value, index) => {
      const dueDate = date(value);
      if (!dueDate)
        throw new Error("An installment needs its confirmed due date.");
      const scheduleId = `${sourceId}:${dueDate}`;
      const installment = {
        ...owned("emis", scheduleId, "notion_manifest_schedule"),
        loanId: loan.id,
        number: index + 1,
        dueDate,
        amount: requiredMoney(raw.emi_inr),
        principalPortion: null,
        interestPortion: null,
      };
      const previous =
        exact("emis", scheduleId, "notion_manifest_schedule") ??
        workspace.emis.find(
          (row) =>
            row.loanId === loan.id &&
            row.number === installment.number &&
            row.dueDate === dueDate &&
            row.amount === installment.amount,
        );
      if (previous) plan.counters.matched++;
      else add("emis", installment);
      observed(
        "emis",
        previous?.id ?? installment.id,
        scheduleId,
        {
          loanPageId: sourceId,
          dueDate,
          amount: installment.amount,
          paidConfirmed: raw.emi_paid_confirmed,
        },
        "confirmed",
        "notion_manifest_schedule",
      );
    });
  }
  for (const raw of rows(manifest, "known_bills")) {
    const sourceId = notionId(raw.url),
      statementAmount = requiredMoney(raw.amount_inr),
      dueDate = date(raw.due_date);
    const explicitAccount = accounts.get(text(raw.account_code));
    const accountCandidates = [...accounts.values()].filter(
      (row) =>
        normalized(text(raw.name)).includes(
          normalized(row.name.split(/[•·]/)[0]),
        ) ||
        normalized(row.name).includes(
          normalized(text(raw.name).replace(/\s+bill.*$/i, "")),
        ),
    );
    const account =
      explicitAccount ??
      (accountCandidates.length === 1 ? accountCandidates[0] : undefined);
    const matched =
      exact("bills", sourceId) ??
      workspace.bills.find(
        (row) =>
          row.accountId === account?.id &&
          row.statementAmount === statementAmount &&
          row.dueDate === dueDate,
      );
    if (matched) {
      plan.counters.matched++;
      observed("bills", matched.id, sourceId, raw);
      continue;
    }
    const purchases = workspace.transactions.filter(
      (row) =>
        row.kind === "expense" &&
        row.status === "posted" &&
        row.fromAccountId === account?.id &&
        row.amount === statementAmount &&
        row.occurredOn,
    );
    const statementDate =
      date(raw.statement_date) ??
      (purchases.length === 1 ? purchases[0].occurredOn : null);
    if (!account || !statementDate || raw.paid_confirmed === true) {
      review(
        "bills",
        sourceId,
        raw,
        "The bill needs its linked account, confirmed purchase/statement date, and identified payment if marked paid.",
      );
      continue;
    }
    const incoming = {
      ...owned("bills", sourceId),
      accountId: account.id,
      statementAmount,
      statementDate,
      dueDate,
      periodStart: statementDate,
      periodEnd: statementDate,
      minimumDue: null,
      statementCredits: "0.00",
      notes:
        "Order bill; purchase date used. Billing cycle and total account debt are unconfirmed.",
    };
    add("bills", incoming);
    observed("bills", incoming.id, sourceId, raw);
  }
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
