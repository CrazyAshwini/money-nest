# Reviewed fixes — 14 October 2026

The owner explicitly requested fixing all findings from the [update report review](project-update-review-2026-10-14.md), starting with origin/callback handling. This follow-up implements those fixes after documentation revision `438434f`; the original review describes the earlier `b69fef4` source.

## Resulting behavior

| Previous finding | Change and verification |
| --- | --- |
| Forwarded protocol could change an auth redirect | Auth destinations are selected from validated app/current-deployment origins. Raw forwarding headers are ignored. A mocked real reset handler keeps its callback on the configured deployment despite the original injected-header input. |
| General origin checks accepted unrelated Vercel origins, wrong ports/schemes, or missing write Origin | One shared policy requires matching actual Host, request URL protocol/port, and supplied Origin. Every write requires Origin; supplied invalid read Origins also fail. Unrelated/stale Vercel tenants and cross-alias requests are denied. |
| Local callback port/alias was lost | Strict raw Host parsing preserves configured localhost, IPv4, and IPv6 browser aliases/ports despite NextURL normalization. Actual mocked callbacks redirect correctly for each. Only unconfigured unrestricted local development has a loopback fallback. |
| AI/orders previews used a different policy | Hosted AI uses the same exact resolver, including the server-provided current `VERCEL_URL`. Preview owner authentication passes with mocked services; unrelated origins are denied before upload/authentication. |
| Legacy cloud upload guards remained | Statement commit and document POST use the same guard before auth/body parsing. Private statement delegation, verified-session checks, import ownership, document signatures/paths, duplicates, and metadata-failure cleanup are retained and tested. |
| Public profile demo entry/session flag remained | Profile demo entry and public enter-demo context API are removed. Normal initialization clears/ignores the flag and fetches authenticated workspace state. Signed-out and authenticated-server regression checks pass. |
| Bottom navigation painted over expense actions | Bar z-index 90 is below existing dialog overlay/content 100/101. At 320px and 390px, Save/Cancel are visibly unobstructed and synthetic saves succeed. |
| More restored the wrong opener's focus; chips lacked selection semantics | More uses a Radix trigger; closing with Escape restores the actual header/bottom opener, with expansion/control semantics and focus trapping. Chips expose `aria-pressed`, support keyboard activation, synchronize with the type filter, and have 44px touch height. |

Callbacks intentionally do not use the API Fetch Metadata gate: legitimate email links may arrive as cross-site top-level navigation. They still validate destination, auth code/token, fresh verified owner, safe next path, and no-store responses. The month input already had a single correct accessible label and hidden decorative icon; no unnecessary group role was added.

## Test isolation and results

A Git archive plus the reviewed working changes was tested in a fresh temporary checkout with a locked `npm ci` install. No real `.env`, private stores, owner credentials, or finance records were copied. Windows used Node 25.2.1, npm 11.6.2, Next 16.4.0, Vitest 4.1.11, and Playwright 1.64.0. Vercel's Node/Linux build remains a separate environment.

| Check | Verified result |
| --- | --- |
| Locked install | Passed, 455 packages |
| Lint | Passed |
| Production build | Passed; initial fixture-helper ProcessEnv typing error corrected before success |
| Typecheck after build | Passed |
| Unit/database suite | **574 passed**, 30 files, zero failed/skipped |
| Public-access regressions | **3 passed**: profile has no public demo entry; signed-out flag/reload cannot bypass sign-in; flag cannot override authenticated server workspace |
| Mobile regressions at 320px/390px | **6 unique checks passed** across the recorded initial/follow-up runs |
| Existing E2E | **36 unique checks passed**, one runtime-fixture preflight plus 35 remaining checks |
| Existing Polish suite | **11 passed**, zero failed/skipped |
| Synthetic private-profile flow | **1 passed**, eight steps: setup/session protection, ownership/origins, edit/reload/retry, income/transfer, sign-out/sign-in, and demo-flag rejection |

Together the browser runs verify **57 unique checks**. The initial nine-regression run had seven passes and two failures from an overly strict new test requiring the old More opener to stay focused after a Next page replacement. Escape opener restoration had already passed. That final navigation assertion was corrected to check the destination heading/URL and closed/collapsed menu; only those two tests were rerun, both passed. The original result file was preserved. No product change was needed for that test correction.

Browser APIs use synthetic fixtures and block external requests. Existing baseline requests pass through a proxy that permits only its isolated local server, including strictly scoped local CONNECT for Playwright APIRequestContext. The private-profile suite uses a validated generated temporary directory and actual local private APIs with synthetic records; it never accesses the owner's store.

Synthetic demo persistence is retained solely behind a server-only `FINANCE_E2E_FIXTURES=1` gate. It requires disabled private persistence, no Supabase/cloud-owner configuration, and no Vercel environment. Normal/default and Vercel operation cannot select it from browser storage. The dynamic app route evaluated the gate for the active isolated server process; one preflight verified fixture mode on the credentials-free production build before the remaining baseline tests ran. Default configs refuse to reuse the owner's running server, and handoff test origins now follow their configured base URL.

## Evidence and limits

Raw results, isolated runner helpers, summaries, and synthetic screenshots are saved in ignored `artifacts/review-fixes/`. The screenshots `expense-sheet-320px.png` and `expense-sheet-390px.png` were visually inspected. The pre-existing generated `next-env.d.ts` modification was preserved byte-for-byte and excluded from the change.

No database migrations, owner profile transfers, real reset/confirmation emails, provider image uploads, or finance data mutations were performed. Callback/provider tests use mocked responses; live Supabase redirect allowlists and owner email/AI-provider flows are not certified by these results. Extra deployment aliases must be explicitly configured rather than inferred from naming patterns; self-hosted reverse proxies with internal NextURL hostnames need separate evaluation.

Release checks should confirm the exact branch/commit, current preview/canonical origins, rejected unrelated/missing write Origins, and unauthenticated API behavior before considering the deployment complete. Protected previews use the existing authenticated Vercel CLI, without weakening deployment protection. Keep [project-context.md](project-context.md) as the starting point for future work.
