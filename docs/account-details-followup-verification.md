# Compact account popup follow-up

## Audit and preserved work

The owner requested compact Bank Account and Pay Later detail popups consistent with Credit Card details, with exact-account recent activity and filtered history. Work was initially prepared against `8805c28`. On resumption, a fresh fetch found merged PR #4 (`24dc5c8`) and current main `0c7dfa8`. The initial implementation was saved locally on `codex/account-details-cards` and was not published. This follow-up starts from current main and reuses the completed upstream design instead of introducing a second carousel or card system.

| Requirement | Status on current main | Follow-up |
| --- | --- | --- |
| Virtual cards on mobile and desktop | Complete | Preserve `VirtualAccountCard`. |
| Initials, safe masked identifiers and card styling | Complete | Preserve existing fallback; no approved bank/provider logos or structured holder/subtype fields exist. |
| Multiple accounts, swipe, keyboard and selected indicator | Complete | Preserve `FinancialCardCarousel` and its existing navigation behavior. |
| Exact-account recent transactions and empty states | Complete | Reuse `RecentAccountTransactions`; add an optional cutoff for current-date popups. General history callers are unchanged. |
| Filtered View all and browser query navigation | Complete | Preserve existing `accountHistoryHref`, `period=all` handling, routes and filters. |
| Visible compact summary before recent transactions | Incomplete | Replace hidden balance/usage disclosures with selected-account summaries. |
| Bank monthly recorded credits/debits | Missing | Sum posted, dated, exact-owner/account movements in the selected month through the cutoff. |
| Consistent recorded dues and next due date | Needs improvement | Use the same known unpaid statements; exclude future payment allocations from current dues. |
| Bottom sheet / centered modal and focus restoration | Complete | Keep the existing Radix shell and handlers. |

## Resulting behavior

The existing virtual card stays at the top on phones; the selected summary is visible below it and recent transactions follow. Desktop uses the same card and initials beside the compact summary, with recent activity below. Changing the selected card updates the summary and exact-ID history together. No More Details disclosure is needed.

Bank summaries distinguish the current calculated/reported balance from its actual reporting baseline and selected-month **recorded credits/debits**. Transfers, refunds and repayments count as account movements, not as new income/spending categories. Self-to-self transactions do not add movement. Pending, voided, undated and future records do not enter monthly posted totals. Unknown balance remains unknown.

Debt current outstanding, usage, available credit and known statement dues remain distinct. Partial bill-only exposure retains **At least** and unknown availability/utilization. Amount due is shown only when statements establish it. A paid latest statement does not hide older unpaid dues; the next known unpaid date belongs to the same unpaid statement set. Unknown dates remain explicit. Future-dated allocations cannot mark today's dues paid. Credit-specific report, collateral and statement information still uses existing helpers and real account/bill routes.

The new presentation model reuses `accountBalance`, `accountUsage`, `latestBalanceSnapshot`, `latestSnapshot`, `billSummary` and decimal `sumMoney`. No core financial calculation, classification, database, authentication, transaction editor, actual record, carousel controller, virtual card renderer or transaction routing implementation is modified.

## Verification

The final production build (`npm run build -- --webpack`), full ESLint and standalone TypeScript checks passed. **994 unit/database tests across 42 files passed**, including 13 new summary-model regressions and one new optional-cutoff regression in the existing presentation tests. **All 18 scoped browser scenarios passed in one final run (35.2 seconds)** on the final production build.

Browser checks cover 320/390/768/1440px and all three account types; exact selected-account values and five-row histories; switching same-institution accounts; pending/voided/future/unknown/partial cases; single/empty groups; finite arrows, Home/End, focus and Escape; actual Chromium touch scrolling for bank and Pay Later; masked identifiers, initials and long-name/large-balance overflow; and actual `account`/`period=all` navigation. A dedicated case proves the paid-latest/unpaid-older statement amount/date remain consistent while a future verified payment does not reduce current dues. Every mocked workspace remains unchanged and no financial write occurs.

An initial 16-pass/2-fail browser run exposed two harness mistakes: a vertical-order assertion did not allow the requested desktop side-by-side layout, and a repayment fixture omitted the required source bank account. The assertions now validate the appropriate desktop geometry, and the fixture supplies a real synthetic bank source accepted by the unchanged allocation validator. No product change was made to make those invalid expectations pass; the complete final 18-case run has a clean exit.

Twelve [synthetic screenshots](account-details-followup/README.md) were captured and desktop/mobile results visually inspected. The selected card and summary remain visible on both layout styles, and recent activity follows in the scrollable body. A source/hash comparison confirmed all 143 product and focused test files match the verified copy. Core finance/usage/types, auth/API/database, transaction routing, existing carousel and virtual-card files have no diff from the audited base.

Checks run on a credentials-free E-drive source copy with the existing locked dependencies, disabled fixtures/private persistence, cleared cloud/backend/provider configuration and a separate production server on port 3205 with no server reuse. Browser workspace responses contain synthetic records only; external requests and financial writes are blocked. Physical phone gestures and live bank/cloud synchronization are outside these synthetic checks.

## Changed files

| Files | Purpose |
| --- | --- |
| `src/components/dashboard-details.tsx` | Preserve the dialog shell/spending content; delegate account views to a shared compact summary wrapper instead of hidden disclosures. |
| `src/components/financial-account-details.tsx`, `.css` | Compose the existing card/carousel/recent components with always-visible summaries and desktop columns. |
| `src/lib/account-detail-view.ts`, `.test.ts` | Read-only selected-account monthly activity, truthful baseline provenance and consistent cutoff statement dues, with 13 regressions. |
| `src/lib/account-presentation.ts`, `.test.ts` | Optional recent-history cutoff with existing default behavior preserved; add cutoff regression. |
| `src/components/recent-account-transactions.tsx` | Pass the optional cutoff to the existing helper. |
| `playwright.account-details.config.ts` | Separate, credentials-free production browser test server. |
| `tests/account-details-e2e/fixture.ts`, `account-cards.spec.ts` | Synthetic fixtures and the 18 functional/layout scenarios. |
| `docs/account-details-followup/` | Twelve synthetic screenshots and their index. |
| `docs/account-details-followup-verification.md`, `docs/project-context.md` | Audit, executed checks, scope limits and context link. |

This is a review branch. No production deployment, hosted policy/configuration change or owner-data mutation is performed by this follow-up.
