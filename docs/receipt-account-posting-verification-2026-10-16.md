# Confirmed receipt posting and account movements — 16 October 2026

## Resulting behavior

- A successful payment screenshot adopts its extracted transaction type. The owner reviews the details and selects the actual source/destination accounts before posting. AI account hints do not choose an account automatically.
- A bank/wallet expense reduces cash; a credit-card/Pay Later purchase increases used credit and reduces available credit. Income, refunds, transfers and repayments follow their recorded account directions. Repayments and transfers do not become new spending.
- Same-day payments require an explicit choice about whether the applicable report already includes them. References now support debt reports as well as bank/wallet reports, including known zero amounts. Later reports absorb covered movements; date-only transactions are not ordered by their creation time.
- A description/amount edit preserves a still-valid historical report confirmation. Changing the account/date or explicitly choosing a different inclusion treatment updates it. This also preserves outstanding derived from an older report when a newer report supplies only utilization.
- Unknown, failed, pending or low-confidence extraction needs an additional human completion confirmation. Editing the draft resets its review. Saved pending payments can be explicitly confirmed; voided payments remain voided.
- Bot receipt uploads open the same transaction/scanner review. The bot API rejects direct image requests before loading workspace data or calling a provider; every POST authenticates the owner and exact origin before parsing its body.
- Receipt source fingerprints and meaningful normalized payment references reject duplicate inserts. Same-ID retry/edit remains possible, legacy rows stay editable, and failed mutations roll back. Placeholder references such as “Unknown” normalize to null.
- A successful write followed by failed balance refresh reports that the change was saved and asks for a reload, avoiding a misleading success message or another debit. Retry closes the stale editor and returns to the refreshed workspace instead of opening a new blank transaction.

## Financial calculation corrections

Reported utilization, outstanding, availability, statement amounts and issuer holds remain separate concepts. Receipt review does not establish an issuer authorization, and unknown holds/unbilled splits stay unknown. Future/undated payments do not change cutoff repayment/refund totals; statement/allocation selectors keep owner/date boundaries. Older availability cannot override newer usage evidence. Signed debt movements preserve overpayments before display clamping. Equal-dated reports use available report recording metadata before the ID fallback; transaction creation time never establishes payment order.

## Database release

Migration `20261015122522_confirmed_receipt_account_posting.sql` extends the existing invoker trigger validation to owned same-day liability reports and adds normalized receipt-reference validation. The existing owner write lock, RLS and exact source/reference indexes remain intact. It contains function/trigger changes only and does not rewrite finance records.

The migration was applied atomically to the Money Nest production project `gjqwxnecqgyhogrhjwsu` and recorded in `supabase_migrations.schema_migrations`. Source SHA256: `AA8B567963290D9244E03DB0227CB24926AA9D24AA6761797197F43D919064B9`. The authenticated SQL editor returned “Receipt posting guards installed.” No owner finance records were added, edited or deleted for this verification.

A fresh Supabase Security Advisor run returned zero errors and the existing Auth warning “Leaked Password Protection Disabled.” Authentication settings were unchanged.

## Verification

The isolated production build (webpack), its TypeScript check, full ESLint and targeted final lint/diff checks passed. All **720 unit/database tests across 35 files** passed.

The completed browser pass set covers **141 distinct cases**: 62 receipt/scanner cases, 43 account/payment/usability cases, 34 general access/responsive cases, and two focused final regressions. Receipt movements run on desktop and phone and assert source/destination IDs, report references, used balances, available credit, spending and persistence after reload. They cover bank/wallet purchases and income, card/Pay Later purchases, refunds, transfers and repayments, plus batch review, uncertain payments and duplicate/retry controls.

The last change only clears stale editor/navigation state on workspace recovery. A fresh isolated production build of the final runtime source passed, and the two focused regressions passed on that build: saved payment plus failed readback recovers to one debit with no reopened editor; a description-only receipt edit preserves the older report reference and both outstanding/utilization after reload. A source-hash comparison confirmed that the tested runtime, migration and test files match the working source. The larger pass set ran immediately before this final recovery-handler change; its unaffected financial/responsive cases were not needlessly repeated.

Initial browser failures exposed ambiguous mobile Add/alert selectors and stale account-link/unknown-meter expectations; those tests were corrected without weakening money or percentage assertions. The readback recovery test also exposed the stale-editor behavior above, which was fixed in product code. The older-report edit regression independently distinguishes outstanding from utilization, so dropping the historical reference would fail it.

All automated finance records are synthetic. The isolated production build/server uses no real `.env` or private profile, separate ports, explicit fixture gates and blocked external traffic. Receipt AI responses are mocked; these tests verify extraction-to-review-to-persistence-to-balance behavior, not current provider interpretation quality. PGlite and private-store concurrency checks do not certify live PostgreSQL concurrency. No real payment screenshot was sent to an AI provider, and no financial test transaction was inserted into the owner's cloud workspace.
