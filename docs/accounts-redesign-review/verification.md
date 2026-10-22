# Accounts overview and details — audit and verification

Date: 22 October 2026. Audited baseline: current `main`, `c04f0af`. Review branch: `feat/compact-account-pages`.

The Accounts pages now follow **one account → one virtual card → one financial summary**, followed by account-linked activity. This is a presentation change for pull-request review. It is not merged or deployed. The unfinished earlier Pay Later report draft was parked separately and was not applied to this branch.

## Audit before implementation

The audit inspected the actual Accounts implementation in `finance-app.tsx`, `VirtualAccountCard`, `FinancialCardCarousel`, `RecentAccountTransactions`, the account editor, statement/report UI, account-history helpers and the current financial/EMI selectors. There were no open pull requests at the start. The latest baseline includes the newer principal-based EMI, transaction-delete and accounting work; those implementations are preserved.

| Requirement | Initial status | Result |
| --- | --- | --- |
| All / Bank / Cards / Pay Later / Wallet filtering | COMPLETE | Retain the existing account-kind selection and archived-account access. |
| Shared card/carousel components and account-ID selection | COMPLETE | Reuse the existing components and native scroll controller; do not create another carousel. |
| Approved debt faces with outstanding, availability, limits and qualified utilization | COMPLETE | Preserve their canonical selector values and appearance. |
| Initials fallback and masked identifiers | COMPLETE | Retain verified existing branding/fallbacks and the last-four-only helper; omit an absent decorative identifier. |
| Bank/wallet balance inside the virtual card | PARTIAL | Move the existing current balance and provenance onto the card face; preserve unavailable values. |
| Separate balance/usage/date/Details footers | NEEDS CORRECTION | Remove the duplicate containers and unused footer CSS, rather than leave hidden or empty panels. |
| Edit action directly on every Accounts card | MISSING | Add a separate, labelled pencil button that opens the existing editor for the exact account. |
| Minimal individual-account header and content | NEEDS CORRECTION | Keep compact Back navigation, card/category heading, selected position and activity; remove the repeated internal title/actions/statistics. |
| Report editing, reconciliation and statement access | COMPLETE, RELOCATION NEEDED | Retain them through Edit Account → Statements and reports, off the primary details view. |
| Existing recent-history selectors and View All URL | COMPLETE | Preserve `getRecentAccountTransactions` and `accountHistoryHref`, including `account` and `period=all`. |
| Individual detail history under a mixed-owner payload | NEEDS CORRECTION | Replace the old account-ID-only render filter with the existing owner-scoped recent helper and scope Accounts composition to the authenticated owner. |
| Approved date-grouped transaction appearance | PARTIAL | Add a grouped presentation to the existing recent-account component, with shared category icons, category/platform metadata, statuses and transfer account names. |
| Mobile arrows/helper copy | NEEDS CORRECTION | Accounts presentation hides visible arrows on phones and removes swipe instructions while preserving touch/keyboard selection. Single-account groups omit navigation controls. |
| Compact desktop card-left/activity-right sections | PARTIAL | Use content-sized columns and remove space previously occupied by duplicate summaries. |
| Provider-specific static financial panels | NEEDS CORRECTION | Remove institution/name/suffix-triggered fixed figures and historical display entries. Retain saved selector-backed reports and EMI metrics. |
| Financial calculations, stored records, authentication and RLS | COMPLETE | No domain formulas, database schema, authentication or record mutations are required. |
| All requested responsive widths and interaction assertions | UNVERIFIED before implementation | Final browser results are recorded below; pending checks are not reported as passed. |

## Implemented and removed UI

- Accounts Overview retains its category tabs, sidebar, bottom navigation, central Add action and archived accounts. Each category uses the same card carousel beside recent activity on desktop, with the card above activity on phones.
- Bank and wallet faces show `accountBalance.current`, its actual calculation/report date and Calculated or Reported status. Unknown remains **Balance unavailable**. A calculated figure is never labelled issuer-verified.
- Credit Card and Pay Later faces retain separate outstanding, available credit/limit, total limit and meaningful utilization. Estimated, verified, partial and unknown states remain field-specific. Bill-only exposure does not become a complete balance or a utilization percentage.
- The pencil is a sibling of the account-details link, avoiding nested interactive elements. It uses the existing account editor and has an accessible account-specific label, tooltip and visible focus. Pressing it does not open account details.
- Closing an account or history editor restores focus to its opening control through an optional shared-modal return-focus target. The browser assertions cover pencil and keyboard-opened history rows.
- Individual details retain compact Back navigation and the account category/card position. The repeated account-title/header, large external Edit action, Reported Snapshot action, updated-balance explanation, repeated credit facts and three reconciliation statistic panels are removed from that screen.
- Recent Transactions/Statement History follows the card directly. Date groups use rounded containers, thin row separators, shared category/type icons, category/platform metadata, signed amounts and review status. Linked transfer account names are shown when recorded. Selecting another account updates the card and linked history together.
- Reconciliation, report capture, statement records, recorded dues, linked deposits and saved EMI metrics remain accessible through the existing Edit Account form’s **Statements and reports** link. The secondary management view can open the existing report, statement and repayment forms; navigating there does not save data.
- Static provider-specific figures and attached-history display branches were removed from report presentation. A matching issuer name or suffix no longer supplies fixed balances or historical transaction rows in this renderer. The generic EMI explanation no longer assumes every provider bills on the first of the month.

