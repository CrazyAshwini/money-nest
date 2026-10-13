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
- Account create/edit/archive, opening dates, reported snapshots, account history, and reconciliation at the reported cutoff. Bank and wallet displays roll forward a known balance with later posted movements; reported snapshots remain separate from the updated balance.
- Compact expense entry with Stationery and category-specific platform choices, including Swiggy, Zomato, Domino's and Other for Food. Platform stores the ordering app; merchant stores the actual seller, whose name appears in Description. Custom platforms stay selectable, and saved references and notes survive edits. Status and More details controls are removed. Other transaction types are selected from the Transactions page.
- Transaction create/edit, account/month/type/review filters, description/reference search, explicit refund links and sanitized CSV exports. Existing manual review entries require explicit payment confirmation before posting; uncertain receipt entries remain pending.
- Cloud AI receipt scanning inside Add transaction: upload a PNG/JPEG/WebP payment screenshot or shopping receipt and review up to 20 distinct visible transactions. Select entries and save each separately, choosing its account and confirming its details. Recommendations and bill line items are excluded from separate entries; overlapping long-bill photos remain one transaction. Missing dates, unreadable values, failed payments, foreign currency and possible duplicates receive explicit review treatment. An unconfirmed payment remains pending unless the user explicitly confirms completion; failed or unclear payments are never automatically posted.
- Local image previews with photo navigation and 100–300% zoom in both receipt and order scanners.
- Orders & refunds in the private profile: scan up to three order-history screenshots, review separate orders and items, save history or pending drafts, create a confirmed expense, or link an existing payment. Track cancellation/refund expectations separately and confirm actual incoming credits without duplicating cash movements. See [order and refund verification](docs/commerce-verification.md).
- Issued statements and payment matching: statement amount, verified paid amount, provisional matches, credits, remaining amount and confirmed due date. Repayments do not count as expenses.
- Reviewed Excel (.xlsx) bank statements and CSV imports with row errors, duplicate suggestions, explicit approval and deterministic source IDs. Excel statements are read locally, mapped to a selected bank account and let users review transaction types and categories. Private imports save atomically and support partial imports and safe retries. A fictional CSV sample is available on the Imports screen.
- Fixed deposit records and pledged card links; institutional/personal loans, exact-dated installments and partial payment allocations.
- Shared expenses linked to original purchases, participant shares and contributions matched to actual ledger movements.
- In-app reminder preferences and audit history.
- Supabase cookie authentication and protected APIs, 22 normalized owner-scoped tables, RLS, composite ownership foreign keys, private document upload/signing API, decimal-safe views, and guarded atomic allocation/import functions.
- Installable PWA manifest, keyboard-accessible dialogs, labels, and reduced-motion styling. Offline financial-data caching is intentionally not implemented.
- Responsive pages, a keyboard-accessible mobile drawer, branded 404, page titles/descriptions, favicon/install icons and working footer/profile links. See the [usability audit](docs/usability-audit.md).

All money arithmetic uses decimal strings and `decimal.js`; chart positions alone use numeric display values. Reported balances, calculated balances and missing values remain distinct. Unknown due dates stay unknown, incomplete entries stay in review, and excess reimbursements are retained rather than silently rounded away.

## Owner setup for receipt AI

