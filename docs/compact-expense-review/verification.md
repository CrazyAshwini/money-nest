# Compact transaction entry — audit and verification

Date: 23 October 2026. Baseline: `34a5cede4dbde55b27af067112262efd8d2d4d2e` on `main`. Review branch: `feat/compact-expense-entry`.

The owner approved the compact Add Expense proposal after reviewing the mobile screenshot. This change reuses the existing transaction editor and receipt scanner. It is for pull-request review; production deployment is not authorized by this task.

## Audit and reuse

| Requirement | Initial finding | Implementation |
| --- | --- | --- |
| Existing transaction editor and save pipeline | COMPLETE | Keep one editor, stable IDs, API/provider save path and existing validation. |
| Category-dependent platform suggestions | COMPLETE | Reuse the existing mapping, incompatible-preset reset and preservation of custom/scanned platforms. |
| Large receipt panel above the form | NEEDS IMPROVEMENT | Use a compact Scan receipt header action. Camera, Upload, extraction, multi-receipt queue and review remain in the existing scanner. Other scanner consumers retain their default presentation. |
| Type and date consume separate full rows | NEEDS IMPROVEMENT | Compact type selector and native date control share one row. Unknown receipt dates stay empty. All six existing transaction kinds remain available. |
| Category and Platform stack on phones | NEEDS IMPROVEMENT | Use two aligned controls with full labels in their searchable selection sheets. |
| Account dropdown is a flat active-account list | NEEDS IMPROVEMENT | Search by account label/institution; group Bank, Credit Cards, Pay Later and Wallet; show at most the final four identifier characters. Restrict options to the authenticated owner. Keep an existing archived selection editable. |
| External payer shown immediately for a new expense | NEEDS IMPROVEMENT | Default to Choose account. Someone else paid explicitly reveals the payer field. No account is selected automatically; the UI sentinel is never saved as an account ID. |
| Optional details consume the main flow | NEEDS IMPROVEMENT | Put bank reference, merchant and supported notes under More details. Expense notes can now be deliberately edited; untouched historical notes remain unchanged. |
| Payment, pending and reported-balance confirmations | COMPLETE | Keep them visible when applicable, outside More details. Preserve the existing status and balance-anchor logic. |
| Keyboard selection and nested dismissal | NEEDS IMPROVEMENT | Search, arrow keys, Home/End, Enter/Space, focus indicators and opener restoration. Escape dismisses the focused picker/scanner; a later Escape can close the editor. |
| Save remains reachable while scrolling | NEEDS IMPROVEMENT | Sticky action row inside the scrollable form, with mobile safe-area padding and 44px or larger main actions. |

The old transaction-only CSS block was removed from `globals.css` and replaced by scoped editor styling. Other account/page styling, panda branding and navigation remain intact.

## Financial and privacy boundaries

No production transactions were loaded, edited or deleted during implementation or verification. The earlier user-supplied financial CSV and its private audit are not used as fixtures, screenshots or pull-request content.

The transaction submission path retains amount parsing, source and destination validation, status precedence, receipt fingerprints, new/edit/retry identities, refund links, repayment confirmations and same-day balance anchors. Changes to account/category/platform/date continue through the existing review-reset callbacks. Expense metadata editing is an explicit UI capability; it does not alter monetary formulas.

Byte-for-byte baseline comparisons confirm **103 tracked files unchanged** across `src/lib`, `src/app/api`, `supabase` and `finance-provider.tsx`. This includes canonical financial selectors, authentication, RLS/schema migrations, import/deduplication logic and persistence. Evidence: [financial-source-integrity.json](financial-source-integrity.json).

## Executed checks

| Check | Result |
| --- | --- |
| ESLint | Passed |
| TypeScript | Passed |
| Production build | Passed |
| Focused unit tests | 145 passed across 5 files |
| Baseline browser captures | 3 passed at 320, 390 and 1440px against the unchanged baseline production build |
| Compact editor browser suite | 27 passed; no failures or skips |
| Shared account-editor regression checks | 5 passed; no failures or skips |
| Whitespace/diff check | Passed |

Focused unit files: `category-platforms.test.ts` (4), `receipt-scan.test.ts` (24), `receipt-posting-validation.test.ts` (14), `finance.test.ts` (63) and `usage.test.ts` (40).

Browser verification uses a production build with private profiles, test fixtures, real Supabase/AI credentials and deployment bindings disabled. Routes are mocked with fictional owner-scoped records; all external requests are blocked. Synthetic writes are permitted only in cases that explicitly verify the submitted transaction. Opening pickers/disclosures/scanners is checked for zero writes.

The compact suite covers widths **320, 360, 375, 390, 412, 430, 768, 1024 and 1440px**; grouped/searchable/masked account choices; mixed-owner exclusion; category/platform dependencies and custom values; keyboard selection and focus; explicit external payment; required fields and exact payloads; optional metadata; transfer/refund direction; pending/failed receipt confirmation; receipt type corrections; missing dates; archived/custom/source/notes preservation; and same-day reported-balance confirmation.

The five existing account regression cases verify pencil/editor focus restoration for Bank, Credit Card, Pay Later and Wallet, plus keyboard transaction entry at 320px. Final structured counts: [test-results.json](test-results.json).

## Visual evidence and limits

See [screenshots](screenshots/README.md) for before/after desktop and mobile captures made with fictional records. The approved user screenshot is a design input, not a public test fixture.

Real Supabase writes, hosted AI extraction and physical phone/PWA keyboard behavior were not exercised. Chromium responsive testing does not certify every operating-system date picker or software keyboard. No schema migration, financial-data correction, authentication-setting change, merge or production deployment is included.

## Changed files

- `src/components/editors.tsx`: compact composition, grouped picker options, explicit external payer and optional metadata.
- `src/components/transaction-picker.tsx` and `.css`: shared searchable selection sheet with keyboard/focus support.
- `src/components/transaction-editor.css` and `src/app/globals.css`: scoped replacement for the old transaction styling.
- `src/components/receipt-scanner.tsx` and `.css`: optional compact entry action, busy-state disabling and opener focus restoration.
- `src/components/ui.tsx`: optional modal header actions and focused-dialog Escape handling.
- `playwright.compact-expense.config.ts` and `tests/compact-expense-e2e/*`: isolated synthetic browser verification and captures.
- `docs/compact-expense-review/*` and `docs/project-context.md`: audit, validation and synthetic review evidence.
