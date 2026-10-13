# Money Nest UI refinement audit

**Date:** 13 October 2026

**Scope:** Approved `Expense_Tracker_UI_Refinement_README.md`, applied to the existing application.

## Findings and changes

The useful compact dashboard and the previously requested light receipt form remain. The work concentrates on readability, restrained shared surfaces, accessible charts and truthful asynchronous states.

- Shared tokens now define spacing, corner radii, surfaces, borders and semantic states. Secondary labels and tables are more readable; monetary values use tabular numerals.
- Account cards no longer rise on hover. Ordinary dialogs and mobile navigation use quieter overlays and shadows. The sign-in illustration retains its wording without decorative rings, rotation or a glowing background.
- Shared empty states no longer use a decorative diamond, and Receipt AI settings no longer use a sparkle icon. Functional action and navigation icons remain.
- Light receipt text uses a darker muted color. Receipt buttons retain their pill shape with simpler surface separation.
- Category colors stay consistent across months and between the breakdown and category details. The complete legend and an accessible summary represent every displayed category; panels grow to contain the full legend.
- The spending chart uses a solid restrained fill, existing monetary formatting for its accessible values, keyboard support and a screen-reader table with the exact underlying monetary strings. Axes have room for labels; large totals and tooltips wrap within their available space. Chart and tooltip animations are disabled.
- Very large category totals wrap inside the donut instead of being clipped by inherited table `nowrap` styling. Normal-sized totals retain their compact presentation.
- Skeletons appear during actual workspace and initial order requests. Orders do not display zero totals, premature record counts or an empty state before their first successful response. Refreshing retains the last loaded content, while loading, failures and busy refund forms remain communicated accessibly. Loaded history and refund headings retain their existing wording and counts.

## Pattern review

“Kept purposeful” means the pattern conveys information, supports an interaction or preserves an established user preference. “Absent” means no change was warranted.

| #   | Pattern                             | Outcome                 | Evidence or decision                                                                                                                |
| --- | ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Harsh gradients                     | Fixed                   | Sign-in decoration flattened; chart fill simplified. Restrained existing balance emphasis remains.                                  |
| 2   | Generic icon use                    | Fixed / kept purposeful | Empty-state diamond removed; action, navigation and financial icons retained.                                                       |
| 3   | Pure-white backgrounds              | Kept purposeful         | Warm light receipt surfaces and white input fields remain readable and match the requested form.                                    |
| 4   | Rainbow coloring                    | Fixed                   | Stable category mapping and semantic state tokens; visible labels accompany colors.                                                 |
| 5   | Excessive shadows                   | Fixed                   | Reduced ordinary dialog/navigation shadows and removed receipt-button shadows.                                                      |
| 6   | Repeated three-card rows            | Kept purposeful         | Account and record grids reflect actual records; the compact dashboard retains four useful summaries.                               |
| 7   | Emoji interface icons               | Absent                  | Existing functional icons are consistent SVG icons.                                                                                 |
| 8   | Glassmorphism                       | Fixed / kept purposeful | General modal and navigation blur removed; no decorative glass panels added. Receipt overlay treatment respects the reference form. |
| 9   | Formulaic em dashes                 | Kept purposeful         | Existing wording and punctuation preserved exactly.                                                                                 |
| 10  | Generic typography                  | Fixed                   | Clearer secondary text, table hierarchy and consistent numeric alignment.                                                           |
| 11  | Decorative colored stripes          | Kept purposeful         | Active navigation and usage indicators identify state; no unrelated accent strips added.                                            |
| 12  | Fake testimonials                   | Absent                  | No testimonials or fabricated ratings introduced.                                                                                   |
| 13  | Repetitive bento grids              | Kept purposeful         | Real account summaries, lists, tables and charts remain; no layout rebuild.                                                         |
| 14  | Decorative terminal windows         | Absent                  | No fake technical interfaces found or introduced.                                                                                   |
| 15  | Formulaic marketing copy            | Kept purposeful         | Existing sign-in copy preserved; no marketing rewrite.                                                                              |
| 16  | Excessive checkmark bullets         | Absent                  | Check icons communicate successful operations or explicit confirmations.                                                            |
| 17  | Unnecessary pricing tiers           | Absent                  | No pricing sections introduced.                                                                                                     |
| 18  | Missing real product demonstrations | Kept purposeful         | Existing record and reporting interfaces remain the product; only synthetic data is used for verification.                          |
| 19  | Excessive corner radii              | Fixed / kept purposeful | Shared radius tokens restrain general surfaces; requested receipt pills remain.                                                     |
| 20  | Purple-and-black themes             | Kept purposeful         | Established dark neutral and green brand identity retained.                                                                         |
| 21  | Missing loading states              | Fixed                   | Real initial requests show skeletons and loading status; refresh preserves loaded data.                                             |
| 22  | Radial orbs                         | Fixed                   | Decorative sign-in radial background and orbit rings removed.                                                                       |
| 23  | Dot grids                           | Absent                  | No decorative background dot grids added.                                                                                           |
| 24  | Sparkle icons                       | Fixed                   | Decorative Receipt AI settings sparkle removed.                                                                                     |
| 25  | Decorative animated arrows          | Absent                  | Directional arrows remain functional; no decorative arrow animations.                                                               |
| 26  | Missing Terms of Service            | Owner policy needed     | No owner-approved terms supplied. Do not invent legal text. Existing provider terms disclosures remain accessible.                  |
| 27  | Missing Privacy Policy              | Owner policy needed     | Data & privacy settings and receipt disclosures remain accessible; a complete owner-approved policy is still needed.                |
| 28  | Excessive hover animation           | Fixed                   | Account hover lift removed; restrained focus and hover feedback remain.                                                             |
| 29  | Neon colors                         | Kept purposeful         | Brand accent is retained for interaction and state; no neon glow or unrelated saturation introduced.                                |
| 30  | Pastel-heavy styling                | Fixed / kept purposeful | Consistent semantic tokens and stable category colors; light receipt styling remains the requested preference.                      |

