# Bank balance and payment confirmation — 15 October 2026

## Verified cause

A saved receipt expense could remain `pending_review` after its amount, date and account were filled in. The editor excluded `receipt_ai` records from its manual confirmation control, leaving no way to post that saved payment. Pending entries correctly do not affect spending or balances, but the generic success message did not explain that.

Separately, date-only transactions on the same Indian calendar day as a balance report are treated as already covered by that report. Automatically subtracting all of them would double-count historical imports. Entry creation time cannot establish when the payment happened.

## Change

- Any saved pending transaction can be explicitly confirmed after checking its account and payment. Fresh failed/pending receipt extraction retains its conservative review safeguards; voided entries stay voided.
- When a bank/wallet transaction shares the current balance report's date, posting requires an explicit choice: already included, or missing from the report. Missing movements reference that exact report on the applicable account side. Later dated posted transactions continue to apply automatically.
- A newer report absorbs previous confirmations, including another report on the same day. Existing records retain their previous treatment. Changes to amount recalculate the existing movement instead of inserting another debit.
- Report reconciliation excludes movements explicitly confirmed outside that exact report, while ordinary ledger/spending calculations include posted payments. Unknown opening history remains unknown.
- Pending-save feedback states that the transaction is excluded from balances; posted-save feedback shows the resulting bank/wallet balance.
- The API schema, invoker view, owned-account/date validation, import/commerce persistence and profile-transfer dependency order preserve these references. Migration `20261015115804_transaction_balance_snapshot_anchors.sql` changes no finance rows.

## Verification

The isolated production build passed using webpack, with no owner environment or private files copied. The first sandboxed build reached page generation but could not create a generated directory (`EPERM`); the isolated build passed with normal filesystem permissions. Targeted ESLint and diff checks passed.

All **646 unit/database tests across 33 files** passed. The final migration also passed **42 database tests**, including 12 focused tests for ownership, dates, persistence, privileges, legacy rows and deletion cleanup. These use PGlite and synthetic records; they are not live database transaction tests.

All **43 desktop/phone browser checks passed** on the isolated production build. The same-day regression starts at ₹13,456.04, keeps an unchecked receipt payment pending, posts the existing ₹45 payment with an explicit missing-from-report confirmation, verifies ₹13,411.04 after reload, then edits the amount to verify one recalculated debit. A separate case covers an already-included expense and an automatic later-date debit. These browser tests use fictional data and blocked external traffic; live owner-record persistence must be checked separately after release.

The additive database migration was applied atomically through the authenticated Money Nest project SQL editor and recorded in migration history. Production project: `gjqwxnecqgyhogrhjwsu`; no other project was changed. Its final source SHA256 is `5E5F59F7BD59DEA52DBE6331E8C3FFF61CB71018ADE85759B45094F374EC896C`. The connected Supabase MCP lacked project access, so the existing owner browser session was used.

The [project Security Advisor](https://supabase.com/dashboard/project/gjqwxnecqgyhogrhjwsu/advisors/security) was rerun after migration: zero errors and one Auth warning, “Leaked Password Protection Disabled,” unchanged from the initial advisor result. This change does not alter authentication settings.
