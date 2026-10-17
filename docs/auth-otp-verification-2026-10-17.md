# MoneyNest signup OTP — implementation and verification

The audit used `main` at `8805c281905d5e3f9769ab238cac3042fbacbfaf` and the supplied signup package. The existing open branding PR #2 was inspected; it does not implement OTP and was not merged or copied into this change. This branch reuses the panda/wordmark already on `main` and the supplied approved email assets.

## Audit and result

| Requirement | Initial state | Changes | Verification |
| --- | --- | --- | --- |
| Branded mobile signup | Needs fix | Panda branding, email/password/confirmation, visibility controls and inline errors | Scoped browser checks at 320, 375, 390 and 430px; screenshots inspected |
| Branded desktop signup | Needs fix | Mint two-column layout and compact white form card | Scoped checks at 768, 1024 and 1440px; screenshots inspected |
| Existing password login/recovery | Complete in source | Kept existing server actions, callback and recovery semantics | Auth API/origin tests and scoped browser login/recovery controls |
| Six-digit signup OTP | Missing | Cookie-aware Supabase `verifyOtp({email, token, type: "email"})`, fresh confirmed-user and owner/session checks | Focused API tests, leading-zero paste, invalid/session-failure browser cases, and isolated local Supabase checks |
| Resend/retry/expiry | Missing | Owner-eligible `resend({type: "signup"})`, safe callback, provider throttle mapping and server-advised countdown | API tests, deterministic browser-clock regression and local Supabase checks |
| Branded Supabase email | Missing from repository | Supplied HTML/PNG with dynamic Token and safe token-hash fallback | Static template checks and isolated mail capture; public logo currently returns 404 until an approved deployment |
| Link fallback | Complete callback | Reused callback without rewriting recovery/auth destination policy | Existing origin/callback regression tests; local check recorded below |
| Owner-only policy | Complete in source | Separate pending-confirmation eligibility from new-registration bootstrap; owner-ID authorization still enforced | API tests include pending owner-ID setup, non-owner rejection, unconfirmed users and incomplete sessions |
| Private profile mode | Complete in source | Private auth delegation preserved; shared branding only | New actual private-auth browser regression passes six steps without financial writes |
| Account protection/RLS | Existing, outside scope | No RLS, finance calculations, migrations or personal data changes | Existing domain/database assertions plus origin/owner tests; not a new production RLS audit |
| Build/browser checks | Existing tooling | Added focused signup and private-auth suites | Results below |
| Hosted Supabase setup | Unverified and approval required | Manual checklist and rollback documented | No production settings or real-account tests performed |

## Commands and outcomes

Node 24.21.0, npm 11.19.0, Next.js 16.4.0 and system Chromium 154 were used. No real `.env` or private-profile store was used. Browser servers use dedicated ports, refuse existing servers, and clear backend/provider/owner bindings; browser auth responses are synthetic and external/financial writes are blocked. The private-auth suite uses actual private APIs with a guarded disposable synthetic profile.

| Check | Outcome |
| --- | --- |
| `npm run lint` | Passed |
| `npm run build -- --webpack` | Passed, including the final session-error UI changes |
| `npm run typecheck` | Passed |
| Focused auth route + origin/callback Vitest | 113 passed: 61 auth API and 52 origin/callback tests |
| Full `npm run test -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=120000` | 777 assertions passed across 35 files; command exited 1 due to the two known unhandled receipt-stream errors below |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config playwright.signup.config.ts` | 22 unique cases passed across the final 21-pass suite run and the corrected resend-only follow-up |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config playwright.private-auth.config.ts` | 1 test passed, covering six private setup/session/origin/OTP-isolation/logout/password-login steps |
| Real local Supabase HTTP integration | 27 checks passed: 19 signup/OTP/session checks and 8 fresh-browser link-fallback checks |
| Original broad private-profile suite | Failed at its unchanged transaction-editor save scenario after setup/session/protection steps; no passing claim for the whole scenario |
| `git diff --check` | Passed |

