# Public signup and private workspaces: review and rollout

This is a prepared, tested code change for owner review. It has not enabled public signup in production, changed hosted Supabase settings, applied a hosted migration, or deployed. Keep production restricted until the owner approves the tested PR and the environment changes below.

The attachment contained the earlier `MoneyNest_Codex_OTP_Signup_Complete_README.md`, which explicitly described owner-only signup. The user's newer request for public signup and independent private workspaces is the specification for this change. Existing six-digit OTP and panda branding are reused, rather than redesigned.

## Access configuration

| Server environment | Registration and workspace access |
| --- | --- |
| `FINANCE_CLOUD_ACCESS_MODE` unset, empty, or `owner` | Confirmed configured operator only; original owner-email bootstrap rules remain. Without a valid configured operator, fail closed. |
| `FINANCE_CLOUD_ACCESS_MODE=public` | New email/password registrations and each confirmed, non-anonymous Supabase email user can access their own workspace. Legacy owner bindings do not restrict ordinary users. |
| Any other value | Cloud access and signup disabled. |

This setting is server-only. Never prefix it with `NEXT_PUBLIC_`. Retain `FINANCE_CLOUD_OWNER_ID` / `FINANCE_CLOUD_OWNER_EMAIL` for the existing operator-only AI boundary. Public users do not gain access to the operator's AI credentials or paid provider budget; manual expense management, account records, profiles and reviewed imports remain per-user. Existing Orders visibility and private-local authentication remain unchanged.

Every cloud request uses the session established by the cookie-aware Supabase client and a fresh Auth `getUser()`. The verified Supabase UUID becomes the workspace owner; no new user is assigned the previous owner's UUID. Submitted ownership is checked, not trusted. New financial collections start empty; no owner records or demo balances are copied. A missing profile row has a per-session fallback and is saved only under that user's ID when edited.

The default is deliberately restricted. This also removes the old fallback that accepted arbitrary non-anonymous users when no operator binding existed. Confirm the existing operator binding before a future restricted deployment, or explicitly select the reviewed public mode.

## Database verification before hosted activation

All seven existing migrations were installed and exercised locally. No new migration is necessary. The actual local PostgreSQL inventory and two-user checks cover 28 public tables plus `storage.objects`, 22 `security_invoker` API views, eight invoker RPCs, owner-aware relationship constraints/triggers, and private storage-folder policies. The sole definer function is the private, non-callable audit trigger with its actor check.

Local evidence does not establish which migrations or policies are currently installed in the hosted project. Before activating public mode:

1. Review hosted migration history against the seven existing files in `supabase/migrations`. Do not reset, seed, replace a workspace or recreate users. If hosted migrations are missing, review their existing data effects separately before approving application.
2. Run the [read-only policy inventory](../supabase/audits/public-multi-user-readiness.sql) in the intended project's SQL editor. It returns policy/schema metadata, not financial rows. Compare with the [tested local inventory](public-multi-user-review/local-rls-inventory.json).
3. Confirm every application table has RLS, anonymous users have no application data privileges, ownership policies use the authenticated UUID for both read/write checks, and API views execute as the caller. Counts alone are insufficient: review policy definitions and authenticated RPC grants too.
4. Confirm `finance-documents` remains private and its object policies constrain the first folder to `auth.uid()`. Do not make the bucket public. Full hosted Storage upload/download and signed-URL expiry require staging verification; the local integration exercised real storage metadata policies, not the Storage file-delivery service.
5. In an isolated staging project, use two controlled test accounts to verify independent empty workspaces, CRUD, profile updates, imports, copied record URLs/IDs, cross-user relationships, document access, logout/login and persistence. Include an anonymous caller and an unconfirmed user. Do not use real owner finance records as test fixtures.

## Supabase Dashboard and application settings, after approval

1. Keep the Email provider enabled and allow email/password registration. Require email confirmation. Do not enable anonymous sign-ins or weaken existing session/origin protections.
2. Keep six-digit email OTPs. Confirm the desired expiry and resend/verification/IP rate limits in the hosted project. The server delegates cross-instance throttling to Supabase and honors provider rate-limit responses; the browser countdown is retry advice. Local development now uses confirmations enabled, six digits, a 3600-second expiry and a 60-second email frequency in `supabase/config.toml`. That file does not apply hosted settings.
3. Retain the existing [branded confirmation template](../supabase/templates/confirmation-otp.html), dynamic token, token-hash callback fallback and approved panda PNG. Do not replace password recovery or email-change templates. Template content and brand assets are unchanged by this PR.
4. Verify custom SMTP/sender-domain configuration for public recipients and controlled test-mail delivery. Supabase's default restricted mail service is not evidence of public deliverability. Enter SMTP credentials only in the provider's secure settings.
5. Preserve Site URL, exact intended redirect URLs and the app's exact `APP_URL` origin. Keep `/auth/callback` and the existing password-recovery destination working. Do not add wildcard preview origins or trust forwarded hosts. Vercel supplies the exact current `VERCEL_URL` separately.
6. Set server-side `FINANCE_CLOUD_ACCESS_MODE=public` in the approved release environment. Keep operator bindings for operator-only AI. Do not change IDs, `email_confirmed_at`, financial rows, RLS grants, bucket visibility or service-role exposure to make signup work.
7. Deploy only after the owner approves the PR/release. Feature-branch automatic Vercel deployment is disabled. After release, verify public signup through an actual controlled inbox, six-digit verification/resend/recovery, fresh SSR session, empty new workspace and the staging isolation checks. Existing confirmed accounts must sign in directly without registering again.

If Supabase signup unexpectedly returns an authenticated session, the application signs it out and rejects the signup with `email_confirmation_required`. This guards the application's signup response; it does not substitute for requiring confirmation in Supabase itself, which also governs direct Auth/Data API access. Existing confirmed accounts continue to use password sign-in.

## Rollback

Switch the application back to `FINANCE_CLOUD_ACCESS_MODE=owner` with the existing valid operator binding, then redeploy the approved previous release if required. Restore reviewed hosted signup/template settings if those were changed during release. Public users become unable to access the restricted application; their Auth users and owned records remain intact. Do not delete users, rewrite user IDs, reset a database or transfer public users' records to the operator as rollback.

See the [audit and test report](public-multi-user-verification-2026-10-18.md) for exact outcomes and remaining verification limits.
