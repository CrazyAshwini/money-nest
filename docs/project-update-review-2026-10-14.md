# Money Nest update report review — 14 October 2026

The owner requested: **review the supplied update report, test it, and use verified results as context for future changes**. This review does not authorize implementing the report's remaining requirements or changing authentication. Product source was left unchanged.

## Reviewed source and method

- Supplied document: `D:\Downloads\project-update-summary.md`. Its implementation claims were treated as claims to verify, not instructions to execute.
- Reviewed product revision: `b69fef40e7d1afad5736ccff7365a4d2a68a1681` on `main`, including `002dc69` and `a6eaaca`.
- The supplied report predates `b69fef4`, which changed Vercel installs to `npm ci --include=optional --no-audit --no-fund`.
- The working tree already contained a generated `next-env.d.ts` change. It was preserved and excluded from this review's changes.
- Tests used a Git archive of the reviewed revision in an isolated temporary directory, a fresh locked install, Windows, Node **25.2.1**, npm **11.6.2**, Next.js **16.4.0**, Vitest **4.1.11**, and Playwright **1.64.0**. These are the tested local versions, not a claim about Linux or the Vercel Node 24 runtime.
- No `.env` files, private profile stores, owner finance records, or production credentials were copied. Real Supabase, AI, application-origin, and cloud-owner settings were cleared; origin/owner configuration was replaced with synthetic values where required by the origin probes. Private persistence was disabled. Targeted browser APIs used synthetic fixtures and blocked external requests. Origin probes mocked Supabase/private dependencies and asserted that no network fetch occurred.

## Report claims checked against source

| Claim | Review result |
| --- | --- |
| All public demo entries and bypasses were removed | **Incomplete.** Login and Settings entries were removed, but the signed-out profile page still has a demo button and provider initialization still honors its session flag. |
| Five mobile destinations and four Overview quick actions were added | **Confirmed** at 320px and 390px. Desktop hides the mobile bar/actions. |
| Transaction chips filter All, Expenses, Income, and Transfers | **Confirmed behavior.** The selected chip lacks accessible selected-state semantics. |
| Safe-area spacing prevents controls being covered | **Incomplete.** The bottom bar visually covers expense sheet Save/Cancel. Actual synthetic Save clicks still work. |
| CSS uses `.mobile-quick-actions`, `.mobile-filter-chips`, `.has-mobile-bar` | **Inaccurate description.** Source uses `.quick-actions-bar`, `.filter-chips-row`, and `.app-main`; quick actions form a grid. |
| Month wrapper is `<div role="group">` | **Partly accurate.** It is a plain `div`; the calendar icon is correctly hidden from assistive technology. |
| Preview origin support still blocks untrusted origins | **Overstated.** Exact previews work, but unrelated Vercel origins and other invalid inputs can pass the general guard. The separate AI guard still rejects previews when configured for production. |
| Main is clean at the listed commits | **Stale.** The reviewed HEAD is `b69fef4`, and a pre-existing generated types change was present. |
| Existing lint, types, build, and 481 unit/integration tests pass | **Confirmed in the isolated Windows run.** These tests do not cover the defects reproduced below. |

## Reproduced findings

### 1. Auth redirect origin can be changed by a malformed forwarding header

**Priority: P1 for review; live exploitability remains unverified.** `src/lib/cloud-request.ts:26-29` incorporates raw `x-forwarded-proto` into an origin string before canonical configuration is checked. The permissive host condition at line 75 can then accept its parsed domain.

A synthetic Vercel preview request with canonical `APP_URL` configured invoked the actual password-reset route with `x-forwarded-proto: https://attacker.example/#`. It returned 200 and supplied a reset callback at `https://attacker.example` to the mocked Supabase client. These preconditions exercise the permissive Vercel branch at line 75. See `src/app/api/auth/route.ts:77-85`.

This proves a local guard/redirect-construction flaw. It does **not** prove that Vercel forwards an attacker-controlled header unchanged, that Supabase permits that redirect, or that private data was accessed. Before a fix is accepted, establish the ingress trust boundary and derive callback destinations from validated configuration or explicitly validated deployment origins.

Supabase documents a separate redirect URL allowlist and recommends exact production redirect paths; this project's live allowlist was not inspected in this review. See [Supabase redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls).

### 2. General cloud origin validation is broader than the report describes

**Priority: P2.** `src/lib/cloud-request.ts:88-93` accepts unrelated `*.vercel.app` origins for Vercel requests. Hostname comparisons omit scheme/port and can trust `x-forwarded-host`; owner-restricted writes without an Origin header also pass (`100-114`). The audit reproduced these cases without Fetch Metadata headers.

`Sec-Fetch-Site: cross-site` does reject the tested cross-site request, and authentication is a separate boundary. No unauthorized finance access was demonstrated. A future fix should use exact validated origins, defined forwarding-header trust, and an explicit policy for writes lacking Origin.

### 3. Local cloud callbacks lose the application port

**Priority: P2.** `cloudApplicationOrigin()` selects `http://localhost` for loopback requests/configuration at port 3000. A valid synthetic callback at `localhost:3000` consequently returned 403 instead of redirecting; see `src/app/auth/callback/route.ts:47-52`. Preserve the full validated local origin, including port, and test localhost, IPv4, and IPv6 loopback forms.