The removed containers include `.virtual-account-facts`, its repeated balance/usage/bill/footer content and the primary detail-page credit/reconciliation panels. Financial calculations, snapshot records, transaction audit information and statement data were not deleted with those containers.

## Financial and privacy preservation

All amounts remain selector-backed. Banks/wallets use `accountBalance`; debt uses `accountUsage` and `getCreditAvailabilityPresentation`. UI components do not introduce a new balance or available-limit formula. Current outstanding remains distinct from principal consuming the credit limit, issuer availability, unbilled amounts, statement dues and future interest. The current principal-based EMI behavior is preserved: future interest is not deducted upfront merely to make displayed totals reconcile.

Selection and history remain based on account IDs. Accounts and management compose the existing selectors over an authenticated-owner-scoped workspace. The existing single OR match includes a self-to-self record once; separate transaction IDs remain separate even when description, date and amount happen to match. Pending/voided/unknown-date activity retains its visible status and does not become a new financial calculation. View All continues to the supported account-filtered Transactions URL; the approved Category → Platform toolbar is not replaced by an account selector.

The mixed-owner browser fixture exposed that the former detail-page table filtered only by account ID. The new composition excludes the fixture’s foreign record before rendering. This is defensive presentation coverage; authentication/API ownership checks and RLS are unchanged, and no live cross-user exposure was tested or claimed.

An ignored local audit script captured before/after outputs for **eight fictional account scenarios**: calculated/reported banks, calculated/unknown wallets, a verified card, principal-based EMI Pay Later, partial bill-only exposure and an unknown-limit card. It also checks self-transfer uniqueness, distinct equal-value purchases and owner-filtered history. The final comparison passed with identical selector outputs and **all ten audited source hashes unchanged**: finance, usage, EMI, types, credit presentation, account presentation/detail view, Transactions view, provider and workspace API. The committed [comparison summary](selector-comparison.json) records the before/after hashes and scenario coverage.

## Executed verification

All final checks below were executed against the completed source or its final local production build, with synthetic records.

| Check | Actual result |
| --- | --- |
| Baseline production build at `c04f0af` | **Passed**, before implementation. |
| Baseline relevant financial/history/EMI unit tests | **Passed: 161/161 across six files.** This is baseline evidence, not an additional count to add to the final unit run. |
| Synthetic selector comparison and source hashes | **Passed:** eight scenarios unchanged and all ten source hashes unchanged. Re-run after any subsequent implementation change. |
| Targeted statement/report component ESLint and whitespace | **Passed.** |
| Before-screenshot capture | **Passed: 2/2 capture cases**, producing ten baseline PNGs. Not included in final regression totals. |
| Final relevant seven-file unit run | **Passed: 199/199.** Financial/history/EMI coverage and Transactions-view regressions. |
| Final full ESLint | **Passed:** `npm run lint`. |
| Final production build | **Passed:** `npm run build`, including the editor-focus correction. |
| Standalone TypeScript | **Passed:** `npm run typecheck`. |
| Scoped Accounts browser suite | **Passed: 31/31**, clean exit in 48.2s. All requested widths, exact-account actions, gestures, history, ownership, management and editor focus. |
| Unchanged Dashboard debt-sheet regressions | **Passed: 3/3** on the final build. Native card/Pay Later swipes and unknown/partial availability. |
| Unchanged multi-user session regressions | **Passed: 4/4** on the final build. Empty signup workspace/Back, session switching, delayed refresh and copied foreign-account links. |

The **38 passing browser regressions** cover 320, 360, 375, 390, 412 and 430px on phones, plus 768, 1024, 1280, 1440 and 1920px. Assertions establish visible card amounts, no page overflow or clipped controls, mobile arrow/helper removal, native swipe, desktop controls, keyboard/edit focus, selected-account history, View All and retained report tools. Read-only cases assert unchanged synthetic workspaces; the management save case permits only the explicitly submitted fictional snapshot.

