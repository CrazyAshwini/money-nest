# Responsive workspace and account carousel verification

Date: 18 October 2026. Base: `main` at `66509e8` (owner-only email OTP signup). This change implements the supplied Responsive UI Refinement & Swipeable Financial Cards brief in the existing application. It does not deploy, change production authentication, migrate a database, or access the owner's finance/profile records.

## Audit and implementation

The starting checkout was clean. Current main, open PRs, `AGENTS.md`, project context, relevant Next navigation documentation, existing components/selectors and tests were inspected before edits. Open branding PR #2 was inspected for overlap; its changes were not merged or copied. Existing approved panda branding is reused. There are no approved institution logo assets in this checkout, so cards use institution initials.

| Area | Initial status | Changes / preserved behavior | Evidence |
| --- | --- | --- | --- |
| Shared mobile header | NEEDS FIX | Replaced repeated breadcrumb/eyebrow/global actions with contextual headings; retained Back and secondary navigation on detail/supporting routes. | Nine viewport checks across five pages; matched screenshots. |
| Accounts compact layout | NEEDS FIX | Grouped active accounts by kind, compact virtual fronts, explicit archived disclosure, contextual Add account. | Empty/single/multiple decks, archive/deep-link checks and screenshots. |
| Bank left/right swipe | MISSING | Shared native scroll-snap carousel, finite arrows, keyboard navigation and stable selected ID. Local directional touch permission contains finite-edge gestures while allowing vertical scrolling and pinch zoom. | Native Chromium touch, arrows, focus, resize/reorder/removal checks. |
| Credit-card left/right swipe | MISSING | Same shared controller, existing usage selector, truthful unknown/partial labels. | Native touch and selected-card data checks; partial-credit fixture. |
| Detail popup swipe | MISSING | Bank, credit and Pay Later dialogs use the shared carousel and selected-account details/history. | Mobile/desktop dialog interaction, vertical scroll, focus/Escape/restore checks. |
| Account-specific transactions | MISSING | Four recent rows on Accounts, five in dialogs; exact account and owner ID associations; stable date/ID ordering; View all applies `account` and `period=all`. | Helper tests and browser history/filter assertions, including refunds/transfers/statuses. |
| Analytics month picker | NEEDS FIX | Calendar only in Analytics; Net spending first, compact gross/refunds and disclosure for accounting explanation. | All-page calendar checks; changing Analytics month preserves current bank values. |
| Profile grouping | NEEDS FIX | Compact identity, real Account/Preferences/Data destinations, existing profile edit/sign-out/export handlers and finance navigation. | All existing hub destinations/secondary Back; isolated private auth test. |
| Contextual Import/Add | NEEDS FIX | Add account on Accounts, Import on Transactions; desktop transaction creation retained. Center bottom Add stays the mobile creation entry. | One mocked save from each primary page; no duplicate mobile Add. |
| NestBot overlap | NEEDS FIX | Home panda entry and secondary footer action open one real chat dialog; removed floating pill and older unavailable dialog. Existing chat/review/scanner handlers retained. | Mocked chat/error/receipt handoff; existing receipt browser regression; visible-bot screenshots. |
| Desktop consistency | NEEDS FIX | Sidebar retained; contextual headings, bounded virtual cards with selected history alongside, centered dialogs and grouped Profile. | 1024/1440/1920px checks; 1440px screenshots. |
| Accessibility | NEEDS FIX | Labeled arrows, finite disabled states, current/count announcement, inert offscreen card links, visible focus, reduced-motion navigation and dialog focus. | Scoped keyboard/reduced-motion/modal checks. This is not a screen-reader certification. |
| Financial logic regression | COMPLETE | **Verified; skipped.** Reused `accountBalance`, `accountUsage`, `monthlySummary` and existing ledger/edit/report handlers. No financial domain, provider, API, database or auth configuration changes. | Existing unit/database assertions and source diff; unknown/partial/current-date browser assertions. |
| Existing bottom navigation and authentication restrictions | COMPLETE | **Verified; skipped.** Existing five-item navigation/editor and authentication/session handlers retained. | Primary-page Add checks, private-account regression and 22 signup/OTP cases. |

The 390px baseline reproduced the reported waste: the first bank card began at approximately y=489, and the floating bot overlapped the account edit area above the bottom bar. The refined card begins at approximately y=193, with four history rows visible above navigation. These are measurements of the supplied synthetic scenario, not promises for every account name or text size.

## Implementation files

| Files | Purpose |
| --- | --- |
| `src/components/finance-app.tsx`, `src/components/workspace-layout.css` | Contextual shell/actions, Analytics layout, grouped Accounts and same-category detail navigation, exact transaction query filtering and selected creation kind. |
| `src/components/financial-card-carousel.tsx`, `src/components/financial-card-carousel.css` | Reusable native horizontal scrolling, selected ID synchronization, arrows, keyboard/focus and compact account/history styling. |
| `src/components/virtual-account-card.tsx`, `src/components/recent-account-transactions.tsx` | Selector-backed virtual fronts, masked identifiers, recorded statements and linked ledger previews. |
| `src/lib/account-presentation.ts`, `src/lib/account-presentation.test.ts` | Read-only selection/masking/history URL/association helpers and six focused tests. |
| `src/components/dashboard-details.tsx`, `src/components/dashboard-details.css` | Selected-account carousels/history inside existing Radix dialogs; full report/provenance/edit actions remain available. |
| `src/components/dashboard-welcome.tsx`, `src/components/dashboard-welcome.css`, `src/components/nestbot.tsx`, `src/components/nestbot.css` | Consolidated real NestBot entry/dialog with existing chat and receipt review behavior. |
| `src/components/private-profile.tsx`, `src/components/private-profile.module.css` | Compact authenticated Profile hub; existing handlers preserved. |
| `playwright.refinement.config.ts`, `tests/refinement-e2e/captures.spec.ts`, `tests/refinement-e2e/fixture.ts`, `tests/refinement-e2e/refinement.spec.ts` | Credentials-free synthetic browser regression/capture harness. |
| `vercel.json` | Disable automatic deployment for this review branch; production/main behavior unchanged. |
| This report, `docs/project-context.md`, `docs/ui-refinement/README.md` and `docs/ui-refinement/screenshots/` | Review evidence and updated project context. |

