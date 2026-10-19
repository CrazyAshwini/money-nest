# Compact credit and Pay Later summaries

Follow-up to the approved Analytics/card release, merged into main as `a3a5c03`. The audit found that dashboard debt tiles repeated utilization, outstanding, availability, limits and coverage notes, while the shared dialog hid the card's financial facts beneath its face.

The dashboard now shows two clearly labelled amounts: outstanding and available credit/limit, followed by an account count and the existing View details action. Short per-amount qualifiers retain estimated, partial and verified-report distinctions. Limits, utilization, statement dues and the fuller explanation remain in account details.

Both amounts also appear directly on the credit-card and Pay Later faces, including the faces in dashboard dialogs. The repeated availability block beneath account-deck cards is removed. Existing identity, last-four masking, neutral issuer fallback, swipe controller and account-specific history are retained.

## Financial semantics

Outstanding uses `accountUsage.currentOutstanding`, separately from `used` or utilization. The dashboard's read-only presentation helper sums only known outstanding values with the existing decimal helper. It marks incomplete coverage partial; bill-only exposure does not become a complete outstanding balance. Entirely unknown outstanding stays Not available, and reported zero stays zero.

Availability continues to use the existing presentation helper and its selector provenance. Estimated availability stays estimated. A direct verified availability report can still appear even when outstanding or the approved limit is unknown. Limit minus partial bill-only exposure is never shown as actual availability. Verification of outstanding does not certify a separate usage or availability value.

## Executed validation

- `npm run lint`: passed.
- `npm run build`: passed, including build-time TypeScript validation; repeated after the final dashboard label-alignment adjustment.
- `npm run typecheck`: passed after restoring the generated `next-env.d.ts` path-only change.
- Focused Vitest: **82/82 passed** across credit presentation, usage, account presentation and account-detail selectors. Command: `npm run test -- src/lib/credit-presentation.test.ts src/lib/usage.test.ts src/lib/account-presentation.test.ts src/lib/account-detail-view.test.ts --maxWorkers=2`.
- Initial scoped Chromium run: **24/24 passed**, clean exit in 37.2s. Command: `npm run test:e2e -- --config=playwright.analytics-cards.config.ts --grep 'viewport|virtual card|missing institution|direct availability|dashboard aggregate|empty debt|outstanding verification|desktop arrow|mobile native swipe|compact debt' --max-failures=4`.
- Following the final CSS adjustment, **14/14 targeted cases passed**, clean exit in 24.9s, including two added long-name/large-amount stress cases and refreshed captures. Command: `npm run test:e2e -- --config=playwright.analytics-cards.config.ts --grep 'viewport|long names and large amounts|dashboard aggregate|empty debt|outstanding verification|compact debt' --max-failures=3`. This overlaps the initial run; the counts are not additive.
- Existing shared account-detail regressions: **18/18 passed**, clean exit in 20.4s. Command: `npm run test:e2e -- --config=/tmp/money-nest-account-details-system-chromium.config.ts --max-failures=3`. The temporary adapter selects `/usr/bin/chromium`, resolves the existing test directory and server working directory, and otherwise preserves `playwright.account-details.config.ts` settings. The final subsequent CSS adjustment affects dashboard label spacing only.

Browser coverage includes **320, 375, 390, 430, 768, 1024 and 1440px**, no page overflow, non-overlapping in-face metrics, verified/estimated/unknown availability, partial outstanding coverage, independently verified availability with bill-only usage, separate outstanding versus utilization reports, keyboard arrows/Home/End, native Chromium swiping, selected-account histories and dialog focus restoration. Empty debt groups remain explicit rather than showing fabricated zeroes. Long issuer/product names and large amounts fit the 320/390px card faces; the 390px dashboard debt tiles are approximately 244px high. Physical-device testing and live provider/database integrations are outside this UI check.

**Twelve screenshots** provide six matched before/after comparisons: dashboard, Credit Card dialog and Pay Later dialog at 390px and 1440px.

All browser records, account names and profile details in the review evidence are synthetic. The isolated browser servers disable private persistence and fixture flags, clear provider/cloud configuration, mock authenticated workspace responses and block external requests. No production login, financial write or profile access was performed.

The full unrelated unit suite was not rerun to revisit the previously documented receipt stream cancellation errors (`ERR_INVALID_STATE: ReadableStream is already closed`). The old broad browser suite also retains obsolete heading/demo-strip and account-detail markup assumptions. Its intentionally changed dashboard assertions are updated, but that legacy suite is not claimed as passing; current scoped tests cover the affected behavior.

## Review boundary

`finance.ts`, `usage.ts`, `account-detail-view.ts`, carousel selection logic, authentication, ownership checks, RLS, schema, stored records and package/lock files are unchanged. This branch disables its own automatic Vercel deployment. No production deployment or authentication-setting change is part of this follow-up.

Matched desktop/mobile screenshots and capture provenance are in [the screenshot index](README.md).
