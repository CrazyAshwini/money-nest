# Transactions activity redesign — audit and verification

Date: 19 October 2026. Baseline: current `main` commit `93fb8ed`. Review branch: `feat/transactions-activity`.

This change refines the existing Transactions page around **Month → Type → Category → Platform → Search → Summary → History**. It is for pull-request review. It has not been merged or deployed, and the branch is excluded from automatic Vercel deployments.

## Audit before implementation

The audit inspected `finance-app.tsx`, the workspace provider, transaction editor, shared financial/account/Analytics selectors, category/platform storage, URL builders, import/export entry points and existing tests. The existing implementation was preserved where it already met the request.

| Requirement | Initial classification | Action |
| --- | --- | --- |
| Canonical posted-expense/income calculations; refunds and repayments remain distinct | COMPLETE | Reuse `monthlySummary`, `sumMoney` and recorded transaction kinds. Do not change financial selectors. |
| Owner-scoped transaction filtering and authenticated workspace access | COMPLETE | Preserve API/provider isolation; scope the new view, options and account metadata to the authenticated owner. |
| Existing transaction editor, save validation and account-balance confirmations | COMPLETE | Preserve the existing editor and validation. Opening history/details does not save a record. |
| Import route and formula-safe CSV export | COMPLETE | Preserve `/imports`, Settings export and a secondary Transactions footer; remove header actions. |
| Analytics date/category/status and selected-account history links | COMPLETE | Retain their URL meanings; account scope is contextual information, never a primary account dropdown. |
| Deterministic transaction-date ordering | COMPLETE | Retain date-plus-ID ordering and add an oldest-first option; undated records stay last. |
| Header, month selection, tab order and compact presentation | NEEDS IMPROVEMENT | Add a top-right month selector, current-month default and exact All → Expenses → Transfer → Income order. |
| URL state across filtering, refresh and browser navigation | NEEDS IMPROVEMENT | Use one URL-derived filter model and native History API integration with Next navigation; remove the query-key remount. |
| Mobile history and desktop columns | NEEDS IMPROVEMENT | Group compact phone rows by date; retain a desktop table with category, platform, account/source, amount and status. |
| Category → Platform history controls on All/Expenses | MISSING | Add category-specific suggestions and preserved saved custom options. |
| Read-only Others history bucket | MISSING | Filter nonstandard/unassigned saved platforms without opening an entry form. |
| Expandable search beside category/platform controls | MISSING | Add focus, Escape/close behavior and search over existing saved metadata. |
| Contextual financial summary and focused empty state | MISSING | Add separate gross expenses, recognized income and transfer totals; add contextual tab summaries and Clear filters. |
| Responsive bounds, focus restoration and browser history behavior | UNVERIFIED | Covered by the new browser suite; final execution results are recorded below. |

No database schema, Supabase configuration, authentication, OTP verification, RLS policy or account-balance change was required.

## Implemented behavior