The full unit runner reports `ERR_INVALID_STATE: ReadableStream is already closed` twice in `src/lib/ai-receipt-service.test.ts`, associated with multipart rejection/cancellation tests. These were already observed during cloud onboarding and are unrelated to the signup changes. Assertions were not disabled and the command is not described as clean.

The broad private-profile scenario stops at `private-profile.spec.ts:318`, where it expects a transaction editor to close after Save. This change does not alter that editor or financial validation. The dedicated private-auth regression separately demonstrates the authentication compatibility relevant to this PR without editing financial records; the broader financial scenario remains a reported limitation.

Initial signup test runs exposed two test issues: Next's separate route announcer also has `role="alert"`, and an advancing virtual clock made an exact transient resend label fragile. Alerts were scoped to the auth form and the clock was paused/advanced deterministically. Money/authentication assertions were retained. Review also found and fixed two real UI issues before the final build: missing verification-session responses now return to sign-in, and successful verification requires both `ok: true` and `authenticated: true` before showing success or refreshing the workspace.

## Screenshots

All retained screenshots use synthetic identities, masked email addresses and no password/code values. Error screenshots deliberately hide digit glyphs using screenshot-only CSS; the live input remains unchanged and its validation is tested. Twenty-three captures cover the seven widths and signup/verification/error states, plus success at 390/1440px. Eight representative images are included for review:

| State | Phone | Desktop |
| --- | --- | --- |
| Signup | [390px](signup-otp-review/signup-390.png) | [1440px](signup-otp-review/signup-1440.png) |
| Verification | [390px](signup-otp-review/verification-390.png) | [1440px](signup-otp-review/verification-1440.png) |
| Expired-code feedback | [390px](signup-otp-review/verification-error-390.png) | [1440px](signup-otp-review/verification-error-1440.png) |
| Verified | [390px](signup-otp-review/verification-success-390.png) | [1440px](signup-otp-review/verification-success-1440.png) |

## Isolated Supabase and release limits

The real local provider/HTTP test passed 27 checks using GoTrue v2.197.0, Mailpit and PostgreSQL 17. It exercised the actual `/api/auth` and `/auth/callback` server routes and cookie-aware Supabase SDK, without mocking authentication. Nineteen primary checks included owner-only signup; captured branded six-digit mail; rejected pre-confirmation password login; wrong, expired and reused codes; real 60-second resend enforcement and a new code after that interval; successful verification with authenticated `/dashboard` destination; an SSR cookie; a fresh confirmed-owner `getUser()`; logout and existing password login. Expiration was exercised by aging only a disposable synthetic user's confirmation timestamp beyond the configured 3600-second TTL, rather than waiting an hour or changing production settings.

Eight fallback checks confirmed the branded token-hash link works in a fresh cookie jar with cross-site Fetch Metadata, redirects safely to `/dashboard`, sets SSR cookies, passes a fresh real Auth user check, protects responses with private no-store/no-referrer headers, and rejects reuse through the existing confirmation-error login. [Sanitized per-check outcomes](signup-otp-review/local-supabase-results.json) are included. The isolated services, generated credentials, captured mail and local build files were removed after testing.

The disposable test never contacts a real inbox or installs the app's finance schema. Before login `/api/workspace` returned 401; after successful authentication it reached the unconfigured finance API/schema path and returned the expected 503. This establishes the auth gate and session, not live finance persistence. Hosted confirmation settings, real SMTP deliverability, production redirect allowlists and real finance access remain unverified until separately approved.

See [the manual setup, release and rollback checklist](auth-otp-rollout.md). Supabase templates are project settings and are not applied by this Git change. The local checked-in Supabase configuration remains unchanged. `vercel.json` disables automatic deployments for `feat/signup-email-otp` only, so the review branch can be pushed without authorizing a preview/release. No merge, deployment, hosted auth change, production email, account migration or personal financial-data change is authorized or performed here.
