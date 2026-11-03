import Decimal from "decimal.js";
import type { Account } from "../types";
import type { HandoffContext } from "./create-context";
import type { Raw } from "./types";
import {
  accountKinds,
  asRaw,
  cleanOptionalFields,
  date,
  money,
  normalized,
  notionId,
  rows,
  suffix,
  text,
} from "./normalization";

export function planAccountReports(context: HandoffContext) {
  const {
    manifest,
    workspace,
    plan,
    accounts,
    accountSourceIds,
    owned,
    exact,
    review,
    replace,
    add,
    observed,
  } = context;
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
  return reconciliation;
}
