import type { HandoffContext } from "./create-context";
import {
  date,
  money,
  normalized,
  note,
  notionId,
  requiredMoney,
  rows,
  suffix,
  text,
} from "./normalization";

export function planContracts(context: HandoffContext) {
  const {
    manifest,
    workspace,
    plan,
    accounts,
    owned,
    exact,
    review,
    add,
    observed,
  } = context;
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
}
