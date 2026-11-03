# Verification record

All records/screenshots used for verification were synthetic. No live database migrations or deployment commands were executed. The supplied upgrade specification and the checked-out repository architecture were inspected before code changes.

## Final results

| Command/check | Executed result | Interpretation |
| --- | --- | --- |
| `npm ci --cache /tmp/moneynest-npm-cache --include=optional --no-audit --no-fund` | Installed 468 packages; existing lockfile unchanged | First install failed because the default npm cache was outside writable roots; moving only the cache resolved it. |
| `npm run typecheck` | Passed | Includes new service, component, API and test types. |
| `npm run lint` | Passed | Final edited sources checked. |
| `npm run build` | Passed, Next.js 16.4.3 / Turbopack | Final source build compiled, type-checked and generated routes. Sandbox-only attempts could not start Node workers; a permitted run completed. No Next.js configuration or dependency was changed to bypass checks. |
| `npm test -- --maxWorkers=2` | 51 files / 1,142 assertions passed; **2 unhandled errors, nonzero exit** | Full run before the last three additional SQL assertions. Errors originate in unchanged receipt tests, as described below; do not interpret this as a clean full-suite pass. |
| `vitest run --maxWorkers=2 --exclude src/lib/ai-receipt-service.test.ts` | **50 files / 1,077 tests passed, exit 0** | Clean run of all remaining suites, including the first two extra SQL tests. Fontconfig emitted cache-directory warnings in the restricted environment; no assertion failed. |
| `vitest run tests/db-personal-loans.test.ts src/lib/personal-loans.test.ts --maxWorkers=2` | **2 files / 31 tests passed, exit 0** | Latest focused run includes the additional pre-migration legacy-adjustment preservation test. This overlaps the broad suite rather than adding 31 independent tests to its total. |
| `playwright test --config playwright.upgrade.config.ts` | **6 passed, zero failed** | Final source build; responsive selector/category flow, loan creation → partial repayment → reversal → Profile editing at 320, 390 and 1440px. |
| Existing compact-editor Playwright suite | **31 passed / 3 failed** on its initial broader run | Its stale expectations were corrected: refund save label, explicit discard confirmation, and transaction accessible name using the existing merchant-first title. The full corrected rerun is **not verified**. Attempts were interrupted; a final sandbox-only rerun could not start the configured web server. |
| `python scripts/generate-db-schema.py` | Passed, generated metadata for 28 tables | Metadata regenerated after the additive migration; no database connection. |
| `git diff --check` | Passed | No whitespace errors. |

## Reproduced baseline failure

The two unhandled errors are `ERR_INVALID_STATE: ReadableStream is already closed`, raised by Undici while `src/lib/ai-receipt-service.test.ts` rejects invalid/missing provider consent. Its 67 test assertions pass, but the errors cause a nonzero Vitest exit. That test and receipt service were not modified by this upgrade.

To establish a baseline, `git archive HEAD` was extracted into `/tmp/moneynest-baseline`, with the same installed dependencies linked there. Running the receipt suite from that untouched checkout reproduced **67 passed assertions and the same two errors**. This is an existing test/runtime issue, not a certified clean receipt run. It remains unresolved and was not hidden through configuration or ignored-error flags.

## Accounting and persistence coverage

The focused new tests exercise:

- The exact five creation choices and order, with legacy Adjustment still represented internally.
- Utilities and Gift Given as expenses, Gift Received as income.
- October card purchase vs November bank repayment: one spending event and a separate November cash outflow.
- ₹5,000 lent, ₹2,000 + ₹3,000 principal repaid, restored bank balance, zero earned income, and settled principal.
- ₹3,000 borrowed, paid principal, separate interest expense, and corresponding cash movements.
- Interest received as income; principal/interest reversal without creating duplicate spending or earned income.
- Idempotent command replay and identity reuse rejection.
- Zero, negative, excessive-precision, scientific-notation and invalid amounts.
- Multiple same-person agreements; due-date/overdue status only when appropriate.
- Same-day report inclusion/exclusion and exact paise.
- ₹600 full shared debit, ₹200 personal spending and ₹400 receivable; both existing settlements and an atomic linked reimbursement event settle it without income/double reduction.
- Cloud schema round trips and generic mutation rejection for managed loan records.
- Real SQL application of the complete migration chain, atomic agreement/disbursement, audit creation, stale revision rejection, companion-interest rollback, overpayment, immutable history, principal-plus-interest reversal and cross-owner read/write denial.
- SQL participant-share reimbursement caps and archived-account history preservation.
- A historical Adjustment row inserted **before** the new migration remaining unchanged/readable afterward.

Existing broad tests additionally cover Amazon Pay Later financed-principal-only utilization and 1st/5th schedule, EMI calculations, card/bank report anchors, receipt deduplication, reviewed imports, failed-write rollback, multi-user RLS and legacy views. These were executed locally; they do not establish hosted deployment state.

## UI evidence

No existing stylesheet, dashboard-card design or transaction-list rendering component was changed. New UI reuses existing panels, fields, buttons, Radix modal and account editors. Browser captures were inspected at 320px; the selector keeps the existing nested-sheet appearance and loan history fits the mobile page.

| Width | Selector | Existing expense flow | Loan detail/history |
| --- | --- | --- | --- |
| 320 | [image](screenshots/320-selector.png) | [image](screenshots/320-expense.png) | [image](screenshots/320-loan.png) |
| 390 | [image](screenshots/390-selector.png) | [image](screenshots/390-expense.png) | [image](screenshots/390-loan.png) |
| 1440 | [image](screenshots/1440-selector.png) | [image](screenshots/1440-expense.png) | [image](screenshots/1440-loan.png) |

Prior checked-in baseline form references are linked in the [implementation report](README.md). They were not regenerated or presented as an automated visual diff.

## Remaining verification and rollout

1. Re-run the corrected 34-case compact-editor suite where Chromium and its local Next.js server can launch. The final sandbox-only attempt exited with “Process from config.webServer was not able to start.”
2. Resolve the reproduced baseline receipt-stream test errors separately; rerun the unexcluded suite afterward.
3. Apply the additive migration only to an explicitly chosen development Supabase project after review. Verify real Auth/PostgREST/RLS/advisors and competing network transactions there. Embedded PostgreSQL uses one connection and cannot certify hosted concurrency or provider behavior.
4. Check physical phone/PWA keyboards, real receipt extraction and live authenticated writes. No notification service, automatic interest accrual or automatic conversion of ambiguous legacy loan reports was introduced.
5. Production migration and deployment remain unperformed and require approval. Do not remove the new ledger history as a rollback strategy.
