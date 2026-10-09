# Personal Finance OS

A working Next.js + TypeScript finance workspace, built from the supplied implementation blueprint. The fictional demo saves demo changes in this browser. A separate private profile can store personal records on this computer; private financial data is never bundled with the app or saved to browser storage.

## Run locally

Requires Node.js 22.13 or newer and npm. From this directory:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000/dashboard. With no Supabase configuration, the app clearly labels the device-local fictional demo. The demo's reference date is 9 October 2026. Settings can export its ledger or restore the initial fictional records. No banking, Notion or other accounts are contacted by the demo.

## Private profile on this computer

Set the server-only `FINANCE_PRIVATE_ENABLED=true` in `.env.local` and restart the app. Provision an authorized private export with `npx tsx scripts/create-private-profile.ts "path/to/finance_data.private.json"`. The script prints record counts only and creates a one-time, 24-hour `profile-setup.url` in `%LOCALAPPDATA%\PersonalFinanceOS\expense-tracker`. Open that shortcut to choose your profile name, email, and a password of at least 10 characters. Sign in with that email and password; the email is stored only in the encrypted local profile. Provisioning refuses to replace an existing profile.

The server encrypts the workspace on disk and uses password hashing, opaque HttpOnly sessions, and loopback-only access. On Windows, restrict the storage folder to your Windows account and SYSTEM before provisioning. The encryption key stays in that protected folder; this protects stored records from plaintext disclosure, but access to the same Windows account includes access to its key. Use Your profile to edit the name or sign out. The fictional demo remains separate. This local profile does not sync between devices.

Imports retain missing dates, unknown limits, and provisional matches. Known unpaid Pay Later bills show a minimum exposure without inventing a full utilization percentage. Contribution pools remain separate from income and personal debt until each person's share is known.

## Implemented

- Compact dark dashboard with four KPI cards (2 × 2 on mobile), three bills to pay and three recent transactions. Credit limits, percentage used and Smart/Medium/High usage colors stay visible; expand a summary card to see every active account. Full account views and charts are on their dedicated pages.
- Account create/edit/archive, opening dates, reported snapshots, account history, and reconciliation at the reported cutoff.
- Transaction create/edit/void, account/month/type/review filters, description/reference search, explicit refund links and sanitized CSV exports.
- Cloud AI receipt scanning inside Add transaction: upload a PNG/JPEG/WebP payment screenshot or shopping receipt, review the extracted details, choose an account, and confirm before saving. Missing dates, unreadable values, failed payments, foreign currency and possible duplicates receive explicit review treatment.
- Issued statements and payment matching: statement amount, verified paid amount, provisional matches, credits, remaining amount and confirmed due date. Repayments do not count as expenses.
- Reviewed CSV imports with row errors, duplicate suggestions, explicit approval, deterministic source IDs, and atomic idempotent cloud commits. A fictional sample is available on the Imports screen.
- Fixed deposit records and pledged card links; institutional/personal loans, exact-dated installments and partial payment allocations.
- Shared expenses linked to original purchases, participant shares and contributions matched to actual ledger movements.
- In-app reminder preferences and audit history.
- Supabase cookie authentication and protected APIs, 22 normalized owner-scoped tables, RLS, composite ownership foreign keys, private document upload/signing API, decimal-safe views, and guarded atomic allocation/import functions.
- Installable PWA manifest, keyboard-accessible dialogs, labels, and reduced-motion styling. Offline financial-data caching is intentionally not implemented.

All money arithmetic uses decimal strings and `decimal.js`; chart positions alone use numeric display values. Reported balances, calculated balances and missing values remain distinct. Unknown due dates stay unknown, incomplete entries stay in review, and excess reimbursements are retained rather than silently rounded away.

## Owner setup for receipt AI

