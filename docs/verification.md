# Verification — 9 October 2026

The delivered local app uses fictional, browser-local records. No cloud project, real financial data, banking integration or Notion workspace was modified.

## Automated checks

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run test` — 66 tests passed across four files.
- `npm run build` — production build passed.
- `npm run test:e2e` — 18 browser tests passed on the final production build, nine desktop and nine mobile, with no uncaught exceptions or console errors.
- `npm audit --json` — zero reported vulnerabilities, including development dependencies.

Financial checks cover exact decimal arithmetic, repayments excluded from spending, capped matched refunds with excess retained, real due dates, missing dates, provisional allocations, invalid payment/account matching, shared-expense shares, edits to allocated records, and reconciliation across the India/UTC date boundary.

CSV checks cover strict date/money parsing, quoting/newlines, reviewed selections, source IDs, re-import idempotency, legitimate equal-value purchases, formula-safe exports, and UUIDs scoped to the owner.

The database suite executes the complete migration in PGlite with mocked Supabase Auth/Storage schemas and two owners. It verifies actual row isolation, composite foreign keys, private object paths, decimal serialization, audited mutations, allocation ceilings, atomic import rollback, subset re-imports, and exact-reference duplicate guards. This is not live Supabase verification or a multi-connection concurrency test.

## Production-server smoke checks

The server is started using `npm run start` and binds to `127.0.0.1:3000`. The dashboard and PWA manifest return HTTP 200. The dashboard disables caching of private content and includes frame protection. Unconfigured workspace/document/sign-in endpoints return HTTP 503 instead of inventing an authenticated user or accepting private financial records.

## Remaining live checks

A dedicated configured Supabase development project is required to test sign-up and confirmation email, cookie refresh and sign-out, multi-device data persistence, actual Storage uploads and signed downloads, concurrent network writes, database advisors and backup restoration. These are prerequisites for a production release with real data. PDF/OCR, external notifications and Notion import are not connected in this version.

## Browser evidence

The compact-home update keeps four totals and aggregate credit limits/usage visible, collapses the three account breakdowns by default, and replaces repeated account cards/charts with three bills and three editable activity rows. Account details remain available through the native expand controls and Accounts page; the home insights link leads to Analytics. Production build and lint pass, and eight targeted desktop/mobile browser checks pass without browser errors, including expansion, activity editing and Analytics navigation. The default home fits within a 1000-pixel desktop viewport and is approximately 1243 CSS pixels tall at 360-pixel mobile width.

The account-summary update adds 23 usage tests; all 89 automated tests across five files pass. The final update also passes lint, type checking through the production build, and eight targeted desktop/mobile browser checks (six new account-summary checks and two dashboard navigation/layout regressions).

The new browser fixture includes four banks, six credit cards and two Pay Later providers. It verifies every active account appears, inactive accounts are excluded, account links and masked identities work, limits and exact aggregate usage agree, and unknown reports/limits stay neutral. Usage at 29.9%, 30%, 70% and 125% receives the correct green/amber/red band; over-limit meters preserve the actual percentage while capping their fill. All account cards remain available on narrow mobile layouts.

The browser suite verifies account edits, expense creation/edit/reload, exact spending updates, transfers excluded from spending, partial card allocations and invalid destination rejection, external lender repayment matching, filtered CSV export, installment states, explicit CSV approval/re-import duplicate prevention, unsupported PDF rejection, and reminder persistence.

At 360 and 393 CSS pixels, the settled page, layout viewport and document scroll width agree. The transaction table scrolls within its own panel; modal buttons and drawer navigation are reachable. The table container establishes the containing block for its visually hidden header so that the header cannot escape into page overflow. Updated screenshots are saved in ignored `artifacts/dashboard-desktop.png` and `artifacts/dashboard-mobile.png` (the latter reflects 360 CSS pixels at 2.75 device-pixel ratio). Larger synthetic account fixtures are captured under `artifacts/account-summary-results`.
