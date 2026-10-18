# MoneyNest email OTP signup: review and manual rollout

For the separately reviewed public rollout, use [public-multi-user-rollout.md](public-multi-user-rollout.md). Its explicit server mode supersedes this historical owner-only eligibility guidance only after approval; existing OTP/template/callback requirements remain. Retain operator bindings for operator-only AI. The follow-up PR does not apply hosted settings or deploy.

This change adds six-digit Supabase email confirmation to the existing owner-only email/password signup. It does not authorize public registration, deployment, hosted authentication changes, database migrations, account recreation, or changes to financial/private-profile data. The owner must approve production settings and deployment separately.

## Initial audit

The implementation started from the latest repository checkout and the supplied `MoneyNest_Codex_OTP_Signup_Complete_README.md`, not the old onboarding snapshot. The initial source audit found:

| Requirement | Initial state | Action / verification boundary |
| --- | --- | --- |
| Existing email/password sign-in, logout and recovery | Complete in source | Preserve `/api/auth` actions and safe recovery callback; run regressions. |
| Owner-only registration and workspace access | Complete in source | Preserve `FINANCE_CLOUD_OWNER_EMAIL` bootstrap and owner-ID restrictions. OTP must never widen access. |
| Cookie-aware Supabase SSR and origin protections | Complete in source | Reuse the existing server client, fresh `getUser()`, exact application origin and private no-store responses. |
| Email-link confirmation callback | Complete in source | Existing `/auth/callback` handles code and token-hash verification, safe destinations and owner checks. Preserve recovery and callback behavior. |
| Signup page | Needs fix | Existing basic form/message did not provide confirm-password validation or the requested OTP state. |
| Six-digit verification and resend | Missing | Add server-side Supabase `verifyOtp` / `resend` actions and usable form states. A mocked provider test does not establish real mail delivery. |
| Branded OTP email and PNG | Missing from repository | Add the supplied approved design and logo, keeping `{{ .Token }}` dynamic and avoiding a fixed expiration promise. |
| Private profile access | Complete in source | Keep its password authentication path separate from cloud OTP. |
| RLS and finance/account semantics | Existing, outside this change | No migrations, finance writes, RLS edits or changes to balances/cards/transactions. Regression tests are not an independent production RLS audit. |
| Hosted Supabase email settings, SMTP and actual delivery | Unverified | Dashboard settings are separate from this repository; review and test only with explicit authorization. |

Final command results, browser evidence and remaining limits are in the [implementation verification report](auth-otp-verification-2026-10-17.md) and pull request. Do not infer hosted readiness from this table or from source presence.

## Maintained email assets

- HTML: [`supabase/templates/confirmation-otp.html`](../supabase/templates/confirmation-otp.html)
- Subject: **Your MoneyNest verification code**
- Logo: [`public/brand/moneynest-email-logo.png`](../public/brand/moneynest-email-logo.png), the supplied 960 × 339 PNG. The existing panda SVG remains available to existing UI.
- Email logo URL: `https://money-nest-xi.vercel.app/brand/moneynest-email-logo.png`

The supplied panda/green Money NEST design, mobile email styles and security footer are retained. `{{ .Token }}` is the real provider-issued code; do not replace it with a preview value. The email deliberately says the code expires soon instead of promising a duration that could disagree with Supabase settings.

The secondary link uses:

```text
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
```

The HTML correctly escapes `&` as `&amp;`. This explicit Supabase token-hash pattern goes directly through the existing cookie-aware SSR callback, which verifies the token, fetches the authenticated user and enforces the current owner policy before redirecting. It avoids depending on the default `{{ .ConfirmationURL }}` implicit/PKCE redirect behavior across browsers or devices, which was not established for this app. It does not change the existing code-based callback path or recovery template.

`SiteURL` must be the exact approved app origin **without a trailing slash or extra path**. The template intentionally sends fallback links to that canonical origin; it does not honor an arbitrary `RedirectTo` or browser-supplied host. Thus a preview using the production template would send the fallback to production. Use a separate test project/template and matching local Site URL for local or preview mail tests. OTP entry uses the originating app's server session instead.

