# Responsive UI screenshot comparison

These matched viewport captures use synthetic QA accounts and transactions only. The baseline is `66509e8`; the after images show the review branch's production build. Both use the same fixture in [`tests/refinement-e2e/fixture.ts`](../../tests/refinement-e2e/fixture.ts), a fixed clock of **18 October 2026, 12:00 IST** (`2026-10-18T06:30:00Z`), and the `en-IN` locale. They contain no owner records, private exports, credentials, or real financial identifiers.

The capture test runs against an isolated local production server on port 3020, with real private/Supabase/provider configuration cleared, fixture mode disabled, authenticated workspace API mocks, and external requests blocked. The visible bot image demonstrates layout; it does not certify a live AI provider.

## Mobile — 390 × 844

| View | Before | After |
| --- | --- | --- |
| Home | [Before](screenshots/before/390px/home.png) | [After](screenshots/after/390px/home.png) |
| Accounts · Bank | [Before](screenshots/before/390px/accounts-bank.png) | [After](screenshots/after/390px/accounts-bank.png) |
| Accounts · Cards | [Before](screenshots/before/390px/accounts-cards.png) | [After](screenshots/after/390px/accounts-cards.png) |
| Analytics | [Before](screenshots/before/390px/analytics.png) | [After](screenshots/after/390px/analytics.png) |
| Profile | [Before](screenshots/before/390px/profile.png) | [After](screenshots/after/390px/profile.png) |
| Bank details | [Before](screenshots/before/390px/bank-dialog.png) | [After](screenshots/after/390px/bank-dialog.png) |
| Credit details | [Before](screenshots/before/390px/credit-dialog.png) | [After](screenshots/after/390px/credit-dialog.png) |
| NestBot visible | [Before](screenshots/before/390px/bot-visible.png) | [After](screenshots/after/390px/bot-visible.png) |

## Desktop — 1440 × 1000

| View | Before | After |
| --- | --- | --- |
| Home | [Before](screenshots/before/1440px/home.png) | [After](screenshots/after/1440px/home.png) |
| Accounts · Bank | [Before](screenshots/before/1440px/accounts-bank.png) | [After](screenshots/after/1440px/accounts-bank.png) |
| Accounts · Cards | [Before](screenshots/before/1440px/accounts-cards.png) | [After](screenshots/after/1440px/accounts-cards.png) |
| Analytics | [Before](screenshots/before/1440px/analytics.png) | [After](screenshots/after/1440px/analytics.png) |
| Profile | [Before](screenshots/before/1440px/profile.png) | [After](screenshots/after/1440px/profile.png) |
| Bank details | [Before](screenshots/before/1440px/bank-dialog.png) | [After](screenshots/after/1440px/bank-dialog.png) |
| Credit details | [Before](screenshots/before/1440px/credit-dialog.png) | [After](screenshots/after/1440px/credit-dialog.png) |
| NestBot visible | [Before](screenshots/before/1440px/bot-visible.png) | [After](screenshots/after/1440px/bot-visible.png) |

## Capture method

[`captures.spec.ts`](../../tests/refinement-e2e/captures.spec.ts) captures the same first bank/card, selected filters, and dialog state before and after the implementation. It waits for the authenticated synthetic workspace and web fonts, uses viewport screenshots with animations disabled, and asserts no ledger writes, unexpected API calls, or browser errors.

With a current production build, regenerate the after set using:

```sh
REFINEMENT_CAPTURE_PHASE=after npm run test:e2e -- --config=playwright.refinement.config.ts --project=chromium captures.spec.ts
```

Raw captures are written to ignored `artifacts/ui-refinement/after`; reviewed pairs are retained here for pull-request review. The `before` set was captured from the unchanged baseline before editing, rather than recreated from the new UI.

Browser emulation covers layout and native Chromium touch behavior. Physical Android installation, operating-system keyboard/safe-area behavior, live financial workspaces, and live provider responses require separate authorized checks.
