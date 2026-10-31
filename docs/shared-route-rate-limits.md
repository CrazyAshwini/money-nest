# Shared AI and upload request limits

Authenticated POST requests consume one quota slot before the app reads a body,
parses an upload, calls an AI provider, or writes to document storage:

| Route             | Bucket      | Requests per 60 seconds |
| ----------------- | ----------- | ----------------------- |
| `/api/ai/receipt` | `receipt`   | 10                      |
| `/api/ai/bot`     | `bot`       | 20                      |
| `/api/ai/orders`  | `orders`    | 10                      |
| `/api/documents`  | `documents` | 20                      |

Cloud limits use the existing authenticated Supabase cookie session. The
`consume_finance_rate_limit` RPC accepts only a bucket. The database derives
the user from Auth and defines the quotas and clock; clients cannot supply a
different owner, count, limit, or window. Each user/bucket keeps one counter row.
An atomic upsert increments that counter or starts a new window after the old
60-second window expires. This is a fixed window starting with its first request,
not a sliding-window quota. Denied attempts do not extend the window.

Counters live in a private schema with RLS enabled and no direct table grants
for browser roles. The public RPC runs as its caller and delegates to a narrowly
granted private helper. The helper has an empty search path, rejects missing and
anonymous identities, and exposes only the quota decision and retry delay.

No Redis service, service-role key, or additional environment variable is needed.
Quota denials return `429`, `code: "rate_limited"`, and `Retry-After` in seconds.
An unavailable, timed-out, missing, or malformed shared quota response returns
`503`, `code: "rate_limit_unavailable"`, and `Retry-After: 5`; it never enables an
instance-local cloud fallback. Responses are private and are not cached.

An authenticated local private profile can use a process-local counter only when
private persistence is explicitly enabled and no Vercel deployment markers are
set. Local private mode is for one computer; its counters reset on process
restart. The existing in-process scan concurrency guard remains a second layer.

## Rollout and verification

Review and apply the pending shared-rate-limit migration to the intended
Supabase project before releasing the routes. Applying the migration is separate
from preparing this code: it has not been applied to a linked or production
database by the audit work. A release against a database without the RPC fails
closed for these POST routes. Existing authentication, origin checks, financial
tables, RLS policies, and Storage ownership checks remain in force.

Local verification uses mocked route clients and PGlite with synthetic Auth
identities. It covers quota exhaustion, independent buckets and users, expiry,
counter tampering permissions, anonymous access, malformed/outage responses,
and rejection before reading bodies or calling providers/storage. PGlite uses
one connection; these tests do not certify competing network transactions,
hosted grants/schema exposure, real Auth sessions, or production deployment.
The upsert is the single atomic database mutation; dedicated hosted concurrency
and advisory checks remain part of a separately authorized rollout.