- Normal entry selects the current calendar month from the provider's existing Asia/Kolkata `today`, independently of a previously selected Analytics month. The selector includes All dates, recent empty months and months present in saved records.
- Explicit valid date links take precedence over month/all-date links. Invalid dates and months produce an empty, explained result instead of broadening the scope. Explicit unsupported status restrictions also remain empty until cleared.
- Changing the transaction tab preserves the period. Transfer includes the model's `transfer` and `bill_payment` kinds, including external repayments; account-link direction does not redefine spending or income. Existing explicit refund, adjustment and repayment links remain supported.
- Category and Platform appear on All/Expenses. Transfer/Income hide and ignore those controls while preserving their values for a return to expense filtering. Changing Category resets only Platform. There is no account dropdown or separate Filters button.
- Suggested platforms follow the requested category mappings. Saved custom platforms and categories remain selectable. Matching is case-insensitive and normalizes surrounding/repeated whitespace; no category is inferred from a platform.
- `Others` matches platforms outside the selected category's suggestion list, including suitable blank, legacy `Other` and custom records. It only changes the history filter.
- History filter labels alias `Other`/blank to `Others` and legacy `Stationery` to `Stationery Items`. Saved text and Add/Edit category definitions remain unchanged. `Education` and additional user categories are preserved.
- Search replaces the filter row, focuses its input and searches merchant, description, category, platform, reference and existing metadata. Closing it or pressing Escape clears only the query and restores the search trigger; Category, Platform and Month remain selected.
- All shows one matching-record count and separate Expenses, Income and Transfers totals. Expenses uses a contextual category/platform heading and posted expense count. Other tabs show their relevant posted activity. Status notes explain excluded review, voided or invalid-date entries.
- Financial amounts use the same filtered owner-scoped records as history. Gross expenses and income come from `monthlySummary` over posted, valid-date records; transfer amounts use decimal-safe `sumMoney` over the appropriate posted kinds. Refunds and adjustments stay visible as separate activity and are not silently counted as income or netted against gross expenses. No new net/refund reconciliation formula was introduced.
- Phone history groups rows by recorded date; desktop history uses the same sorted matching records. Details show saved payment source, type, status, reference, notes and validated original-source links. Explicit Edit opens the existing editor. There was no existing transaction Delete capability to retain, and none was added.
- Missing dates display "Date not recorded"; malformed saved dates display "Date unavailable" without being normalized into a different day or contributing to posted totals.
- Clear filters resets Category, Platform and Search while retaining period and tab, then restores control focus. Explicit linked account/status/date/kind restrictions have their own compact context and clear action. A read-only URL subscription handles rapid browser traversal after refresh without copying filters into a second state store. Serialization emits a single value per supported query key.
- Existing bottom navigation, central Add action, desktop navigation, branding and unrelated pages are retained. Dialogs use Radix, a mobile bottom sheet, safe-area padding and trigger focus restoration.

## Verification results

All results below were executed locally against synthetic records. Browser runs used the final production build.

| Check | Actual result |
| --- | --- |
| New transaction-view/category tests | **Passed: 42 focused tests** (38 new, 4 existing). Included in the larger relevant run below. |
| Relevant unit/integration tests | **Passed: 361/361 tests across 10 files.** Scope: transaction view, category/platforms, finance, usage, Analytics presentation, CSV imports, private imports, cloud request policy, workspace API and database multi-user isolation. |
| `npm run lint` | **Passed.** |
| `npm run build` | **Passed**, including the final rapid browser-traversal and focus fixes. |
| `npm run typecheck` | **Passed** as a separate command after restoring the generated `next-env.d.ts` path-only build change. |
| Scoped Playwright Transactions suite | **Passed: 22/22.** Functional filtering, summaries, read-only details/edit entry, rapid Back/Forward after refresh, malformed dates, responsive layout, keyboard/focus and reduced motion. |
| Existing affected account/Analytics browser regressions | **Passed: 11/11** (6 Analytics, 3 exact-account history, 2 native carousel View All). Updated history selectors retain amount, ownership and exact-link assertions. |
| Affected session-isolation browser regressions | **Passed: 4/4.** Empty signup workspace/reload/Back, same-browser A/B sessions, delayed stale refresh and copied foreign-account links. |
| Source formatting and whitespace | **Passed:** Prettier on the seven changed/new source files and `git diff --check`. |

The **37 passing browser cases** include 320, 360, 375, 390, 412, 430, 768, 1024 and 1440px. Assertions cover control bounds, page overflow, visible totals, long merchant names, large amounts, month/tab preservation, custom/blank platform buckets, URL navigation, isolated account/Analytics drilldowns and the absence of writes during filter/detail viewing. Baseline screenshot capture separately passed 2/2; it is not included in that regression count.

Executed commands:

```sh
npm run lint
npm run build
npm run typecheck
npx vitest run src/lib/transactions-view.test.ts src/lib/category-platforms.test.ts src/lib/finance.test.ts src/lib/usage.test.ts src/lib/analytics-presentation.test.ts src/lib/imports.test.ts src/lib/private-import.test.ts src/lib/cloud-request.test.ts src/app/api/workspace/route.test.ts tests/db-multi-user-isolation.test.ts --maxWorkers=2 --testTimeout=30000 --hookTimeout=120000
npx playwright test --config=playwright.transactions.config.ts
npx playwright test --config=playwright.analytics-cards.config.ts --grep='daily gross popup|category links apply|malformed .* filter|category month links|an explicit month'
npx playwright test --config=playwright.account-details.config.ts --grep='View all opens'
npx playwright test --config=playwright.refinement.config.ts --grep='native horizontal touch, local keyboard focus and accurate View all'
npx playwright test --config=playwright.multi-user.config.ts --grep 'A logout|existing A and B|older delayed A refresh|copied deep link' --max-failures=2
```

## Before-and-after review evidence

The images use fictional `QA` transactions and accounts through authenticated local workspace mocks. They contain no owner records. The baseline images were captured from the existing page before its replacement.

| View | Before | After |
| --- | --- | --- |
| Mobile, 390px | [Existing Transactions](screenshots/before/390px/transactions.png) | [Updated viewport](screenshots/after/390px/transactions-viewport.png), [full history](screenshots/after/390px/transactions.png). |
| Desktop, 1440px | [Existing Transactions](screenshots/before/1440px/transactions.png) | [Updated viewport](screenshots/after/1440px/transactions-viewport.png), [full history](screenshots/after/1440px/transactions.png). |

The [screenshot index](screenshots/README.md) links all 19 images, including Category/Platform, expanded search, details and each additional width. Mobile and desktop screenshots were visually reviewed. Full-page captures include fixed navigation at its viewport position; browser assertions separately verify scrolling the last row clear of navigation.

## Changed files

- Page integration and reusable visuals: `src/components/finance-app.tsx`, `src/components/transaction-icon.tsx`.
- Focused Transactions UI and styling: `src/components/transactions-workspace.tsx`, `src/components/transactions-workspace.css`.
- Read-only filtering and summary presentation: `src/lib/transactions-view.ts`, history-only additions to `src/lib/category-platforms.ts`.
- Unit coverage: `src/lib/transactions-view.test.ts`.
- Browser coverage and synthetic fixtures: `playwright.transactions.config.ts`, `tests/transactions-e2e/fixture.ts`, `tests/transactions-e2e/transactions.spec.ts`, `tests/transactions-e2e/before.capture.ts`.
- Existing browser selectors adjusted to the replacement history surface: `tests/account-details-e2e/account-cards.spec.ts`, `tests/analytics-cards-e2e/analytics-cards.spec.ts`, `tests/refinement-e2e/refinement.spec.ts`, `tests/multi-user-e2e/session-isolation.spec.ts`.
- Review evidence and context: this report, `docs/transactions-review/screenshots/` and `docs/project-context.md`.
- Review-only deployment guard: `vercel.json` disables deployment for this feature branch; main's production behavior is unchanged.

## Limits and preserved data

Browser verification uses an isolated production server, synthetic authenticated workspace responses, test fixtures disabled, no production credentials, blocked external traffic and tracked unexpected API calls/writes. The database isolation tests exercise local test infrastructure; neither those tests nor browser mocks certify the hosted Supabase project's current settings. No real user was signed in and no financial record was created, edited or deleted for this UI review.

The unrelated full receipt suite was not repeated to revisit its previously recorded `ReadableStream is already closed` cancellation errors. Older broad browser suites also contain historical heading/calendar selectors; this task updates affected history selectors and runs scoped relevant cases rather than claiming the full historical browser suite passes. Those known limits are not presented as failures reproduced by the Transactions redesign.

The user must review the pull request before merge or production deployment. No production authentication/public-signup setting was changed.