The core financial selectors (`finance.ts`, `usage.ts`), state provider, server/API/auth handlers, migrations, package manifest and lockfile are unchanged. Account page navigation uses `router.replace` within the current category so browsing does not create an entry per swipe; Back returns to the preceding page. Selection follows IDs rather than array indices. Archived details remain reachable.

## Validation

Commands run in the isolated Linux checkout using Node 24.21.0 and the frozen lockfile:

| Command / check | Result |
| --- | --- |
| `npm ci --include=optional --no-audit --no-fund` | Passed; fresh 462-package install. TLS/integrity checks retained. |
| `npm run lint` | Passed. |
| `npm run build` | Passed with the default Turbopack production builder. |
| `npm run typecheck` | Passed. |
| `npm run test -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=120000` | 783 unit/database tests passed across 36 files, including six new helper tests. **Command exited 1** because of the two known unhandled receipt-stream errors below. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --config=playwright.private-auth.config.ts` | 1 passed: real isolated temporary private-store setup/session protection/OTP isolation/logout/password login flow. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --config=playwright.signup.config.ts` | 22 passed, including invalid/expired/resend OTP and authenticated redirect checks with mocked provider responses. |
| Existing `tests/access-e2e/nestbot-receipt.spec.ts` with `playwright.access.config.ts` and temporary system-Chromium/cwd override | 2 passed, at 390px and 1440px; receipt goes through human review, images never sent to chat, no workspace writes. |
| `npm run test:e2e -- --config=playwright.refinement.config.ts --project=chromium` | All 40 unique scenarios validated on the final application build: full run 37 passed, three harness/expected-text failures; corrected cases passed on focused reruns, detailed below. |

The dedicated browser server runs on port 3020 with real backend/auth/provider/private configuration cleared, fixture gate disabled, external requests blocked, and synthetic authenticated workspace responses. Only the explicit center-Add tests allow intercepted synthetic saves. These checks do not send email, invoke a live AI provider or write a real financial account.

Browser: Playwright 1.64.0 with Chromium 154.0.8037.57 on Debian 13. The final full scoped run passed 37 cases. Two new missing-account test tails initially used an invalid slug, which correctly reached the generic 404; they now use an absent valid UUID and the existing metadata heading `Account details`, checking exactly one heading/Back and the account-not-found state. The third failure expected bill-only credit usage to say `At least`; the unchanged credit selector correctly returns `Not reported`, available `Unknown`, a separately recorded statement of ₹220 and no utilization meter. That corrected case passed in a focused three-case rerun; the two final deep-link cases then passed with `--grep='deep-link selector'` (2 passed). No application code changed during those expectation corrections. This verifies 40 unique scenarios, rather than claiming the full command had a clean 40-pass exit.

Widths checked are 320, 360, 375, 390, 430, 768, 1024, 1440 and 1920px. The evidence set contains matched before/after 390px and 1440px captures for Home, Accounts Bank, Accounts Cards, Analytics, Profile, bank dialog, credit dialog and visible NestBot: [screenshot index](ui-refinement/README.md).

The first scoped browser run exposed a genuine Chromium touch issue: an extra swipe at the beginning of a deck could navigate browser Back even with `overscroll-behavior-x: contain`. A minimal native deck reproduced it outside React, including mobile emulation. Local directional `touch-action` at the finite edges prevents that unavailable direction; available horizontal navigation, vertical scrolling and pinch zoom stay native. No page-level gesture listener or `preventDefault` was added. Review also removed duplicate detail-page Back links and kept a title/return path for unavailable detail records.

## Known limits and manual review

- The full Vitest runner still reports two previously diagnosed `ERR_INVALID_STATE: ReadableStream is already closed` errors in the Node/Undici multipart cancellation path exercised by `src/lib/ai-receipt-service.test.ts`. Assertions pass; the runner's exit status is failure. This UI change does not modify those files or suppress the errors. The full suite was run once for this change; it was not repeated just to revisit this known limitation.
- Historical default browser suites contain old expectations for global Home/Transactions calendars, the Profile “Your profile” heading, an Accounts hamburger, the unavailable NestBot panel, `.bank-card` grids and simultaneous dialog account records. They were inspected; a blanket default-suite pass is not claimed. The scoped configuration exercises the new contract and retained finance/auth flows.
- Browser testing uses Chromium, desktop and touch emulation. Physical Android installed-PWA behavior, operating-system safe-area rendering, a real software keyboard, dark presentation and assistive-technology reading have not been certified. Existing safe-area/editor behavior is retained; owner device review remains useful.
- Real owner data, hosted Supabase email delivery/configuration, live AI-provider availability and production browser behavior were not exercised. Authentication restrictions and production settings are unchanged.
- Institution marks are safe initial fallbacks because approved local logos were unavailable. No card-network logo, full identifier, expiry, CVV, PIN or fabricated financial value is added.

## Review and release

The review PR links this report and the screenshot index. Do not merge or deploy this UI change without owner approval. Automatic deployment is disabled for `feat/responsive-account-carousels`; review the matched screenshots and manual device limits before authorizing release. No production settings step is required by this implementation.
