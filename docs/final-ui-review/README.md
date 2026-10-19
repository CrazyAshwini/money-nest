# Final UI visual review

These are real Chromium screenshots of the local production build with fictional QA records. All account names, institutions, transactions and amounts are synthetic. No owner session, financial profile, Supabase credentials or production writes were used.

The **before** screenshots were captured before rebuilding for this task, against the existing production build (`LwWtJrf5pG2f2XOyQbdEs`) matching main commit `0ca408c4d65b8b52ce9b3ebbb7bef4b44a242eed` (the merged compact credit-card follow-up). The **after** screenshots use the current final UI refinement build. Both sets use the same QA workspace and 18 October 2026 clock, at 390 × 844 and 1440 × 1000 CSS pixels. The loader's workspace request is deliberately held pending so its actual loading state can be inspected; it is then released to complete initialization.

| Interface | Mobile before → after | Desktop before → after |
| --- | --- | --- |
| Loading | [Before](screenshots/before/390px/loading.png) → [After](screenshots/after/390px/loading.png) | [Before](screenshots/before/1440px/loading.png) → [After](screenshots/after/1440px/loading.png) |
| Dashboard | [Before](screenshots/before/390px/dashboard.png) → [After](screenshots/after/390px/dashboard.png) | [Before](screenshots/before/1440px/dashboard.png) → [After](screenshots/after/1440px/dashboard.png) |
| Credit card details | [Before](screenshots/before/390px/credit-card.png) → [After](screenshots/after/390px/credit-card.png) | [Before](screenshots/before/1440px/credit-card.png) → [After](screenshots/after/1440px/credit-card.png) |
| Pay Later details | [Before](screenshots/before/390px/pay-later.png) → [After](screenshots/after/390px/pay-later.png) | [Before](screenshots/before/1440px/pay-later.png) → [After](screenshots/after/1440px/pay-later.png) |

The dashboard pairs are full-page captures. Chromium places the fixed mobile navigation at the original viewport position in a full-page capture; use the supplemental [390px dashboard viewport](screenshots/after/390px/dashboard-compact.png) to inspect both complete debt tiles and their actions above the navigation.

The supplemental [320px](screenshots/after/320px/large-amount-card.png) and [390px](screenshots/after/390px/large-amount-card.png) stress captures show fictional long names and large amounts. Dense mobile fronts can grow beyond the preferred physical-card ratio so required values, the product name and masked identifier remain readable. The automated geometry checks enforce containment and non-overlap for every financial block and the identity row.

The approved panda artwork is reused unchanged. Existing issuer references contain institution text and initials; no verified issuer/product card artwork was supplied. The card fronts therefore retain an explicit neutral fallback rather than fabricated logos, payment-network marks or product designs.

To regenerate current-build review images with the existing credential-cleared isolated server configuration:

```sh
npx playwright test --config playwright.final-ui.config.ts review-capture.spec.ts
```

The historical before images are retained as evidence. Set `FINAL_UI_CAPTURE_BASELINE=1` only when deliberately capturing the exact baseline build; running it against changed source would overwrite their provenance.

See [implementation and verification](verification.md) for the audit, executed checks, responsive coverage and remaining limitations. Local mocked UI checks do not certify hosted signup activation, Supabase email delivery or installed-device PWA behavior.
