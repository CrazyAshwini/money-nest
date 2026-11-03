import type { Transaction } from "../types";
import type { HandoffContext } from "./create-context";
import {
  bankReference,
  date,
  identityFields,
  kinds,
  note,
  notionId,
  requiredMoney,
  rows,
  text,
  withSourceNote,
} from "./normalization";

export function planTransactions(context: HandoffContext) {
  const {
    manifest,
    current,
    ownerId,
    asOf,
    workspace,
    plan,
    accounts,
    seenSourceIds,
    decisionById,
    owned,
    exact,
    review,
    replace,
    add,
    observed,
  } = context;
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
  return transactionRows;
}
