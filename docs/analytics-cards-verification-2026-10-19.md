# Interactive Analytics and account card review

Prepared against current main **`6cd486d`**, including the merged account-detail and panda-branding updates. This branch is for review; it does not merge or deploy the changes, enable public signup, or change hosted authentication settings.

## Audit before implementation

The audit covered `charts.tsx`, `finance-app.tsx`, `virtual-account-card.tsx`, `financial-card-carousel.tsx`, `dashboard-details.tsx`, `finance.ts`, `usage.ts`, `account-presentation.ts`, `globals.css` and `fintech-screens.css`. On resumption, main had advanced from `0c7dfa8`; the new `FinancialAccountDetails` and `accountDetailView` were audited and retained before applying the presentation changes.

| Requirement | Audit result | Action |
| --- | --- | --- |
| Daily spending and monthly/category selectors | COMPLETE | Reuse canonical selectors; no financial formula changes. |
| Date-specific spending popup | MISSING | Add shared Radix daily dialog, real transaction rows, existing editor and exact-date ledger navigation. |
| Recharts black rectangle | UNVERIFIED → NEEDS IMPROVEMENT | Reproduce Chromium's full-SVG focus outline; replace it locally while retaining keyboard access. |
| Compact Analytics and category navigation | NEEDS IMPROVEMENT | Align summaries/charts, use consistent category colors and link to scoped ledger filters. |
| Credit and Pay Later availability | NEEDS IMPROVEMENT | Use one selector-backed presentation for verified, estimated, partial and unknown data. |
| Account-detail summary, statements and dues | COMPLETE except availability | Preserve the newly merged shared details; improve availability and partial-data labels. |
| Virtual account presentation | NEEDS IMPROVEMENT | Separate physical-proportion neutral fronts from financial facts underneath. |
| Verified issuer/product art | UNVERIFIED; none supplied or present | Use institution names and clearly identified initials; do not fabricate logos, product variants or network marks. |
| Existing card carousel and exact-account history | COMPLETE | Keep the single controller, gestures, finite navigation and history selectors. |
| Financial calculations, ownership, auth and RLS | COMPLETE for this scope | Preserve the implementations and stored data; add read-only Analytics owner scoping. |

## Result

Every daily chart bin, including zero-total dates, uses its full source ISO date. The entire date column is tappable without changing the data or giving zero values artificial heights. Desktop hover shows a compact date/amount/action hint; click or tap opens the daily dialog and suppresses the tooltip. Arrow keys select a date, and Enter or Space opens it. Escape closes the dialog and restores the actual chart or insight-button trigger.

The 560px desktop dialog becomes a mobile bottom sheet above navigation, with a scrolling body and safe-area footer. Its total comes directly from `dailySpending`; gross expenses, posted expense count and matched refunds remain separate. Net mode includes the real matched refund records and their applied amounts, explains negative days, and preserves full saved amounts when caps apply. Pending, voided, undated expenses, transfers and repayments do not enter spending. Rows open the existing transaction editor without introducing another editor or write path.

**View all transactions** opens the complete saved-date ledger, including other statuses and account movements on that date. Category links apply the selected month, exact category, `expense` kind and `posted` status. These filters are visible and clearable. Invalid dates/months produce an empty result instead of silently broadening the ledger.

Analytics uses compact net/gross/refund summaries, aligned monthly and category panels, a linked category breakdown, spending-day insights and a small calculation disclosure. Unlinked and excess refunds retain concise warnings. Category totals explicitly remain gross expenses in both modes. Recharts remains lazy-loaded from the Analytics route.

The black rectangle was reproduced on latest main: Chromium applied `rgb(16, 16, 16) auto 5px` to the focusable `.recharts-surface[role="application"]`, covering the entire chart. The gray tooltip cursor was a separate element. Scoped chart CSS replaces the browser outline with a subtle green keyboard indicator and highlights the active day. `accessibilityLayer`, focusability, keyboard navigation and the accessible data table are retained; no global outline suppression was added.

Browser testing also reproduced an interaction defect where the zero reference line intercepted clicks at the center of a net-mode date bin. Decorative reference/grid lines now ignore pointer events; the test uses a normal click rather than bypassing the obstruction.

Switching from pointer hover to arrow keys also exposed stale Recharts hover content. Keyboard focus now uses one selected source point for the tooltip, highlighted day, live announcement and dialog activation. Pointer movement restores normal hover content; the keyboard tooltip stays within the plotting area.

The interaction regression includes selecting another date after closing the popup, covering the transition from restored keyboard focus back to a normal click or touch.

Credit cards and Pay Later show shared available-credit/limit blocks in virtual cards, account pages and dashboard dialogs. Estimates are labelled explicitly. Bill-only minimum exposure cannot establish remaining availability; unsupported limit-minus-bill estimates stay hidden. A separately verified availability report remains valid even when total usage is partial or the approved limit is unknown. Dashboard totals sum only supported selector values and show partial coverage when any availability or limit is missing. Current outstanding, credit used, approved limits and statement dues retain distinct labels.

Outstanding verification applies only to the outstanding amount, since a different utilization report may have a different verification state. Empty groups never claim verification. Explicit ledger months remain authoritative even if a manually supplied URL also contains `period=all`; selecting All dates clears the month restriction and its chip together.

