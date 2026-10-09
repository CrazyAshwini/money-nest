# CSV statement review

This version supports UTF-8 CSV files up to 2 MB and 1,000 transaction rows per atomic import. PDF and image extraction, OCR, bank integrations, and Notion migration are not implemented. The upload UI must show this limit and reject unsupported file extensions before reading a file. No file is sent to an AI/OCR service.

Use [the synthetic sample](../public/sample-statement.csv) with demo accounts. For a private workspace, replace the account names with an existing account name or ID. The template is fictional and is never imported automatically.

Required headers are `date,description,amount,type,account`. Optional headers are `reference,category,from_account,to_account,currency,status`. Header capitalization and spaces are normalized. Headers must be unique. Unknown extra columns are ignored. Values containing commas, double quotes, or line breaks must use standard CSV quoting; double an embedded double quote. UTF-8 BOM and CRLF files are accepted.

- `date` must be a real calendar date in `YYYY-MM-DD` format. Missing dates and ambiguous day/month formats remain in review; a date is never guessed.
- `amount` must be positive, at most 12 integer digits and two decimal places. Use `1403.60`, without `₹`, grouping commas, a sign, or scientific notation. Parsing normalizes decimal strings without floating-point conversion or rounding.
- `type` must be `expense`, `income`, `refund`, `transfer`, `bill_payment`, or `adjustment`. A loan credit must be deliberately classified as a transfer, not inferred to be income.
- `account` maps to an existing active account by ID or an unambiguous case-insensitive name. Expenses use its outgoing side; income/refunds use its incoming side. CSV cannot create accounts.
- Transfers and bill payments require both `from_account` and `to_account`. These must resolve to different accounts owned by the same user. A missing destination is not invented. An adjustment requires explicit direction through its account columns.
- `reference` is optional and is preserved as a bank reference. `category` is optional; existing/custom category labels are preserved. `currency`, when provided, must be `INR`. A supplied `status` must be `posted`; pending/voided records remain in review.

`parseStatementCsv(csv, accounts, currentTransactions, { fileName, userId })` is asynchronous because it uses WebCrypto SHA-256. Pass only the current owner's records; `userId` additionally scopes account resolution. It returns an `ImportReview` containing a file hash, candidate rows, original values, mapped transaction drafts, errors, warnings, and suggested matches. Row numbers refer to physical lines, including quoted line breaks.

Every row has one of these states:

| State | Meaning | Default selection |
| --- | --- | --- |
| New | Valid values and no suggested duplicate | Selected |
| Existing match | The same imported file row, or compatible account/reference, already exists | Unselected |
| Possible duplicate | Equal normalized date, decimal amount, description, account directions, and type | Unselected |
| Needs review | Invalid/missing values, unknown account, incomplete transfer, or conflicting reference | Unselected |

Matching uses the file SHA-256 plus physical row number for exact reimports. Next it checks the account and bank reference. A reference with conflicting values is flagged rather than overwritten. Equal fingerprints are suggestions, not proof that records represent the same purchase. Distinct nonempty references preserve separate equal-value purchases. Without references, reviewers may explicitly keep a suggested duplicate as a separate purchase by setting `status: "new"`, `selected: true`, and `confirmedDistinct: true`. This never overrides an existing import source row or a conflicting bank reference.

After the user reviews candidates and presses a confirmation action, call `buildImportCommitPlan(review, currentTransactions, { approved: true })`. Without approval it returns no transactions. It inserts only selected, valid New rows, checks the current ledger again, and returns `transactions`, `skipped`, and `errors`. A newly appeared match is skipped. Import IDs and `sourceSystem: "csv"`/`sourceObjectId` lineage are deterministic; repeated commits against an updated ledger insert zero rows. The source object ID is a per-file row locator, not a fabricated bank reference or an external provider identifier.

The builder is pure. The persistence layer must save the entire plan and an audit event atomically. In production, enforce the `(owner, source_system, source_object_id)` uniqueness constraint and server-side ownership and account validation in the same database transaction; a browser-side check does not prevent concurrent requests. Current tests cover plan replay and stale review, not a deployed database concurrency guarantee. For invalid rows, correct the CSV and upload it again; nothing is silently repaired.

`exportTransactionsCsv(transactions, accounts)` returns BOM-prefixed UTF-8 CSV with CRLF, quoted fields, account mappings, transfer directions, currency, and status. Spreadsheet formula characters (`=`, `+`, `-`, `@`, including leading whitespace) and leading tab/newline are prefixed with an apostrophe. That safety apostrophe is part of the exported value and is not stripped on import. Exports should receive only the user's owned records and account labels with masked references. Raw CSV/PDF/image payloads must never be logged or sent to analytics.

Run the pure import checks with `npm test -- src/lib/imports.test.ts`.
