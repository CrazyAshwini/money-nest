# Picker search on request

23 October 2026. Baseline: `a47ec745fcf51e8051a15f4c55df200970db9bbd` (released PR #12). Review branch: `fix/picker-search-on-demand`.

The released transaction pickers opened and focused search immediately. The owner requested that search open only after tapping its icon. The existing shared picker is retained, with its option list and current selection shown first.

## Behavior

- Category, Platform and Paid from show their options without mounting a search input. Initial focus goes to the selected option, or the first option when there is no selection.
- The magnifying-glass button reveals and focuses search on explicit click or keyboard activation.
- Closing search clears the query, restores every option and returns focus to the search button.
- Selecting an option or closing the picker resets search. Escape closes the picker while preserving the transaction editor and restoring its opening control.
- Transaction type keeps direct option selection without a search control. Existing account grouping, masking and category/platform rules remain intact.

The change is confined to the shared picker component and its styles. The editor, provider, financial selectors, API routes, authentication, database schema and saved records are unchanged. Tests use fictional records and mocked authenticated responses; the private financial export is not used.

## Verification

| Check | Result |
| --- | --- |
| Compact editor Playwright suite | 34 passed; zero failed, skipped or flaky cases |
| ESLint | Passed |
| TypeScript | Passed |
| Production build | Passed |
| Financial/editor source scope comparison | No changes to `src/lib`, `src/app/api`, `supabase`, `finance-provider.tsx` or `editors.tsx` |
| Whitespace check | Passed |

The browser suite adapts 27 existing cases and adds seven cases. It checks collapsed search and initial option focus, explicit click/keyboard opening, query clearing, selection and close/reopen resets, Escape isolation, focus restoration, grouped/masked account choices, saved payloads, receipt review and pending/balance confirmations. Responsive editor checks cover 320, 360, 375, 390, 412, 430, 768, 1024 and 1440px. The new search behavior is tested for all three searchable pickers at 320 and 1440px. See [structured browser results](test-results.json).

An earlier browser attempt overlapped a production rebuild and encountered invalid served assets. It is excluded from the reported result. The final 34-case run completed against the stable build with no concurrent build or source edits. The broader unit suite from PR #12 was not rerun for this picker-only correction.

## Review images

All images contain fictional test records. Mobile captures are 320px wide; desktop captures are 1440px wide.

| Picker | Options first | Search after explicit activation |
| --- | --- | --- |
| Mobile account | [Collapsed](screenshots/320px/paid-from-collapsed.png) | [Expanded](screenshots/320px/paid-from-expanded.png) |
| Desktop category | [Collapsed](screenshots/1440px/category-collapsed.png) | [Expanded](screenshots/1440px/category-expanded.png) |

Physical phone/PWA keyboard behavior and real Supabase writes were not exercised. Production deployment is not included in this correction.
