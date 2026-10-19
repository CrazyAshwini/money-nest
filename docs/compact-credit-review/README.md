# Compact credit summaries — review images

These are synthetic Chromium captures from the same fictional QA workspace in `tests/analytics-cards-e2e/fixture.ts`, with its fixed 18 October 2026 clock. They contain no owner profile, saved personal records, real payment credentials or production session.

The before images were captured before rebuilding, using the preceding production build from `8615190`. Its source tree is identical to current main's PR #7 squash merge, **`a3a5c03`**. The after images use the new production build on `feat/compact-credit-card-summaries`. Both phases use the same fixture, route and viewport; the screenshot test is `compact-captures.spec.ts`.

| View                | 390px before                                          | 390px after                                          | 1440px before                                          | 1440px after                                          |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Dashboard summaries | [Open](screenshots/before/390px/dashboard.png)        | [Open](screenshots/after/390px/dashboard.png)        | [Open](screenshots/before/1440px/dashboard.png)        | [Open](screenshots/after/1440px/dashboard.png)        |
| Credit card dialog  | [Open](screenshots/before/390px/credit-dialog.png)    | [Open](screenshots/after/390px/credit-dialog.png)    | [Open](screenshots/before/1440px/credit-dialog.png)    | [Open](screenshots/after/1440px/credit-dialog.png)    |
| Pay Later dialog    | [Open](screenshots/before/390px/pay-later-dialog.png) | [Open](screenshots/after/390px/pay-later-dialog.png) | [Open](screenshots/before/1440px/pay-later-dialog.png) | [Open](screenshots/after/1440px/pay-later-dialog.png) |

The dashboard now presents two monetary facts per debt tile: current outstanding and available credit/limit, with short field-specific status labels and an account count. The same existing card renderer puts both account-specific amounts directly on each debt card face, including inside the dashboard dialogs. The fuller account summary remains available below the card on mobile and beside it on desktop. The existing neutral issuer-initials artwork is retained because no verified issuer artwork was supplied.

The captures use an isolated local production server with private persistence disabled, test fixture flags off, backend/provider credentials cleared, mocked authenticated workspace responses and blocked external requests. They do not establish live Supabase configuration or production deployment.
