The application has a prepared Supabase backend; no cloud project has been created, linked, migrated, or populated. Without credentials it uses the explicitly labeled browser-local fictional demonstration. Authenticated server APIs return 503 when Supabase is absent and never manufacture a server user.

Database setup

1. Use a dedicated development Supabase project or local Supabase (Docker required). Never link an unrelated existing project.
2. Copy `.env.example` to `.env.local`, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. A legacy public anon key works as fallback. No service-role key is required by the application. Never commit `.env.local` or real financial documents.
3. The canonical migration is `supabase/migrations/20261008192905_finance_core.sql`, created with the Supabase CLI's `migration new` command. It contains 22 owner-scoped tables, composite owner foreign keys, RLS/grants, audit and financial validation triggers, atomic payment/import functions, decimal-safe API views, and private document Storage policies. Drizzle metadata is in `src/db/schema.ts`; SQL migrations remain authoritative for the additional security rules.
4. Local setup: `npx supabase start`, followed by `npx supabase db reset --local`. Use the local project URL/public key printed by the CLI. This reset command is for a dedicated disposable local database only.
5. Remote development setup: `npx supabase link --project-ref YOUR_DEDICATED_PROJECT_REF`, inspect the linked project, then `npx supabase db push`. Configure the Auth site URL, permitted redirect URLs and email delivery/confirmation in that project's dashboard.
6. Run `npx supabase db advisors --local` for local security/performance advice or `npx supabase db advisors --linked` for the explicitly linked development project. Resolve relevant findings before using real data.

Verification

`npx vitest run tests/db-security.test.ts` applies the full migration to embedded PostgreSQL through PGlite, using mock Supabase Auth/Storage schemas and two owners. Tests cover actual RLS, denied anonymous grants, composite foreign keys, decimal strings, audit permissions, Storage owner paths, over-allocation, payment mutation protection, wrong account mappings, and atomic/idempotent CSV import with rollback. This is database execution, not a string-inspection test.

PGlite has one connection. Competing network transactions, live Supabase Auth/email/cookie refresh, real Storage upload and signed downloads, and Supabase advisors have not been tested against a dedicated project. Perform those end-to-end checks before importing private financial records. Allocations lock the payment and target rows; bill/EMI edits cannot reduce an obligation below reserved allocations, and allocated payments cannot be reclassified or voided until allocations are removed. Provisional bill allocations reserve payment funds but do not count as confirmed paid.

API contracts

- `POST /api/auth`: `{action:"login"|"signup"|"logout",email?,password?}`. Secure Supabase cookie sessions; server authorization validates with `getUser`, while the Next.js proxy refreshes sessions with `getClaims`.
- `GET /api/workspace`: `{configured,authenticated,userId,workspace}`. Every query runs with the owner's session and RLS; all pages of rows are loaded. PostgreSQL security-invoker views cast numeric columns to strings before JSON.
- `POST /api/workspace`: `{collection,record}`. Validated, owner-scoped upsert; allocations use database functions and row locks. Record removals use archive/void states; audit history is append-only to users.
- `POST /api/imports/commit`: `{transactions,inputHash,fileName}`. Up to 1,000 reviewed records, committed together in one database transaction. Repeated source row IDs are skipped; later reviews of the same file can append remaining rows under the same batch lock. A retry with no new rows returns `alreadyCommitted:true`. A failed row rolls back the entire submitted batch. Exact provider references are unique per owner/source/account, protecting concurrent imports of the same bank movement from different files; equal amounts alone are never duplicate keys.
- `POST /api/documents`: multipart `file`, up to 10 MB of PDF/CSV/PNG/JPEG/WebP. File signatures and SHA-256 hashes are checked. Storage bucket `finance-documents` is private; object paths begin with the owner's UUID.
- `GET /api/documents?id=UUID`: verifies ownership and returns a signed download URL valid for 60 seconds. Never use a public URL for receipts.

Date-only account snapshots are accepted and normalized to UTC midnight on that stated date, retaining the source calendar label. No synthetic due date is inferred from a statement-generation date. Missing transaction dates remain pending review rather than entering dated spending totals.

Synthetic fixtures

`npm run db:seed-demo` generates `artifacts/demo-workspace.json` containing fictional fixtures and changes no database. To insert them into an empty, dedicated localhost Supabase owner, create/confirm a local demo account, set `DEMO_EMAIL` and `DEMO_PASSWORD` alongside the public local Supabase variables, then run `npm run db:seed-demo -- --apply-local`. Remote URLs and nonempty account registers are rejected. The seeding helper is sequential for a disposable local database; if it fails partway, reset that disposable database before retrying. It never inserts fabricated audit history; PostgreSQL generates audits.

External reminder delivery, OCR/PDF extraction, Notion imports, MFA, and bank synchronization are not connected. Email/push reminders cannot be enabled through this API until an opted-in provider is implemented. Real Notion records have not been bundled, read, or imported.