Token hashes in email links are credentials. Do not paste real rendered links into PRs, screenshots, logs or analytics. Link scanners can consume single-use confirmation links; OTP entry is the primary path. The isolated local check verifies OTP cookies and the fallback in a fresh browser cookie jar; the intended hosted environment still requires separately approved same-device and cross-device checks before release.

After network access was granted, a read-only anonymous HTTPS GET to the logo URL returned **HTTP 404** (`text/html`), so it is **not yet publicly available**. The PNG is included in this PR and requires an approved deployment. After that deployment, verify an anonymous HTTPS GET returns HTTP 200 with `image/png`, a valid image, no authentication requirement and no redirect to sign-in. Do not apply the production email template until its logo URL is reachable.

## Hosted Supabase: owner-approved manual checklist

Record the current settings and current **Confirm sign up** subject/body securely before editing. Do not copy secrets, rendered tokens or customer records into Git. Local `supabase/config.toml` is not proof of hosted settings and is intentionally unchanged by this implementation.

1. Select the intended Supabase project. In **Authentication → Providers → Email** (or the dashboard's current equivalent), verify **Confirm email** is enabled. Do not toggle it in production as part of a code review. If confirmation is disabled, signup can produce an immediate session; that environment is not a verified OTP-confirmation environment.
2. Verify email OTP length is **6**. The app accepts six digits as a string, preserving leading zeros. Select and record an explicit expiration; the checked-in local baseline is **3600 seconds**. Expiry in email copy must continue to match actual configuration or remain generic.
3. Review **Authentication → Rate Limits** and the minimum email resend interval. Record effective signup/email-send and OTP-verification limits. Retain provider protections and choose an approved resend interval; **60 seconds** is a reasonable test value. UI cooldown alone is not a security boundary. Check actual provider throttling responses and the app's retry timing in a safe test project.
4. In **Authentication → Email Templates → Confirm sign up**, set subject **Your MoneyNest verification code** and paste the complete maintained HTML above. Do not replace password recovery, email-change, invitation or other templates. Template changes are project configuration and are **not** applied by GitHub/Vercel deployment.
5. In **Authentication → URL Configuration**, set **Site URL** to `https://money-nest-xi.vercel.app` for the approved production project. Retain exact required callback URLs, including `https://money-nest-xi.vercel.app/auth/callback` and the existing recovery callback `https://money-nest-xi.vercel.app/auth/callback?next=/reset-password`. Configure only intentional test origins and paths for a separate test environment; do not use broad preview wildcards. Keep server `APP_URL` consistent with the selected app origin.
6. Configure an authorized SMTP provider and verified sender/domain only if approved. Use sender name **MoneyNest** with an address the provider permits. Verify SPF/DKIM/DMARC and delivery/spam behavior. HTML cannot change the authenticated sender identity. Supabase default SMTP has delivery restrictions; do not assume unrestricted delivery. Enter SMTP secrets only through secure project settings.
7. Keep the existing app owner bindings. `FINANCE_CLOUD_OWNER_EMAIL` permits only the configured owner's bootstrap signup; setting `FINANCE_CLOUD_OWNER_ID` disables new registrations under the existing policy. Do not remove these bindings, enable anonymous auth or remove access restrictions to make a signup screenshot work. Hosted email-signup capability, if needed for owner bootstrap, does not make this app a public multiuser service.
8. Never mark existing users confirmed manually, delete/recreate the owner, import users, reset databases, or modify RLS/finance data as a workaround. Existing confirmed users must continue to sign in directly. Pending confirmation must finish with fresh authenticated-user checks and the same owner policy, including when an owner ID is configured after registration.

No hosted dashboard write, production SMTP change, template update or production test email is part of this PR.

The [official Supabase OTP reference](https://supabase.com/docs/reference/javascript/auth-verifyotp) documents both `verifyOtp({ email, token, type: "email" })` and token-hash verification with `type: "email"`. The [email-template guide](https://supabase.com/docs/guides/auth/auth-email-templates) documents `Token`, `TokenHash` and `SiteURL`; the [resend reference](https://supabase.com/docs/reference/javascript/auth-resend) documents the signup resend operation. The [rate-limit guide](https://supabase.com/docs/guides/auth/rate-limits) includes signup/recovery/resend limits and verification limits, including documented default 60-second signup/OTP request windows. These references were checked during implementation; defaults are not proof of the intended project's actual settings.

## Optional isolated local Supabase mail test

Use a disposable, credentials-free checkout and separate local Supabase project. Do not copy real `.env` files, owner bindings, private-profile stores or finance exports. Inspect available container/runtime resources before starting Supabase. Do not run a linked database reset, migration, seed or `db push` against a hosted project.

In the **disposable local config only**, merge these settings into their existing sections; do not duplicate TOML tables:

```toml
[auth]
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = [
  "http://127.0.0.1:3000/auth/callback",
  "http://127.0.0.1:3000/auth/callback?next=/reset-password",
]

[auth.email]
enable_confirmations = true
otp_length = 6
otp_expiry = 3600
max_frequency = "60s"

[auth.email.template.confirmation]
subject = "Your MoneyNest verification code"
content_path = "./supabase/templates/confirmation-otp.html"
```

Adjust the local port/origin consistently in this config and the app's `APP_URL` when using another isolated port. Keep every unrelated auth option intact. Restart the disposable local Supabase stack to apply its configuration. Use its reported local URL and publishable/anon key with the app; never use a service-role key for browser/server user authentication. Configure a synthetic bootstrap email and no owner ID initially. The local email capture UI is configured at port **54324** in the repository; confirm the running CLI's reported mail UI rather than assuming a hosted mailbox was contacted.

Confirm a local signup sends a captured message with six digits and no authenticated workspace access before verification. Verify the captured code using the UI, inspect session cookies without recording their values, then confirm authorized redirection and a protected workspace response. Exercise wrong/reused/expired codes, resend throttling, network errors, refresh, and change-email/back navigation. Exercise link confirmation in a fresh browser context as well as the signup browser; test recovery and existing confirmed-user sign-in separately. Never publish captured code/link values or a real email address.

To test expiry efficiently, choose a documented supported short expiration in that disposable project, restart it, and wait for the generated code to expire. Do not weaken production TTLs or verification checks to simulate expiry. If the local CLI/container stack is unavailable, record live local delivery/verification as unverified; mocked API/browser tests do not replace it.

## Approval, release and rollback

The review deliverable is a pull request with the audit, precise test results, UI screenshots using synthetic identities, and this manual checklist. Do not merge, push to the production branch, deploy, alter production auth settings or send production mail without owner approval.

`vercel.json` disables automatic Git deployment **only** for the review branch `feat/signup-email-otp` using `git.deploymentEnabled`. [Vercel's documented behavior](https://vercel.com/docs/project-configuration/git-configuration.md) keeps unspecified branches enabled by default; the existing `main` deployment behavior is preserved. Opening/pushing this branch for review must not be mistaken for an approved release. Do not merge it or invoke a deployment.

After approval, coordinate the app release, public PNG availability and the project template/settings update. Verify the exact released commit and intended project, test with an explicitly authorized account, confirm existing login/recovery, owner rejection and signed-out workspace protection, then record delivery and same/cross-device results. Successful mocked tests alone do not certify production readiness.

If rollback is needed, restore the securely recorded prior **Confirm sign up** subject/body and only the settings changed in this rollout; coordinate with a revert of the app release through the normal reviewed process. Do not blindly disable confirmations, change unrelated recovery templates or weaken owner authorization. Do not delete/recreate accounts, invalidate user data, alter confirmation timestamps or roll back financial records. Previously delivered email contents do not change retroactively, and already-used/expired tokens cannot be made valid again.
