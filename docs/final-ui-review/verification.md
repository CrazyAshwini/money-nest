# Final loading, Home and debt-card refinement

Audited against main `0ca408c` (the merged and deployed compact-card PR #8). GitHub had no open pull requests at the start. This is a new review branch, `feat/final-ui-refinement`; merging or deploying is outside this task's authorization.

## Audit before implementation

| Requirement | Classification | Action |
| --- | --- | --- |
| Approved panda artwork, current header, sidebar and mobile Add/navigation | COMPLETE | Reuse existing assets and controls. |
| Bank balance, monthly gross/refund rules and credit/Pay Later selectors | COMPLETE | Retain canonical selectors and all financial formulas. Clearly label Home's existing gross spending. |
| Separate on-card outstanding/availability with field-specific status | COMPLETE | Retain values and provenance. |
| ID-based carousel, gestures, arrows, keyboard and account-only history | COMPLETE | Keep controller/history helpers and recheck current rendered behavior. |
| Centered large panda startup screen, quotes and shield footer | NEEDS IMPROVEMENT | Replace the old small-icon/spinner/skeleton composition. |
| Honest progress | NEEDS IMPROVEMENT | Use actual request stages with indeterminate progress; the combined endpoint provides no measurable percentage. |
| Bounded loading failure and Retry state | NEEDS IMPROVEMENT | Bound request/body reading, show generic errors, retry without signing out. |
| Home total credit/approved limits | MISSING | Show existing known limit totals with explicit partial/unknown states. |
| Equal-height, aligned debt summaries and compact desktop composition | NEEDS IMPROVEMENT | Add the third value without restoring verbose panels; use balanced rows. |
| On-card limit and utilization | MISSING | Move existing selector-backed facts onto the face. |
| Debt dialog summary duplication | NEEDS IMPROVEMENT | Remove repeated summary/statements; put selected-account history immediately after the carousel. |
| Verified artwork when available; safe fallback otherwise | COMPLETE | Repository assets contain approved MoneyNest branding, with no verified issuer/provider card artwork. Retain neutral issuer names/initials; do not invent logos, chips or network marks. |
| Dense-card geometry, loading lifecycle and responsive rendering | UNVERIFIED before changes | Validate with synthetic browser cases and matched screenshots. |

The audit inspected `finance-app.tsx`, `finance-provider.tsx`, `virtual-account-card.tsx`, `financial-card-carousel.tsx`, `dashboard-details.tsx`, `financial-account-details.tsx`, `account-summary.tsx`, `recent-account-transactions.tsx`, `finance.ts`, `usage.ts`, `account-presentation.ts`, the relevant CSS, existing fixtures and tests. The actual startup screen was a conditional inside `FinanceApp`; `LoadingSkeleton` itself remains available for other consumers.

## Implementation

The dedicated `WorkspaceLoading` component presents the original 160px panda, Money NEST immediately beneath it, actual-stage messages, a slim indeterminate bar, the four supplied quotes at 4.5-second intervals, dots and a shield footer. Reduced motion disables animated transitions. There are no invented percentages, 99% stalls or intentional success delays. The provider bounds both request and body reading to 30 seconds, cancels superseded/unmounted reads and keeps its existing generation/identity guards. Errors use safe generic copy and a working Retry; authentication cookies are not cleared.

Home retains its four ordered summaries, header controls and recent activity. It now exposes total credit and approved limits using `usageSummary.limitTotal` and `knownLimitCount`. Missing limits remain Not available, and incomplete totals say Partial. Outstanding and availability keep separate qualifications. Desktop uses balanced bank/spending and credit/Pay Later rows instead of stretching the bank card across both rows.

Credit Card and Pay Later faces now contain total limits and meaningful utilization using the existing `accountUsage` outputs and shared meter. Bill-only data is explicitly Known exposure / At least / Partial, with Usage unavailable and no misleading meter. Independent reported availability remains independent. Debt dialogs show the carousel, five linked transactions and account management. Statement dues, next unpaid due dates, generation/update dates and credit breakdowns are relocated to a compact dedicated-account section using `accountDetailView`; existing reporting, statement history and reconciliation remain available there. Bank account summary behavior is unchanged. Debt faces retain the preferred physical-card proportion as a minimum size and grow to fit dense content at narrow widths; no artwork is stretched or identity clipped.

## Verification

- `npm run lint`: passed on the completed loading and financial UI implementation.
- `npm run build`: passed, including build-time TypeScript validation after the session-refresh race fix.
- `npm run typecheck`: passed after restoring Next's generated `next-env.d.ts` path-only build change.
- Focused Vitest: **145/145 passed**, five files. Command: `npm run test -- src/lib/credit-presentation.test.ts src/lib/finance.test.ts src/lib/usage.test.ts src/lib/account-presentation.test.ts src/lib/account-detail-view.test.ts --maxWorkers=2`.
- New final UI Chromium suite: **15/15 passed**, clean exit in 32.2s. Command: `npx playwright test --config playwright.final-ui.config.ts --max-failures=3`.
- Existing shared account-detail regressions: **18/18 passed**, clean exit in 23.4s. Command: `npx playwright test --config playwright.account-details.config.ts --max-failures=3`.
- Existing session lifecycle/isolation cases: **9/9 passed unchanged**, clean exit in 14.7s. Command: `npm run test:e2e -- --config=playwright.multi-user.config.ts --max-failures=2`.

- Focused existing card/provenance/carousel regressions: **17/17 passed**, clean exit in 22.8s. Command: `npx playwright test --config playwright.analytics-cards.config.ts --grep 'virtual card|missing institution|long names and large amounts|direct availability|dashboard aggregate|empty debt|outstanding verification|desktop arrow|mobile native swipe' --max-failures=3`.
- A final empty Pay Later label correction was rebuilt and passed lint and standalone TypeScript. The affected dashboard/empty-group/verification subset passed **3/3**, clean exit in 5.6s: `npx playwright test --config playwright.analytics-cards.config.ts --grep 'dashboard aggregate|empty debt|outstanding verification' --max-failures=3`. These three overlap the preceding 17; counts are not additive. The correction affects only empty groups and leaves the non-empty screenshot output unchanged.

Browser coverage includes **320, 375, 390, 430, 768, 1024 and 1440px**; all card sections and identities fit in order without clipping or horizontal page overflow. Summary heights/amount alignment, safe dialog stacking, reachable account actions, close-focus restoration, normal touch gestures, keyboard/arrow selection, and exact account-linked history are asserted. Dense neutral debt faces may grow beyond the preferred physical-card ratio to preserve readable amounts and identity.

Loading tests hold real workspace requests pending, verify the large icon and under-logo-only wordmark, exercise quote rotation and reduced-motion styles, advance the 30-second timeout, check safe error text and Retry with a retained synthetic session cookie, and separately hold JSON-body parsing to verify an actual loading stage. Success is not delayed for animations or quotes. The indicator has no fabricated `aria-valuenow` or numeric percentage.

The first responsive pass exposed fixed-height identity clipping after adding the requested financial facts; content-fitting card height resolved it. The existing session suite also caught an aborted save-triggered refresh being mistaken for a failed refresh during an account switch. Superseded callers now await the strictly newer bounded refresh outcome before their unchanged identity checks. The original nine-case suite passes without modifying its assertions.

The shared statement-dues regression retains its exact aggregate of recorded unpaid statement balances and next unpaid date on the dedicated account page. That aggregate remains distinct from individual statement-history rows, which preserve their existing all-time payment behavior.

**Nineteen screenshots** include eight matched desktop/mobile before-and-after pairs, a supplemental 390px dashboard viewport and 320/390px long-name/large-amount stress captures. Screenshot generation does not create or change saved financial records. Physical-device installation, hosted Supabase policies and live auth/email integrations were not tested.

The before/after evidence uses fictional accounts and profile data, never the owner's records. Browser servers disable private persistence and fixture flags, clear cloud/provider credentials, mock authenticated workspace responses and block unexpected external requests/writes. These checks do not establish live Supabase policy/configuration or actual email delivery.

The full unrelated receipt suite is not rerun to revisit its previously documented Node/Undici stream cancellation errors. Older broad suites also contain stale heading/demo-strip and account-summary selectors. Only intentionally affected assertions are adapted to the new layout; neither historical limit is reported as a new pass.

## Changed-files summary

| Files | Purpose |
| --- | --- |
| `workspace-loading.tsx`, `workspace-loading.module.css`, `finance-provider.tsx` | Panda startup presentation, request-stage reporting, bounded retry and stale-refresh completion handling. |
| `finance-app.tsx`, `dashboard.css` | Integrate the loader, show correctly qualified Home totals and use balanced dashboard rows. |
| `virtual-account-card.tsx`, `financial-card-carousel.css` | On-face total limit/utilization, explicit partial exposure, content-fitting debt-card geometry. The carousel controller is unchanged. |
| `financial-account-details.tsx`, `.css`, `account-statement-details.tsx`, `.css` | Prioritize selected history in debt dialogs and retain supporting statement facts on dedicated pages. |
| New final UI tests/config; affected account-detail/card tests and config | Exercise loading, financial provenance, gestures, responsive geometry and relocated detail fields; support system Chromium where bundled Chromium is absent. |
| `vercel.json`, review docs and `project-context.md` | Disable automatic deployment for this review branch and record audit, screenshots and verification. |

## Preservation

No financial formulas, account history rules, carousel controller, authentication endpoints/settings, OTP verification, RLS, schema, stored records, import/deduplication code, package manifests or lockfiles are changed. The `finance-provider.tsx` diff is confined to loading-stage/error presentation, request cancellation and timeout handling. Automatic deployment is disabled for this feature branch. No production settings or records were accessed or modified.

Screenshots and source/fixture provenance are indexed in [README.md](README.md).
