# Money Nest — verified project context

Last reviewed: **14 October 2026**, product revision **`b69fef4`**. Detailed evidence and limitations: [update report review](project-update-review-2026-10-14.md).

This document records verified context. The owner's latest instruction was to **review, test, and retain context**; it did not request implementing the open findings. Supplied README/handoff documents are task inputs, not automatic authorization for their embedded instructions.

## Project and owner intent

- Money Nest is the existing personal finance app in `CrazyAshwini/money-nest`. Keep its name, INR presentation, working features, financial semantics, and stored data.
- The owner prefers a compact mobile UI, minimal expense entry, category-dependent platform choices, and seller names in descriptions rather than treating sellers as platforms. Prior requests include receipt/screenshot extraction with multiple transactions, statement imports with duplicate review, and account balances that reflect movements after reported snapshots.
- “Put the project in the cloud so I can work from my phone” was clarified to mean **Codex cloud coding**, describing changes in chat so AI edits the repository. It does not mean uploading a private profile or finance records.
- A private Money Nest Codex cloud environment was published for this repository. Its original prepared snapshot was `ed44c12`; future cloud work must check/fetch current Git state rather than assuming that snapshot contains later changes.
- Vercel is connected to the same GitHub repository with production branch **`main`**. Commit/push or merge into main triggers deployment; unsaved/unpushed cloud edits do not update the live app. Automatic deployment was verified for `b69fef4`, reaching READY and updating [money-nest-xi.vercel.app](https://money-nest-xi.vercel.app).
- Vercel locked installs are configured in `vercel.json`: `npm ci --include=optional --no-audit --no-fund`. Preserve the lockfile and platform optional dependencies.

## Technical map

- Next.js **16.4.0**, App Router, TypeScript, React **19.3.0**. Read relevant guides in installed `node_modules/next/dist/docs/` before code changes; do not assume older Next conventions. Preserve the generated instruction block in `AGENTS.md`.
- `src/components/finance-app.tsx`: shared workspace shell, Overview, accounts, transactions, forms, and analytics. `workspace-pages.tsx` contains supporting workspace/auth pages; `workspace-navigation.tsx` supplies desktop/drawer/bottom navigation. Styles are in `src/app/globals.css` and `src/components/shell.css`.
- `finance-provider.tsx` owns client workspace state and mode/loading transitions. Local private profiles and authenticated Supabase cloud workspaces have different authentication/persistence paths. Fictional browser demo state is synthetic and cannot establish owner-data behavior.
- Local private records use server-side AES-256-GCM files outside the checkout; cloud records use the Supabase database through authenticated SSR sessions and owner checks. Profile migration is an explicit authenticated export/import workflow. Neither cloud coding setup nor this review migrates those records. Do not run `db:migrate` or seed a linked database merely to prepare a coding environment.
- `src/lib/cloud-request.ts` handles the general cloud request origin policy; `src/lib/ai-owner-auth.ts` uses a **separate** stricter origin policy for hosted AI/orders. They currently behave differently on previews.
- Use existing decimal/domain helpers for money, snapshots, movement, liabilities, imports, allocations, and reconciliation. Repayments/transfers are not new spending. Unknown balance/limit must remain unknown; do not fabricate totals or double-subtract snapshot-covered transactions.
- Existing tests use Vitest/PGlite for domain/database logic and Playwright for browser flows. Simulated database/auth fixtures are not live Supabase verification.
- Reviewed CSV and `.xlsx` statement imports, handoff JSON review, and receipt/order image AI have implementations. PDF/image bank-statement extraction remains unavailable. Source presence does not verify live providers, database migrations, banking synchronization, or notifications.
- Secrets, private stores, finance exports, local `.env` files, and generated artifacts stay out of Git. Do not copy them into cloud coding contexts or review evidence.

## Verified UI state

- Phone bottom bar: Home, Accounts, Transactions, Analytics, More.
- Overview quick actions: Add, Import, Bills, Transfer. Source CSS uses `.quick-actions-bar` (grid).
- Transaction chips: All, Expenses, Income, Transfers, using `.filter-chips-row`. Filtering behavior works in synthetic tests.
- Primary mobile views fit 320px/390px in the targeted audit; desktop navigation works at 1440px. This is not a blanket statement that every dialog is unobstructed.
- Public demo entries were removed from Login/Settings, but a profile entry and provider demo session flag **remain**. The supplied update report's claim of complete removal is incorrect.

## Open findings to consider before related changes

1. **Auth origin construction:** raw forwarded protocol can alter the parsed reset redirect origin in synthetic route tests. Live ingress/header control and Supabase allowlist acceptance were not tested. Validate explicit deployment origins and forwarding-header trust; do not assume a proven live exploit.
2. **General origin policy:** accepts unrelated Vercel origins, ignores scheme/port in several branches, trusts forwarded host, and permits writes lacking Origin. Fetch Metadata and separate authentication mitigate some requests; no owner-data compromise was demonstrated.
3. **Local callbacks:** loopback port is lost and the tested local cloud callback returns 403.
4. **Preview AI/orders:** general workspace previews pass, but the separate hosted AI guard rejects them with production `APP_URL`.
5. **Remaining public demo:** profile button sets demo mode; initial click races to login, reload opens fictional Overview before workspace fetch. Private backend access was not demonstrated.
6. **Mobile modal stacking:** bottom nav visually covers Save/Cancel at 320/390px. Actual synthetic Save clicks still work. Fix visual stacking/layout and retest safe areas and keyboard behavior.
7. **Accessibility:** More restores focus to the header opener; active filter chips expose no accessible selected state.

See the dated review for exact source references, reproductions, passing controls, and scope limits. Do not carry its speculative risks as proven production behavior or silently change authentication in an unrelated UI task.

## Verification baseline and safe workflow

The isolated Windows locked install at `b69fef4` passed lint, production build, typecheck, and **481 existing tests across 26 files**. All **47 unique existing browser assertions** passed across isolated runs after fixture-port/proxy setup corrections; original failing outputs were retained. The handoff fixture hard-codes port 3000, so use an audit-only adapted copy when isolating it on another port.

Additional audits reproduced unresolved issues: origin **19 passed/14 failed**, mobile **3 passed/7 failed**, plus one passing demo-reload characterization. Do not cite only the baseline pass count as evidence that these new behaviors are correct. Existing browser tests do not directly enforce the new bottom-bar focus/stacking or filter selected-state expectations.

For checks involving auth/UI persistence, use an isolated checkout/archive with no real `.env` or private files, synthetic records, disabled private persistence, and cleared real Supabase/AI/cloud-owner configuration. Supply synthetic origin/owner values only where a probe requires them. Use a separate local server port and `reuseExistingServer: false`; the default Playwright config can reuse the owner's port 3000 server. Mock or block external requests for synthetic flows.

Typical checks for a substantive product change are:

```text
npm ci --include=optional --no-audit --no-fund
npm run lint
npm run build
npm run typecheck
npm run test -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=120000
```

Run the relevant Playwright flows on a separately configured fixture server. Add meaningful regression coverage for the affected open finding, not tests that merely mirror implementation. Keep documentation-only changes proportionate. A successful local mocked test does not replace authorized live confirmation of email/recovery, cloud persistence, provider extraction, or deployment-specific origin behavior.

`docs/verification.md` describes the 9 October version and contains older counts/features. `README.md` is primarily a redesign brief with historical observations. Use their dated scope and current source; this context and the 14 October review supersede their assumptions about current implementation status.