## Routes and workflows audited

Source audit covers `/dashboard`, `/accounts`, `/transactions`, `/transactions/new`, `/bills`, `/pay-later`, `/fixed-deposits`, `/loans`, `/emi-calendar`, `/split-bills`, `/imports`, `/orders`, `/analytics`, `/notifications`, `/settings`, `/profile`, `/profile/setup` and `/login`. Record views for accounts, bills, deposits, loans and shared expenses use the same shared styling.

The audit includes create/edit dialogs, category-dependent platforms, seller descriptions, receipt and order scanning, refund verification, statement import review, reminders, exports, month filters, empty states, mobile navigation, keyboard focus and the existing 404 page. Budgets and recurring payment automation are not added where the application does not support them.

## Modified components

| Files                                                                               | Purpose                                                                                                         |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/app/globals.css`, `src/components/shell.css`                                   | Shared tokens, readable text, numeric alignment, restrained surfaces, overlays and hover feedback.              |
| `src/components/ui.tsx`, `src/components/ai-settings.tsx`                           | Remove decorative empty-state and AI icons; retain labels and actions.                                          |
| `src/components/receipt-scanner.css`                                                | Improve light-text contrast and simplify button shadows while retaining the reference layout.                   |
| `src/components/finance-app.tsx`, `src/components/charts.tsx`                       | Stable category colors, complete breakdown labels, accessible chart values and genuine workspace loading state. |
| `src/components/loading-skeleton.tsx`, `src/components/loading-skeleton.module.css` | Reusable placeholders for actual pending requests; no fabricated values.                                        |
| `src/components/orders-page.tsx`, `src/components/refund-editor.tsx`                | Initial loading, truthful totals/counts, refresh continuity, empty/error states and accessible busy state.      |
| `tests/polish-e2e/usability.spec.ts`, `tests/private-e2e/commerce.spec.ts`          | Synthetic coverage for the refined interface, chart accessibility and delayed/failed requests.                  |

## Preservation and privacy

Existing visible wording, routes, authentication, API contracts, state management, financial calculations, date/currency conventions, records, categories and working workflows are preserved. No database schema, new dependency, external service, financial automation or unsupported security claim is introduced. Existing receipt redaction guidance and provider disclosures remain intact.

Verification uses synthetic workspaces only. Real profiles, transactions, uploaded receipts, credentials and owner API keys are not included in this report, public artifacts or test fixtures.

## Validation

All checks below passed using synthetic records. Visual inspection exposed large-total clipping, mobile tooltip overflow and a fixed-height category legend. The corrected interface now keeps exact amounts and the complete legend within their available space.

| Check                                   | Command                                                                                                      | Result                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Production build                        | `npm run build`                                                                                              | Passed                                                                                        |
| Lint                                    | `npm run lint`                                                                                               | Passed                                                                                        |
| Type check                              | `npm run typecheck`                                                                                          | Passed                                                                                        |
| Unit checks                             | `npm run test -- --maxWorkers=1 --no-file-parallelism --testTimeout=15000`                                   | 290 passed across 17 files                                                                    |
| Finance workflows, desktop and mobile   | `npx playwright test --config=playwright.config.ts tests/e2e/finance.spec.ts`                                | 20 passed                                                                                     |
| Synthetic receipt checks                | `npx playwright test --config=playwright.receipt.config.ts`                                                  | 26 passed                                                                                     |
| Isolated private-profile workflow       | `npx playwright test --config=artifacts/playwright.seller-private.config.ts`                                 | 1 passed; ignored local configuration wraps the isolated profile test                         |
| Synthetic Orders/refund checks          | `npx playwright test --config=playwright.commerce.config.ts`                                                 | 15 passed                                                                                     |
| Extended order loading/error/retry case | `npx playwright test --config=playwright.commerce.config.ts --grep "Orders loading never shows fake totals"` | 1 passed, including initial counts, GET errors and retry. This case is already counted above. |
| Interface and accessibility checks      | `npx playwright test --config=playwright.polish.config.ts`                                                   | 11 passed on the final build, including exact amounts and containment at four viewport widths |

All **73 unique browser cases** across these suites passed. The targeted Orders rerun is not counted twice. Coverage includes transaction creation and editing, pending/voided records, transfers, payment allocations, filters, imports, exports, seller/platform separation, receipt safeguards and refunds. Chart checks assert exact daily values, fractional matched refunds, keyboard tooltip values, rendered text bounds and all 13 category rows at 320, 768, 1440 and 1600 pixels. They verify containment inside the tooltip, donut and panel, as well as page overflow.

## Remaining concerns

Owner-approved Terms and a full Privacy Policy have not been supplied. The available Data & privacy settings and provider disclosures are retained without inventing legal terms or broadening data collection. This focused interface pass does not constitute an independent security or regulatory audit.
