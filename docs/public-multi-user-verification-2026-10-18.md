# Public multi-user rollout: audit and verification

Prepared 18 October 2026 from production `main` at `24dc5c8`. Scope: public signup, independent private workspaces, preservation of records/calculations/OTP/branding, RLS verification and a review PR. No hosted authentication setting, production database, real financial record or deployment was changed.

The ZIP contained the earlier owner-only OTP README rather than a Public Multi-User Rollout README. The user's newer public multi-user request takes precedence. Work continued on those explicit requirements after the user requested resumption.

## Audit and changes

| Requirement | Initial status | Change or verified skip | Evidence |
| --- | --- | --- | --- |
| Public signup | MISSING | Explicit server-only `FINANCE_CLOUD_ACCESS_MODE=public`; default owner mode and malformed-value rejection. | Public A/B auth tests and real local signup despite a separate configured operator. |
| Independent workspace | COMPLETE on server; browser NEEDS FIX | **Verified; skipped** auth-derived server ownership/provisioning. New financial collections are empty under each Supabase UUID. Fixed browser lifecycle. | Real independent A/B workspaces and writes; client race tests. |
| Six-digit OTP and branding | COMPLETE | **Verified; skipped** existing token input, Supabase verification, resend, SSR cookies, panda assets and template. Added confirmed-user eligibility and automatic-session signup rejection. | 22 existing browser checks, focused auth/callback tests, actual issued OTP. |
| Login/recovery/callback | NEEDS FIX for public eligibility | Public recovery/resend allowed; fresh confirmed identity required. Generic enumeration responses and existing origin/destination hardening preserved. | Auth/origin tests; real logout/password login/persistence. |
| RLS/views/RPCs/relationships | COMPLETE in migrations; hosted UNVERIFIED | **Verified; skipped** schema changes. No migration needed. Added two-user enforcement tests and read-only hosted inventory. | 109 new DB cases, actual PostgreSQL/PostgREST enforcement/catalog. |
| Workspace/profile API ownership | COMPLETE | **Verified; skipped** existing ownership filters and adapters. Profile reader additionally rejects unexpected foreign rows. | A/B route tests and real app writes/denials. |
| Documents/reviewed imports | NEEDS FIX | Same confirmed-user gate as workspace; document download origin, owner-prefix and safe-path checks before signing. | API tests, foreign document 404s, storage metadata RLS. |
| Browser account switching | NEEDS FIX | Empty initial/cleared state, latest-refresh generation, identity-keyed subtree, stale-operation checks and identity-scoped toasts. | Nine browser cases, including delayed A reads/save completion after B is active. |
| Financial records/calculations | COMPLETE | **Verified; skipped** finance/usage/validation math, row IDs, migrations and decimal semantics. No real records accessed. | Existing domain suite; exact synthetic legacy-operator before/after snapshot. |
| Private local profile | COMPLETE | **Verified; skipped** private auth/persistence handlers. | Actual isolated setup/session/logout/password-login regression. |
| Operator AI | COMPLETE; verified-user consistency fix | Preserve operator-only provider budget/secrets; public users do not inherit AI access. | Unit tests and real public-user AI-settings denial. |
| Hosted activation | UNVERIFIED / pending approval | No public activation, hosted migration, merge or deployment. | Feature-branch deployment disabled; rollout/rollback guide provided. |

## Files

- `src/lib/cloud-owner.ts`, new policy tests, `src/app/api/auth/route.ts` and tests, new callback tests: public/owner/disabled modes, confirmed nonanonymous UUID/email, per-user auth eligibility, confirmation guard and recovery/resend. Existing callback source is unchanged.
- Documents and reviewed-import route sources/tests, `src/lib/cloud-profile.ts`, new workspace/profile route tests: verified-user gates, owned signing and independent API regressions. Correct workspace/profile/import/handoff adapters were not rewritten.
- `src/components/finance-provider.tsx`: latest request wins; auth loss/failure clears records/identity/source IDs; identity changes reset forms/chat/month/status. Delayed operations cannot publish old results/status into another workspace.
- `src/components/workspace-pages.tsx`: three neutral recovery/settings copy changes; branding and OTP layout unchanged.
- `src/lib/ai-owner-auth.ts` and tests: confirmed allowed-user prerequisite, retaining separate operator identity restriction.
- `src/lib/test-fixtures.ts` and tests: configured cloud-access mode blocks legacy synthetic demo activation.
- `tests/db-multi-user-isolation.test.ts`: 109 database security cases using all seven existing migrations.
- `playwright.multi-user.config.ts`, `tests/multi-user-e2e/session-isolation.spec.ts`: nine credentials-free, synthetic browser regressions.
- `.env.example`, `supabase/config.toml`: document rollout switch; **local-only** email confirmation enabled and frequency set to 60 seconds; six digits and 3600-second expiry retained. These files do not apply hosted settings.
- `supabase/audits/public-multi-user-readiness.sql`: read-only hosted schema/policy metadata inventory.
- `vercel.json`: disables automatic deployment for `feat/public-multi-user-workspaces`; main/production trigger unchanged.
- These reports, `docs/public-multi-user-review/`, project context and OTP guide link: evidence and release/rollback instructions.

