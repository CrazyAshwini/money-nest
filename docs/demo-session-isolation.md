# Public demo session isolation

The public demo remains available through the existing demo entry links and
demo login aliases. Its HTTP-only `money-nest-demo-session` cookie selects a
fictional workspace and profile. `GET /api/workspace?demo=true` also remains an
explicit fictional read; that query does not establish a real authenticated
session or grant access to another endpoint.

The demo cookie is a negative isolation marker. An existing real Supabase cookie
can remain in the browser when demo starts, so cloud services reject demo-marked
requests before loading a real user, reading a request body, consuming an AI
quota, calling a provider or accessing document storage. This covers:

- Workspace mutations and profile mutations.
- AI settings, receipt/order scanning and NestBot reads or writes.
- Order/refund APIs, document upload/download links and saved handoff reviews.
- Statement commits and private-profile transfers into cloud storage.
- Password changes against an underlying real session.

These responses return `403` with `code: "demo_read_only"` and private no-store
headers. They never claim that a demo record was saved to a server. Demo finance
edits are handled in the fictional browser workspace. The app's existing local
private-profile mode keeps its separate authenticated route delegation; the
public cloud demo does not authorize local-profile access.

Real password login, email-code confirmation and authentication callbacks clear
the demo cookie only after their existing fresh-user checks succeed. Failed
verification retains the demo marker. The real password minimum remains eight
characters; the existing demo entry password already meets it.

Exiting demo uses the explicit `exit-demo` Auth action. It requires the demo
marker, clears only that cookie, and returns before creating a Supabase client.
An underlying real session remains signed in. After refreshing, the UI opens
that real workspace if present or returns to login. A request without an active
demo marker is rejected and cannot affect real authentication.

Real sign-out continues to use `logout`. Returned Auth errors and thrown network
errors produce failure responses instead of reporting success. Demo exit does
not use that action or silently sign out a real cloud session.

Synthetic route tests combine a demo cookie with an apparent real-owner session
and assert that protected handlers do not initialize Supabase, read bodies or
consume quotas. Separate mocked Auth tests cover sign-in/callback cookie changes,
password validation and truthful logout failures. These checks do not certify
hosted Auth configuration, real provider calls or production cookie behavior.
No real profile, financial records, provider credentials or hosted settings were
read or changed for this work.