The app owner configures receipt AI once. Users do not supply, replace or remove service keys. Get a Vercel AI Gateway API key from the [official setup guide](https://vercel.com/docs/ai-gateway/getting-started#create-an-api-key), set `AI_GATEWAY_API_KEY` in the ignored root `.env.local` file, and restart the app. On a hosted server, set it through the hosting provider's secret environment settings. Keep the variable server-only, without a `NEXT_PUBLIC_` prefix. Scans use the owner's AI service credits.

An optional `AI_GATEWAY_MODEL` selects `openai/gpt-5.4-nano` (the default, eligible for free Gateway credits), `openai/gpt-6-luna` or `openai/gpt-6.1-sol` (paid Gateway credits required). The model and credentials are controlled by the server. Settings → Receipt AI shows availability only; the browser API rejects attempts to configure keys.

As verified on 9 October 2026, Vercel offers [$5/month in free Gateway credits](https://vercel.com/docs/ai-gateway/pricing) for a restricted model catalog with lower rate limits. The default model appears in the [eligible catalog](https://vercel.com/ai-gateway/models?freeTier=true). A [valid payment method is required](https://vercel.com/docs/ai-gateway/getting-started#create-an-api-key) to unlock free credits. This is limited usage, not an unlimited free API; buying credits moves the account to the paid tier and ends its monthly free allocation.

Signed-in users choose Add transaction → Add from a receipt, select an image no larger than 5 MB, then Scan with AI. This sends only the selected image to Vercel AI Gateway and the configured OpenAI model; existing accounts, transactions and profile details are not sent. The app uses AI SDK 7 and structured output, validates the result, and performs duplicate checks locally.

The image preview stays in memory and the app does not retain the original receipt. Cloud providers handle the selected image under their service policies. Scanning never saves a transaction: use the details, select the correct source or destination account, check the editable values and review confirmation, then save. Uncertain or failed payments remain in Needs review. This feature currently requires the local private profile; demo transactions and the CSV importer remain separate.

Upload, review, authentication, server-key isolation and saving are tested with synthetic data. Live cloud extraction awaits an owner-configured service key; automated browser tests mock the extraction response. See [receipt AI verification](docs/receipt-ai-verification.md).

## Connect a dedicated Supabase project

The local demo needs no credentials. To enable actual sign-in and multi-device storage, follow [database setup](docs/database.md) and [database verification notes](src/db/README.md). Copy `.env.example` to `.env.local`, set your project URL and publishable key, apply the migration to that dedicated project, and restart the app. The application does not need a service-role key.

The connected account observed during development had only an unrelated inactive project; it was not modified. No remote project was created, no migration was deployed, and live Supabase sign-in/storage have not been verified. Before using real records with Supabase, finish the live development-project checks in the database notes. The local private profile uses its own authenticated storage.

## Verify

```sh
npm run lint
npm run typecheck
npm run test
npx playwright install chromium
npm run test:e2e
npm run build
npx playwright test --config playwright.private.config.ts
npx playwright test --config playwright.receipt.config.ts
```

Finance and import tests exercise exact cents, repayment exclusion, refund caps, missing dates, and idempotency. Database tests execute the migration in embedded PostgreSQL with two owners and mocked Supabase Auth/Storage schemas; this tests actual RLS and SQL constraints, but does not substitute for live Supabase verification. Browser tests cover desktop and mobile workflows and persistence. Private-profile tests use synthetic data in an isolated temporary folder and verify setup, authentication, ownership, origin checks, persistence, encryption, and demo separation; build the production app first.

## Remaining integrations

This is a working first version, not a completed production release of every phase in the original blueprint. PDF receipt parsing, batch statement OCR, Notion migration, external email/push delivery, automated reconciliation and import reversal UI, retained receipt attachments, PDF report generation, MFA, bank sync, and restore-tested production backups remain future work. Hosted deployment and live integration tests require a dedicated configured project. No background notifications are sent by this version.

## Project layout

`src/components` contains the app screens; `src/lib/finance.ts` owns pure financial calculations; `src/lib/imports.ts` owns CSV review; `src/lib/supabase` and `src/app/api` own authenticated access; `supabase/migrations` is the canonical database implementation. Drizzle metadata describes the normalized tables, and SQL owns RLS, grants, triggers, views and atomic procedures. [Import format and review rules](docs/imports.md) include the supported CSV fields.

Do not commit `.env.local`, statements, production seeds or financial backups. Fictional seed data is the only sample data in this project.
