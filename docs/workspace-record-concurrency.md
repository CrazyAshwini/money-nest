# Workspace record concurrency

Workspace saves compare the version originally reviewed by the editor with the
current stored record. A second device or a background refresh cannot silently
upgrade that captured expectation. No conflicting mutation is retried automatically.

The POST request contains `collection`, `record`, and an optional top-level
`expectedUpdatedAt`:

| Expectation                 | Meaning                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Property omitted            | Create only. An existing ID returns `409`; it is never upserted.                                           |
| Original `updatedAt` string | Update only if the owner, ID and current version match.                                                    |
| Explicit `null`             | Update an existing **private local** record that still has no version. Cloud updates reject this sentinel. |

Treat an ISO timestamp returned by the server as an opaque token. Preserve its
original offset and fractional precision; PostgreSQL can return microseconds.
Do not parse it through a JavaScript `Date`, replace it with the current time, or
look up a newer version when saving an older draft. A record's `updatedAt` field
does not itself authorize an update: send the captured top-level expectation.
The server supplies the saved `updatedAt`; a client-supplied `record.updatedAt`
cannot choose the saved version.

DELETE requires `collection`, `id`, and `expectedUpdatedAt`. A missing or stale
record cannot be deleted using a prior version. The local legacy sentinel has
the same meaning as for an update; cloud deletion requires a timestamp.

Conflicts return `409` with `code: "conflict"`. The provider refreshes the current
workspace and reports the conflict. Reopen the editor, compare the latest record
with the intended change, then save again. If refreshing fails, reload before
retrying. Session changes discard responses belonging to an earlier session.

A lost receipt-create response has a narrow recovery path. After a duplicate-create
`409`, a successful fresh load may acknowledge the already committed receipt only
when its owner, ID and complete canonical receipt payload match the attempted
creation. Generated timestamps, decimal serialization and supported nullable
database defaults are accounted for. After that refresh, the provider does not
resubmit or update the saved record. It does not acknowledge an explicit update,
a changed payload or an obsolete session.

## Cloud migration and allocation RPCs

Review and apply `20261031184055_workspace_record_versions.sql` before releasing
the application changes. Preparing this migration does not apply it to a linked
or hosted database.

All 13 mutable collections have server-managed `updated_at` values and monotonic
update triggers:

| Collection       | Table                      |
| ---------------- | -------------------------- |
| `accounts`       | `accounts`                 |
| `snapshots`      | `account_snapshots`        |
| `transactions`   | `transactions`             |
| `bills`          | `bills`                    |
| `allocations`    | `bill_payment_allocations` |
| `fixedDeposits`  | `fixed_deposits`           |
| `loans`          | `loans`                    |
| `emis`           | `emis`                     |
| `emiAllocations` | `emi_payment_allocations`  |
| `groups`         | `expense_groups`           |
| `shares`         | `expense_shares`           |
| `settlements`    | `settlements`              |
| `reminders`      | `reminders`                |

The migration updates the affected decimal-safe API views. Audit events remain
server-generated and immutable. Existing ownership policies, financial link
guards and workspace locks remain in force. Ordinary updates/deletes compare
the version in the same SQL statement that performs the mutation.

`allocate_bill_payment` and `allocate_emi_payment` accept an additional optional
`p_expected_updated_at` argument. Its absence or null means **insert only**;
existing allocation edits require their original timestamp. Their conditional
updates retain the existing bill/installment and transaction links, allocation
caps, owner checks and locks. The prior function signatures are replaced so an
unversioned allocation call cannot silently overwrite a row. Stale updates raise
SQLSTATE `40001`; duplicate creation raises `23505`; the workspace API maps both
to a conflict response.

Cloud commerce already uses a separate workspace-revision comparison for atomic
order/refund operations. That mechanism remains in use. Bot confirmation creates
a new transaction with insert-only semantics.

## Private local profiles and limits of verification

Private profiles compare the original version while holding their existing
process queue and filesystem lock. New saves advance a server-generated version
even when two writes occur within one millisecond. Older unversioned rows are
upgraded only by an explicitly expected write; loading a profile does not rewrite
its records. Transactions created or changed by private commerce and newly
imported transactions also receive versions.

The checked-in cloud schema currently grants transaction reads/inserts/updates,
but does **not** grant authenticated transaction deletion or an owned-delete
policy for that table. This predates the concurrency change. The migration does
not broaden those permissions; cloud transaction deletion remains subject to
that restriction. Version comparison is not a substitute for DELETE permission.

Local tests cover timestamp propagation across all mutable tables, allocation
compare-and-save, duplicate creation, stale updates/deletes, preserved financial
guards, private writer races, legacy local rows and captured browser expectations.
PGlite and synthetic browser/API fixtures do not certify hosted migration state,
real concurrent PostgREST sessions, production grants or real-device persistence.
No owner records, live credentials or production database were used or changed.
