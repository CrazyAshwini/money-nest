The generated Drizzle schema describes all 22 owner-scoped tables and composite foreign keys. `supabase/migrations/*_finance_core.sql` is the canonical migration; it additionally owns PostgreSQL checks, RLS, grants, audit triggers, atomic allocation/import functions, decimal-safe API views, and Storage policies. Do not replace those migrations with a schema-only generated diff.

Regenerate the column metadata after a migration change:

```sh
python scripts/generate-db-schema.py
```

Local verification:

```sh
npx vitest run tests/db-security.test.ts
```

These tests apply the complete migration to embedded PostgreSQL (PGlite) with mocked Supabase Auth/Storage schemas and two distinct owners. They test real RLS decisions, cross-owner references, allocation overrun and mutation defenses, exact numeric serialization, append-only audits, private object paths, and atomic/idempotent import rollback. PGlite runs one connection: this does not exercise competing network transactions, Supabase Auth email/session delivery, live Storage upload/signing, or Supabase's advisors. Those checks remain required against a dedicated configured development Supabase project before storing real financial records.

Configure a dedicated Supabase project, copy `.env.example` to `.env.local`, and apply the migration using the Supabase CLI. The app uses only a public publishable key with each owner's cookie session; no service-role key is needed by the app. Do not link or modify an unrelated project. `npm run db:migrate` targets the explicitly linked project, so verify the linked project before running it.

The `api_*` views cast PostgreSQL numeric values to text **before JSON serialization** and run with `security_invoker=true`, preserving caller RLS. All API monetary values remain decimal strings. Authenticated users can read their audit history, while only a private, owner-checking trigger can append it; they cannot edit or delete it.

The transaction-platform migration adds nullable `transactions.platform`, appends it to the decimal-safe API view and preserves it in reviewed CSV imports. Merchant remains the actual seller. Apply pending migrations to the dedicated cloud project before using the updated transaction form there. Old local profiles need no migration or automatic classification; the platform field is optional.

External reminder delivery, statement OCR/PDF extraction, MFA, and bank/provider synchronization require additional services and are not represented as connected features. Manual reviewed CSV commits are atomic. Real Notion data is not bundled or imported.