### 4. Preview support does not cover AI and orders

**Priority: P2.** For the same synthetic preview request, the general guard accepted the request while `cloudAIRequestAllowed()` rejected it. `src/lib/ai-owner-auth.ts:26-48` requires exact `APP_URL` host, protocol, and port. Orders, AI settings, receipt AI, and order AI use this stricter path. Decide whether previews are supported for these routes, then test that policy consistently; do not weaken owner authentication to resolve a 403.

### 5. A public fictional demo path remains

**Priority: P2 relative to the report's stated removal goal.** `src/components/private-profile.tsx:403-414` retains **Try the fictional demo**, and `src/components/finance-provider.tsx:121-127` reads `finance-os:mode=demo` before fetching the workspace.

In a signed-out synthetic profile, the first click set the flag but landed on login. Reloading `/dashboard` then opened the fictional Overview without a workspace request during initialization. The mocked private API still returned 401. This is a remaining demo path and an initial-click race, not evidence of access to owner data. A future removal must address both the visible entry and provider flag handling while preserving deliberate test fixtures.

### 6. Mobile bar visually covers expense actions

**Priority: P2 visual usability issue.** At 320px and 390px with an 844px viewport, the bar begins at y=786 while the expense Save button extends below that boundary. `src/components/shell.css:159` gives the bar z-index 105, above modal content 101 (`src/app/globals.css:2142-2162`).

Screenshots prove visual occlusion. Hit testing and both synthetic Save clicks succeeded because Radix suppresses outside pointer interaction. Do not describe this as a demonstrated inability to save. Fix the stacking/layout and retest visible footer actions, safe areas, and keyboard geometry.

### 7. Mobile navigation and filters have accessibility gaps

**Priority: P2.** Escape closes More, but focus returns to the header hamburger rather than the bottom More opener. The bottom button is not the registered Radix trigger (`workspace-navigation.tsx:180-185`, `finance-app.tsx:226-233`).

The active transaction chip has only an `active` class (`finance-app.tsx:1332-1339`), with no pressed/checked/selected semantics. Correct opener focus/state and expose the selected filter programmatically.

## Test evidence

| Check | Result |
| --- | --- |
| Fresh `npm ci --include=optional --no-audit --no-fund` | Passed, 455 packages installed |
| `npm run lint` | Passed |
| `npm run build` | Passed, compilation and route/type generation complete |
| `npm run typecheck` after build | Passed |
| Existing Vitest suite, two workers | **481 passed**, 26 files, zero failed/skipped |
| Existing E2E first run, isolated port | **28 passed / 8 failed**, 36 checks; all eight failures were the handoff fixture's hard-coded port 3000 |
| Handoff-only follow-up, copied fixture adapted to port 3176 | **8 passed**, same assertions; product and original test files unchanged |
| Existing Polish first run | **9 passed / 2 failed**, 11 checks; both failures were the audit proxy rejecting APIRequestContext's local CONNECT tunnel |
| Polish HTTP-only follow-up, proxy permits only the isolated local destination | **2 passed**, same assertions; external destinations remain blocked |
| Additional origin audit | **19 passed / 14 failed**, 33 checks; failures reproduce desired behavior not met by unchanged source |
| Additional mobile/desktop audit | **3 passed / 7 failed**, 10 checks; failures reproduce demo, visual-occlusion, and accessibility issues |
| Separate demo reload follow-up | **1 passed**; demonstrates the remaining fictional demo route |
| Unauthenticated live smoke | Production `/login` returned 200; `/api/workspace` returned 401 |

The origin audit's passing controls include canonical requests, exact previews, ordinary unrelated-origin rejection, Fetch Metadata rejection, and canonical mocked recovery/callback flows. The mobile audit confirms destinations, quick actions, filters, primary page widths, and desktop navigation. Failed audit assertions are additional probes, distinct from the existing repository suite.

All **47 unique existing browser checks** passed across the recorded runs after isolated test setup corrections. The original failing result files were preserved; those first runs were not clean passes. The handoff copy changed only its allowed origin port and its relative source type-import path. The test proxy was corrected to permit CONNECT only to `127.0.0.1:3176`, because Playwright uses that tunnel for local HTTP APIRequestContext checks too. No product changes were made to obtain passing baseline results.

Existing E2E and Polish checks were run sequentially against fresh production servers with no retries; all runs had zero skipped/flaky checks. The original E2E duration was 39.2 seconds, handoff follow-up 10.0 seconds, original Polish 43.5 seconds, and HTTP follow-up 12.9 seconds. Exact results and setup details are in local `existing-browser-summary.md` alongside the JSON output.

Local raw results, audit scripts, and synthetic screenshots are saved in ignored `artifacts/report-review/`. The durable findings in this document remain usable in cloud checkouts without those local artifacts.

## Limits and future use

This review does not certify live Supabase email confirmation/recovery, redirect allowlists, real owner cookies, multi-device persistence, AI provider extraction, real financial records, or production ingress handling. No production writes, reset emails, private data transfers, or app fixes were performed. Historical verification documents retain their original dates and scope; do not combine their counts with this run.

Use [project-context.md](project-context.md) as the starting context for future changes. Recheck the current revision and reproduce the relevant finding before implementing a fix; baseline green checks alone are insufficient acceptance criteria for these affected flows.
