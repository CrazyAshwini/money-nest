# MoneyNest transaction and personal-loan upgrade

Implementation base: `43f7e11b677ab4182b800edcbb9cc73014f00b48` (`CrazyAshwini/money-nest`, main). The supplied `MoneyNest_Codex_Upgrade_README.md` was read completely. No deployment, production migration, financial-data backfill, seed, or deletion was performed.

## Inspected architecture and source of truth

- Next.js 16.4.3 App Router / React 19 / TypeScript. Read repository `AGENTS.md`, project context and linked picker review, plus installed Next.js route/client guides.
- `finance-provider.tsx` owns workspace/session state and calls `/api/workspace`. The existing transaction editor, nested `TransactionPicker`, shared Radix modal, category/platform suggestions and CSS remain the form/design foundations.
- `transactions` is the cash ledger. Account balances, report anchors, credit utilization and EMI principal calculations already use decimal strings and `decimal.js`. A two-account movement is one committed row, rather than two independently updated balances.
- Cloud workspaces use authenticated SSR Supabase clients, owner RLS/composite foreign keys, audit triggers, a workspace advisory lock/revision, and atomic RPCs. Local private profiles use session-checked encrypted storage with a serialized atomic file replacement.
- Existing `loans` are already loaded, validated and presented by the app. Extend this canonical collection for personal agreements; institutional/legacy records remain as recorded. Older unused database `personal_loans` tables are untouched. No second ledger, mutable outstanding balance, contact permissions or notification provider was introduced.

## Completed behavior

### Transaction entry

The existing nested sheet now offers Expense, Income, Bill Repayment, Transfer, Refund / Money Back, in that order. Internal `bill_payment` remains backward compatible. Legacy `adjustment` remains in types, validation, history and exports, with a legacy label when opened; it is absent from creation choices. No new manual-adjustment UI was added. Existing reported-balance/snapshot tools and their audit history remain available in Profile account tools.

Expense retains the category → platform path and source picker. Utilities and Gift Given are expense choices; income includes Salary, Fellowship and Gift Received. Description is optional, with a type label stored when omitted. Income hides purchase platforms. Bill Repayment limits new account choices to bank/wallet → card/Pay Later and links to Loans & Borrowings for personal repayments. Legacy external institutional repayment details remain readable. Refunds collect a reason, optional purchase reference, and a participant for linked shared reimbursements. Changing type clears incompatible account/category/platform/refund fields, preserves amount/date and never saves automatically. Existing receipt review, pending confirmation and same-day balance treatment remain in use. Double taps are guarded synchronously; stable record/source identities continue to protect retries.

Modal cancellation asks before discarding changed fields, and browser unload warns about unsaved forms.

### Loans & Borrowings

Profile's existing Loans destination opens `/loans`; no bottom-navigation tab was added. Give Loan and Borrow Money create separate agreements for each disbursement, including multiple agreements with the same named person. The overview shows To Receive and To Repay; agreement details show original principal, repaid/outstanding principal, due date, status, notes and committed history.

Creation and repayments call the same precise `applyPersonalLoanCommand` transition. Local storage commits the whole resulting state under its existing lock. Cloud persistence re-reads owner state, validates, and calls `commit_personal_loan` with the expected revision; a competing update is revalidated against fresh rows. A new agreement and its disbursement commit together, enforced by a deferred database constraint trigger.

- Given principal: bank/wallet cash out; an equal receivable.
- Borrowed principal: bank/wallet cash in; an equal payable.
- Repayments: opposite cash direction and a decrease in principal outstanding.
- Principal uses existing transfer ledger entries; it is neither purchase expense nor earned income.
- Paid interest is a separate expense, received interest separate income. Optional agreement terms are informational, with no automatic accrual.
- Partial/full repayment is supported. Positive amounts, precision, ownership, active asset accounts, chronology and overpayment are validated.
- Outstanding is derived from posted disbursement, repayment and reversal events. Zero is Settled; Overdue requires a due date.
- Generic edits/deletes of managed agreements/events are blocked. Record Repayment and Reverse repayment append history. A reversal restores principal and reverses associated interest in the original account; interest refunds/reversals do not become new earned income or duplicate spending.
- Stable command/event identities make exact retries no-ops; reusing an identity for different details is rejected.
- Same-day movements retain the app's explicit “already included / update balance” report confirmation. The existing policy permits negative bank/wallet balances; this upgrade does not invent an overdraft restriction.