Final unit and browser commands:

```sh
npx vitest run src/lib/finance.test.ts src/lib/usage.test.ts src/lib/account-detail-view.test.ts src/lib/account-presentation.test.ts src/lib/credit-presentation.test.ts src/lib/transactions-view.test.ts tests/amazon-pay-later-and-zet-emi.test.ts --maxWorkers=2 --testTimeout=30000 --hookTimeout=120000
npx playwright test --config=playwright.accounts-redesign.config.ts --max-failures=5
npx playwright test --config=playwright.final-ui.config.ts --grep='native touch debt sheets|unknown limits stay unknown' --max-failures=2
npx playwright test --config=playwright.multi-user.config.ts --grep 'A logout|existing A and B|older delayed A refresh|copied deep link' --max-failures=2
```

Selector comparison actually executed:

```sh
npx tsx artifacts/accounts-redesign/selector-baseline.ts --compare
```

## Before-and-after screenshots

All review images use fictional authenticated workspace responses, not owner records. Baseline images were captured from a fresh production build of `c04f0af` before implementation.

| View | Mobile before, 390px | Desktop before, 1440px | After |
| --- | --- | --- | --- |
| Accounts Overview | [Before](screenshots/before/390px/overview.png) | [Before](screenshots/before/1440px/overview.png) | [Mobile](screenshots/after/390px/overview.png), [desktop](screenshots/after/1440px/overview.png). |
| Bank details | [Before](screenshots/before/390px/bank-details.png) | [Before](screenshots/before/1440px/bank-details.png) | [Mobile](screenshots/after/390px/bank-details.png), [desktop](screenshots/after/1440px/bank-details.png). |
| Credit Card details | [Before](screenshots/before/390px/credit-card-details.png) | [Before](screenshots/before/1440px/credit-card-details.png) | [Mobile](screenshots/after/390px/credit-card-details.png), [desktop](screenshots/after/1440px/credit-card-details.png). |
| Pay Later details | [Before](screenshots/before/390px/pay-later-details.png) | [Before](screenshots/before/1440px/pay-later-details.png) | [Mobile](screenshots/after/390px/pay-later-details.png), [desktop](screenshots/after/1440px/pay-later-details.png). |
| Wallet details | [Before](screenshots/before/390px/wallet-details.png) | [Before](screenshots/before/1440px/wallet-details.png) | [Mobile](screenshots/after/390px/wallet-details.png), [desktop](screenshots/after/1440px/wallet-details.png). |

All **38 PNGs** and their provenance are indexed in the [screenshot review](screenshots/README.md). Mobile bank details and desktop overview were visually reviewed, as were the final representative card/detail states. Full-page captures show fixed navigation at its viewport position; browser checks separately verify that the last history row can scroll above it.

## Changed files

| Files | Purpose |
| --- | --- |
| `src/components/finance-app.tsx`, `workspace-layout.css` | Simplify Accounts overview/details, integrate on-card editing and grouped activity, retain compact navigation. |
| `virtual-account-card.tsx`, `financial-card-carousel.tsx`, `financial-card-carousel.css` | Move asset balances onto the face, remove duplicate footers, add separate pencil actions and Accounts-specific compact controls. |
| `recent-account-transactions.tsx`, `recent-account-transactions.css` | Reuse account selection/history with approved date-grouped rows; retain the legacy presentation for other callers. |
| `account-management.tsx`, `account-management.css`, `editors.tsx`, `ui.tsx` | Retain reports, reconciliation, statements and related account tools through the existing Edit Account flow; restore focus to editor openers. |
| `account-statement-details.tsx` | Keep selector-backed report/EMI content and remove static provider-specific figures/history. |
| `playwright.accounts-redesign.config.ts`, `tests/accounts-redesign-e2e/` | Isolated synthetic capture and functional/responsive browser coverage. |
| `docs/accounts-redesign-review/`, context documentation | Audit, implementation, verification and visual evidence. |
| `vercel.json` | Disable automatic deployment for this review branch; main’s production setting is unchanged. |

## Limits

No real account, financial transaction or private profile was accessed or edited. Tests use synthetic local fixtures with production credentials cleared, external traffic blocked and writes monitored. They do not verify hosted Supabase policy drift, live bank synchronization, actual issuer availability or installation behavior on a physical device.

The unrelated full receipt suite was not repeated to revisit its previously documented stream-cancellation errors. Older broad browser suites also contain historical heading/summary selectors; their known limitations are not claimed as new passes. Only executed scoped results belong in the final verification count.

The branch remains for owner review. No merge, production deployment, database migration, authentication setting change or financial-record correction is authorized by this redesign.
