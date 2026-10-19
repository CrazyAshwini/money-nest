# Analytics and financial card visual review

Before captures use repository `main` at `6cd486d`. After captures use this review branch’s tested production build. Both use the same fictional workspace, fixed clock (`2026-10-18T06:30:00Z`), locale (`en-IN`), timezone (`Asia/Kolkata`), and viewports: **390 × 844** and **1440 × 1000**. Images contain no real account, profile, credential, or transaction data.

The older `0c7dfa8` baseline was retained only in ignored historical artifacts; it is excluded from this comparison because newer shared account details and panda branding had already reached main.

| View | Mobile before | Mobile after | Desktop before | Desktop after |
| --- | --- | --- | --- | --- |
| Analytics | [Open](screenshots/before/390px/analytics.png) | [Open](screenshots/after/390px/analytics.png) | [Open](screenshots/before/1440px/analytics.png) | [Open](screenshots/after/1440px/analytics.png) |
| Keyboard chart focus | [Open](screenshots/before/390px/analytics-focused-chart.png) | [Open](screenshots/after/390px/analytics-focused-chart.png) | [Open](screenshots/before/1440px/analytics-focused-chart.png) | [Open](screenshots/after/1440px/analytics-focused-chart.png) |
| Credit card detail popup | [Open](screenshots/before/390px/credit-dialog.png) | [Open](screenshots/after/390px/credit-dialog.png) | [Open](screenshots/before/1440px/credit-dialog.png) | [Open](screenshots/after/1440px/credit-dialog.png) |
| Pay Later detail popup | [Open](screenshots/before/390px/pay-later-dialog.png) | [Open](screenshots/after/390px/pay-later-dialog.png) | [Open](screenshots/before/1440px/pay-later-dialog.png) | [Open](screenshots/after/1440px/pay-later-dialog.png) |
| Accounts credit cards | [Open](screenshots/before/390px/accounts-cards.png) | [Open](screenshots/after/390px/accounts-cards.png) | [Open](screenshots/before/1440px/accounts-cards.png) | [Open](screenshots/after/1440px/accounts-cards.png) |
| Daily spending popup | [Not implemented in baseline](screenshots/before/390px/daily-popup-not-implemented.txt) | [Open](screenshots/after/390px/daily-spending-popup.png) | [Not implemented in baseline](screenshots/before/1440px/daily-popup-not-implemented.txt) | [Open](screenshots/after/1440px/daily-spending-popup.png) |

The daily popup is new, so no artificial before-popup image was created. The after popup selects **10 October 2026** directly from its ISO source date and shows six fictional posted expenses totaling **₹66.00**. The popup scrolls internally; its action footer stays visible.

Chart focus evidence: [mobile before](screenshots/before/390px/focus-diagnosis.json), [mobile after](screenshots/after/390px/focus-diagnosis.json), [desktop before](screenshots/before/1440px/focus-diagnosis.json), [desktop after](screenshots/after/1440px/focus-diagnosis.json). Chromium supplied a black `auto 5px` SVG outline in the baseline. The scoped replacement is a green `solid 2px` keyboard outline and selected-day indicator. `role="application"` and `tabindex="0"` remain; pointer interaction has no persistent browser outline and the tooltip cursor is disabled.

The generic card fronts use issuer initials and a consistent aspect ratio. No approved issuer card reference or bank logo was supplied, so these images demonstrate the honest fallback rather than an imitation of a bank product. The same card face is used on mobile and desktop. Account pages place selector-derived financial facts below the face; shared popups show those facts once in the adjacent or following account summary.

Capture command: `npm run test:e2e -- --config=playwright.analytics-cards.config.ts captures.spec.ts` (with `ANALYTICS_CAPTURE_PHASE=before` only for the clean baseline). Captures use a credentials-free isolated server, mocked authenticated data, blocked external requests, and assert zero workspace writes or unexpected APIs.

These are Chromium browser captures and viewport/touch emulation, not certification of a physical phone, Safari, hosted authentication, or hosted database policies. See the accompanying implementation report for executed test results and scope.