### Spending, cash flow and shared purchases

Spending remains purchase-date consumption. Analytics now also shows Money In / Money Out from bank/wallet cash movements. Internal bank/wallet-to-bank/wallet transfers are excluded; bill repayments and personal principal movements are included. Credit purchases themselves do not debit bank cash. Existing Amazon Pay Later principal-only utilization and 1st billing / 5th due-date logic was reused and covered by the existing tests; future scheduled interest is not financed principal.

For a fully allocated, linked shared purchase paid by the owner, spending is the owner's share while the full purchase remains the bank debit. Existing split receivables remain separate from personal loans. A linked shared-reimbursement refund carries its original purchase and participant in one ledger write; the split summary derives that repayment without another balance or settlement write. Client/server validation and a locked database trigger cap reimbursement to the participant's remaining share. Reimbursement does not become income or further reduce the already-attributed personal expense. Incomplete/unlinked legacy split records retain their recorded expense amount until allocation is explicit.

### Profile account management

`/profile` contains Bank Accounts, Credit Cards, Pay Later Accounts and Wallets, using existing account editors and account report tools. `/profile?account=<id>` opens the relevant management context, and `/profile?manage=<kind>` opens its group. Account cards and Accounts-page history remain accessible; edit/add controls lead to Profile. Old `/accounts/<id>?manage=reports` links offer a Profile management link rather than another edit form.

Name/issuer, limits, opening balance/date, optional billing/due day, notes and active/archive state reuse existing models. Debt usage/availability uses the existing credit selector. New billing/due metadata does not rewrite transactions or override provider-specific EMI rules. Account deletion through workspace APIs is rejected in favor of archiving; archive retains transactions. New movements cannot select archived accounts; existing linked history remains readable.

## Migration and rollout

The only new migration is `supabase/migrations/20261102190000_personal_loan_ledger.sql`. It adds nullable references/metadata and a default-false managed-loan marker, owner-scoped foreign keys/indexes, caller-security views, append-only/invariant triggers and an authenticated caller-security atomic RPC. Existing row values and old transaction types are preserved. It does not create a privileged/service-role write path. Existing RLS and audit/workspace locks apply to the extended tables.

`python scripts/generate-db-schema.py` regenerates Drizzle metadata. The generator needed support for multi-column additive ALTER statements already present in older migrations, plus the new additive columns/composite references. SQL migrations remain authoritative for checks, triggers, RLS and grants.

The installed Supabase CLI could not initialize its read-only home config directory when `migration new` was attempted. The additive migration was consequently written locally and verified by applying the complete migration chain in PGlite; no hosted schema was changed.

Manual rollout, requiring explicit deployment approval: review the migration; identify the intended dedicated development Supabase project; apply the additive migration there; verify real Auth/PostgREST, concurrent clients and RLS/advisors; then apply to the intended production database before releasing this app code. Keep the existing backup/rollback policy. Rolling back the UI should preserve the new tables/columns/events rather than delete financial history. Do not run `db:migrate` against an unverified linked project.

## Evidence and remaining limits

See [verification](verification.md) for executed commands/results and [changed files](changed-files.md) for the complete inventory.

Synthetic screenshots of the updated form/selector/loan page are in [screenshots](screenshots/). Existing synthetic baseline form references are [320px](../compact-expense-review/screenshots/after/320px/add-expense.png), [390px](../compact-expense-review/screenshots/after/390px/add-expense.png), and [1440px](../compact-expense-review/screenshots/after/1440px/add-expense.png). These are prior checked-in baseline references, not newly generated before-images or a pixel-diff certification. No owner financial records appear in the captures.

Hosted Supabase deployment, live identity/session delivery, multi-connection/network concurrency, real receipt-provider calls, physical-device keyboards, and optional external reminders remain unverified. PGlite tests validate real SQL/RLS on a single embedded connection; browser tests mock authenticated workspace responses, so they do not certify hosted persistence. No automatic migration of ambiguous legacy loan snapshots into managed principal events is attempted, since that could duplicate cash movements. Legacy loans remain in their existing schedule/report section.