Core `finance.ts`, `usage.ts`, domain validation, existing migrations, dependencies/lockfile, brand assets and email template are unchanged. No automatic data migration, owner-ID reassignment or demo seeding was added. The retained explicit private-profile import is user-directed into that verified user's own workspace.

## Actual test results

Linux, Node 24.19.0, npm 11.9.0, Next 16.4.0, Playwright 1.64.0. All accounts, financial rows and mail were synthetic.

| Check | Result |
| --- | --- |
| `npm ci --include=optional --no-audit --no-fund` | Passed; 462 packages, frozen lockfile and TLS/integrity checks retained. |
| `npm run lint` | Passed. |
| `npm run build` | Passed, default Turbopack, including final client guards. |
| `npm run typecheck` | Passed. |
| `npm run test -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=120000` | **980 tests passed across 41 files; exit 1** because of two known unhandled receipt-stream errors. No assertion failed; not a clean runner pass. |
| Focused auth/access/callback/origin | 169 passed across four files. |
| Focused workspace/profile/documents/import/handoff/store | 76 passed. |
| All five DB suites | 159 passed, including 109 new two-user cases. |
| Read-only hosted-audit SQL, validated locally | All eight inventory queries executed successfully after all seven migrations in disposable PGlite; metadata-only transaction rolled back. No hosted project queried. |
| `npm run test:e2e -- --config=playwright.multi-user.config.ts --max-failures=3` | Final full run **9 passed**, exit 0. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --config=playwright.signup.config.ts` | **22 passed**, exit 0; OTP errors/resend/leading zeros/authenticated redirect and seven widths. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --config=playwright.private-auth.config.ts` | **1 passed**, exit 0; actual disposable private-store session workflow. |
| Real local Supabase Auth/app HTTP/PostgreSQL/PostgREST | **91 checks passed**, no auth/workspace/persistence mocks. [Results](public-multi-user-review/local-supabase-results.json), [method/versions](public-multi-user-review/isolated-integration-method.md), [actual catalog](public-multi-user-review/local-rls-inventory.json). |

The focused unit rows overlap with the full 980 and must not be added to it. The 32 browser cases are distinct from the 91 real HTTP/database checks. Initial browser failures were ambiguous Profile/route-announcer locators; corrected selectors retained the privacy assertions and the final nine-case run passed.

The full runner's two `ERR_INVALID_STATE: ReadableStream is already closed` errors are the previously documented Node/Undici multipart rejection/cancellation errors in `src/lib/ai-receipt-service.test.ts`. That source was not changed or suppressed. The full suite ran once; final client-only completion guards were subsequently checked by build/typecheck and the focused browser race test. The suite was not rerun simply to revisit the known limitation.

## Isolation and preservation

The SQL suite exercises A→B and B→A across all 28 application tables: reads, updates/deletes, owner changes, forged inserts/upserts, guessed IDs and cross-owner relationships. It covers 22 invoker views, eight RPCs, anonymous/null claims, 38 relationship attacks, atomic import rollback/idempotence, same-hash user separation, bootstrap/merge collisions and storage CRUD/path movement.

Actual local PostgreSQL/Auth separately seeded a synthetic existing operator C, then registered/confirmed A and B through the app and real GoTrue. Both started empty, saved distinct bank accounts/posted expenses/profile names, and reloaded only their own records. Bilateral app/direct REST attacks were denied or affected zero rows; logout A did not sign B out. C's public-table records, revisions, audit rows, profile and storage metadata were exactly unchanged in a deterministic raw PostgreSQL before/after snapshot. This proves isolated-test preservation; it does not claim to inspect the owner's real production records.

## Limits and release

- Hosted settings, installed-policy/migration drift, SMTP and deployed public signup were not inspected or changed. Verified local policies do not establish hosted readiness. Follow the [rollout/rollback guide](public-multi-user-rollout.md), read-only hosted audit and controlled staging checks before activation.
- Real storage metadata RLS was exercised; full Storage object bytes/signed-URL delivery/expiry were not. Signer behavior is covered by API tests; hosted delivery needs staging verification.
- Physical Android/PWA, OS keyboard/safe areas, assistive technology and live AI/email-provider behavior are not newly certified. Existing OTP/branding tests were reused.
- Historical broad browser suites still contain outdated heading/calendar/grid expectations; no blanket pass is claimed for them.
- The real Auth integration used an isolated development server/build directory; final production build and client-only guards were checked separately. Temporary services, credentials, sessions, snapshot and mail were removed; only sanitized evidence remains.

Public activation remains pending owner approval. No production authentication setting, real financial data or deployment was changed.