The app owner configures receipt AI once. Users do not supply, replace or remove service keys. The default provider is Google Gemini, using `gemini-3.5-flash-lite` for image input and structured extraction. Get an owner key from [Google AI Studio](https://aistudio.google.com/apikey), verify that its project is on Free Tier, and set these server-only variables in the ignored root `.env.local` file:

```dotenv
RECEIPT_AI_PROVIDER=gemini
GOOGLE_GENERATIVE_AI_API_KEY=your-owner-key
GOOGLE_GENERATIVE_AI_MODEL=gemini-3.5-flash-lite
```

Restart the app after changing the environment. On a hosted server, use the hosting provider's secret environment settings. Never use a `NEXT_PUBLIC_` prefix. Settings → Receipt AI shows provider availability only; the browser API rejects attempts to configure keys. A missing Gemini key, invalid model, exhausted quota or provider error does not switch to Gateway or a paid model.

As verified on 11 October 2026, Gemini 3.5 Flash-Lite has free standard input/output tokens on Google's limited [Free Tier](https://ai.google.dev/gemini-api/docs/pricing). A free project does not require upgrading billing; a billing-enabled project can incur charges even with this model. Quotas vary by project and are shared across its keys. [ChatGPT and API billing are separate](https://developers.openai.com/api/docs/pricing); a free ChatGPT account does not provide an ongoing free API for this app.

Google's [unpaid-service terms](https://ai.google.dev/gemini-api/terms) permit product improvement and human review and prohibit personal, sensitive or confidential submissions. Remove all such information before uploading, including names, contact details, account/card/UPI details, identifying references, QR codes and barcodes. The app requires a fresh redaction confirmation whenever a selected photo changes, covering every photo of a long bill; it does not automatically redact or prove that an image is safe. Use only non-sensitive, redacted receipts with the free provider. The Gemini API terms also restrict use to professional/business purposes and users aged 18 or older; regional availability and billing requirements apply. Private consumer receipts should use a provider whose terms permit that use.

Signed-in users choose Add transaction → Take Photo or Upload Image. The separate Scan receipt sheet accepts one image, or up to three ordered photos of the same long bill within 5 MB combined. Confirm redaction for every Gemini photo, then Start Scan. All photos are read together as one receipt; repeated totals are not added together. Gemini images are decoded and re-encoded without hidden metadata; visible content still requires manual redaction. The upload is bound to the provider and model displayed before scanning; a server configuration change requires refreshing availability and confirming again. Existing accounts, transactions and profile details are not sent. The app uses AI SDK 7 and structured output, validates the result, and performs duplicate checks locally.

Vercel AI Gateway remains an explicit alternative: set `RECEIPT_AI_PROVIDER=gateway` and `AI_GATEWAY_API_KEY`. Optional `AI_GATEWAY_MODEL` accepts `openai/gpt-5.4-nano` (default), `openai/gpt-6-luna` or `openai/gpt-6.1-sol`. Gateway [free credits](https://vercel.com/docs/ai-gateway/pricing) have a restricted catalog and require account verification; [setup](https://vercel.com/docs/ai-gateway/getting-started#create-an-api-key) may require a valid payment method. The app never enables billing or purchases credits.

The image preview stays in memory and the app does not retain the original receipt. Cloud providers handle the selected image under their service policies. Scanning never saves a transaction: use the details, select the correct source or destination account, check the editable values and review confirmation, then save. Uncertain or failed payments remain in Needs review. This feature currently requires the local private profile; demo transactions and the CSV importer remain separate.

Upload, review, authentication, server-key isolation and saving are tested with synthetic data. Live Gemini extraction was verified with a fully fictional receipt: amount, currency and date matched the source, and identifying fields were omitted. Automated tests use synthetic credentials and mock extraction; no service key is published. See [receipt AI verification](docs/receipt-ai-verification.md).

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
npx playwright test --config playwright.commerce.config.ts
npx playwright test --config playwright.polish.config.ts
```

Finance and import tests exercise exact cents, repayment exclusion, refund caps, missing dates, and idempotency. Database tests execute the migration in embedded PostgreSQL with two owners and mocked Supabase Auth/Storage schemas; this tests actual RLS and SQL constraints, but does not substitute for live Supabase verification. Browser tests cover desktop and mobile workflows and persistence. Private-profile tests use synthetic data in an isolated temporary folder and verify setup, authentication, ownership, origin checks, persistence, encryption, and demo separation; build the production app first.

## Remaining integrations

This is a working first version, not a completed production release of every phase in the original blueprint. PDF receipt parsing, batch statement OCR, Notion migration, external email/push delivery, automated reconciliation and import reversal UI, retained receipt attachments, PDF report generation, MFA, bank sync, and restore-tested production backups remain future work. Hosted deployment and live integration tests require a dedicated configured project. No background notifications are sent by this version.

## Project layout

`src/components` contains the app screens; `src/lib/finance.ts` owns pure financial calculations; `src/lib/imports.ts` owns statement review and `src/lib/statement-workbook.ts` reads Excel bank exports; `src/lib/supabase` and `src/app/api` own authenticated access; `supabase/migrations` is the canonical database implementation. Drizzle metadata describes the normalized tables, and SQL owns RLS, grants, triggers, views and atomic procedures. [Import format and review rules](docs/imports.md) describe supported Excel layouts and CSV fields.

Do not commit `.env.local`, statements, production seeds or financial backups. Fictional seed data is the only sample data in this project.
