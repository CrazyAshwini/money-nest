# Accounts visual review

These are actual Chromium screenshots from an isolated local production build. Every account, identifier, transaction and amount is fictional QA data. Browser responses are mocked, external traffic is blocked, and no personal workspace or production credentials are used.

The before set was captured from audited main `c04f0af` before rebuilding the implementation. The after set uses the same default records, clock (22 October 2026 in Asia/Kolkata), viewport heights and browser settings. The application itself continues to derive the current date dynamically.

| Surface | Mobile before, 390px | Mobile after, 390px | Desktop before, 1440px | Desktop after, 1440px |
| --- | --- | --- | --- | --- |
| Accounts overview | [Before](before/390px/overview.png) | [After](after/390px/overview.png) | [Before](before/1440px/overview.png) | [After](after/1440px/overview.png) |
| Bank details | [Before](before/390px/bank-details.png) | [After](after/390px/bank-details.png) | [Before](before/1440px/bank-details.png) | [After](after/1440px/bank-details.png) |
| Credit card details | [Before](before/390px/credit-card-details.png) | [After](after/390px/credit-card-details.png) | [Before](before/1440px/credit-card-details.png) | [After](after/1440px/credit-card-details.png) |
| Pay Later details | [Before](before/390px/pay-later-details.png) | [After](after/390px/pay-later-details.png) | [Before](before/1440px/pay-later-details.png) | [After](after/1440px/pay-later-details.png) |
| Wallet details | [Before](before/390px/wallet-details.png) | [After](after/390px/wallet-details.png) | [Before](before/1440px/wallet-details.png) | [After](after/1440px/wallet-details.png) |

Additional responsive captures:

| Width | Overview viewport | Bank details |
| --- | --- | --- |
| 320px | [Overview](after/320px/overview.png) | [Bank](after/320px/bank-details.png) |
| 360px | [Overview](after/360px/overview.png) | [Bank](after/360px/bank-details.png) |
| 375px | [Overview](after/375px/overview.png) | [Bank](after/375px/bank-details.png) |
| 412px | [Overview](after/412px/overview.png) | [Bank](after/412px/bank-details.png) |
| 430px | [Overview](after/430px/overview.png) | [Bank](after/430px/bank-details.png) |
| 768px | [Overview](after/768px/overview.png) | [Bank](after/768px/bank-details.png) |
| 1024px | [Overview](after/1024px/overview.png) | [Bank](after/1024px/bank-details.png) |
| 1280px | [Overview](after/1280px/overview.png) | [Bank](after/1280px/bank-details.png) |
| 1920px | [Overview](after/1920px/overview.png) | [Bank](after/1920px/bank-details.png) |

The set contains **38 PNG files**: ten before and 28 after. Some full-page images include fixed mobile navigation at its viewport position within the extended image. The browser cases separately check that the final transaction scrolls above navigation and that controls, amounts and card content fit each viewport.

The mixed-owner marker records intentionally test client-side account-history isolation. Their appearance in an old mocked detail view is not evidence that a hosted API or RLS policy returned another user's real records.

Generation commands:

```sh
# Run this only against the original baseline build.
ACCOUNTS_CAPTURE_BEFORE=1 npx playwright test --config=playwright.accounts-redesign.config.ts

# After rebuilding the implementation, run the complete functional/responsive suite.
npx playwright test --config=playwright.accounts-redesign.config.ts
```

Test results and financial-preservation evidence are recorded in the parent verification report; screenshot existence alone does not establish that the entire suite passed.