There are no approved bank/provider reference images in the inputs or repository. Card fronts therefore use consistent neutral colors, safe decorative shapes, saved institution names and initials. They intentionally do not claim to reproduce a specific issuer product. Identifiers use the existing last-four helper. There are no full card numbers, invented chips, network marks, expiry dates or payment credentials.

Visual review removed duplicate financial blocks inside dashboard dialogs: the same virtual-card renderer shows its front there, with availability and other financial facts once in the shared summary beside it on desktop or underneath on mobile. Account pages retain the front and financial facts together. The desktop Gross/Net control also has an explicit readable font size instead of inheriting the old chart control's 8px text.

## Validation

- `npm run lint`: passed.
- `npm run build`: passed with Next.js 16.4.0 / Turbopack, including build-time TypeScript validation.
- `npm run typecheck`: passed as a standalone check after the final production build.
- Focused Vitest: **156 passed across 7 files**, clean exit. Command: `npm run test -- src/lib/analytics-presentation.test.ts src/lib/credit-presentation.test.ts src/lib/finance.test.ts src/lib/usage.test.ts src/lib/account-detail-view.test.ts src/lib/account-presentation.test.ts tests/brand-assets.test.ts --maxWorkers=2`.
- Scoped Playwright: **43/43 passed**, clean exit in 58.0s. Command: `npm run test:e2e -- --config=playwright.analytics-cards.config.ts`.
- Two tooltip cases then gained explicit visibility assertions; both affected cases passed their targeted rerun (4.4s) on the same unchanged app build.
- Existing shared account-detail Playwright regressions: **18/18 passed**, clean exit in 21.0s. Executed with `npm run test:e2e -- --config=/tmp/money-nest-account-details-system-chromium.config.ts --max-failures=3`.
- **22 synthetic screenshots** cover matched desktop/mobile Analytics, chart focus, Credit Card and Pay Later dialogs, account cards, and the new daily popup.

Unit coverage includes posted-only spending, exact dates, gross/net consistency, cross-month refund caps, excess reimbursements, separate refund originals, owner isolation, malformed early-refund legacy data, verified availability, estimates, partial bills, unknown limits, zero availability and partial aggregates. An independent comparison of 150 synthetic attribution cases matched the prior full-ledger selector approach. Grouping calls by original purchase reduced a synthetic 4,000-expense/800-refund drilldown from approximately 3.3s to 0.29s on this machine; this is a local diagnostic, not a production performance guarantee.

Browser validation uses an isolated production server on port 3022 with server reuse disabled, fixture flags off, private persistence disabled, cloud/provider credentials cleared, external requests blocked and synthetic authenticated workspace responses. The responsive matrix is **320, 375, 390, 430, 768, 1024 and 1440px**. Synthetic users and mixed-owner payload checks validate this UI's isolation behavior; they do not establish the deployed Supabase RLS state.

The scoped run covers exact-date totals and editor navigation, gross/net refund caps, empty days/month switching, pointer/keyboard tooltip agreement, repeated normal clicks and touchscreen taps, focus restoration, resizing, category/date/month filters, unknown and partial credit states, verification scope, desktop keys/arrows, native Chromium card swipes and account-specific histories. A separate read-only hybrid keyboard-to-touch probe also opened the expected day popup with no writes or browser errors.

The existing account-detail suite used its original isolated port 3205 and environment settings. Its temporary adapter selected `/usr/bin/chromium` because the bundled Playwright executable is absent, and resolved the existing test directory/server working directory from `/tmp`. The original suite's availability locator now targets the shared availability block, and its bank provenance assertion targets the explicit report-plus-movements summary. Exact financial values, histories, masking, isolation, dues and normal gestures remain asserted. Standard installations with Playwright Chromium can use `playwright.account-details.config.ts` directly.

Test harness changes align assertions with the current short-month date display, Radix-hidden background navigation, asynchronous route navigation, accessible Description textarea, updated carousel labels and absent ledger table in the empty state. The financial amounts, exact IDs, ownership checks and normal click/touch assertions remain enforced; no forced clicks or retries bypass the interaction defects.

The full unrelated unit suite was not rerun merely to revisit its previously recorded receipt multipart cancellation errors (`ERR_INVALID_STATE: ReadableStream is already closed`). Those historical runner errors are not reported as current passes or new failures. Older broad browser suites also contain outdated heading/calendar selectors; this task uses a scoped suite tied to actual current controls. Live provider integrations, hosted database policy drift and physical-device gestures were not tested.

Matched before/after screenshots and their source/fixture descriptions are in [the review screenshot index](analytics-cards-review/README.md). The baseline was rebuilt and captured from `6cd486d`; an older `0c7dfa8` capture was preserved locally as historical evidence and excluded from the final comparison. No daily popup existed before this change, so no fabricated before-popup image is included.

## Preservation and release boundary

`finance.ts`, `usage.ts`, `account-detail-view.ts`, the carousel controller, schema, migrations, authentication, RLS policies, package manifests and lockfile have no task diff. No owner profile or finance store was opened, modified, seeded or migrated. Product behavior is verified using synthetic records only. The feature branch has Vercel automatic deployment disabled in `vercel.json`; merging or deploying still requires owner approval.
