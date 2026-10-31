# Prepare a one-time workspace repair offline

`scripts/repair-workspace-export.ts` prepares a separate candidate JSON file for review. It never connects to Supabase, opens an encrypted private profile, uploads records, or changes the original export. Normal workspace loads now return saved records without applying personal corrections.

For a signed-in local private profile, obtain a transfer export through Profile → Download transfer file. This full export action is local-only; cloud Settings currently exports a ledger CSV rather than this envelope. Keep the backup and repair manifest outside the checkout. The accepted envelope has `format: "money-nest-private-export"`, `version: 1`, `profile`, `workspace`, and `commerce`. Other envelope and record metadata is preserved. A CSV ledger alone is insufficient because it omits related records.

Write a private JSON manifest with this structure. The placeholders below must be replaced with values reviewed from your own backup; no owner-specific correction plan is shipped:

```json
{
  "format": "money-nest-workspace-repair",
  "version": 1,
  "ownerId": "<exact profile UUID from export>",
  "repairId": "<unique repair name using letters, digits, dots, underscores or hyphens>",
  "inputSha256": "<lowercase SHA-256 of the entire original file, including whitespace>",
  "changes": [
    {
      "collection": "transactions",
      "id": "<exact record UUID>",
      "before": { "<every original field>": "<exact original value>" },
      "after": { "<every reviewed replacement field>": "<reviewed value>" }
    }
  ]
}
```

Each `before` is the complete original record, including any metadata. JSON object property order does not matter. `before: null` means the ID must be absent; `after: null` explicitly deletes the matched record. A replacement must retain the declared ID and exact owner. Each collection/ID may appear once. Changes can address accounts, snapshots, transactions, bills, allocations, fixedDeposits, loans, emis, emiAllocations, groups, shares, settlements, and reminders. Audit history and commerce records cannot be edited by this tool.

Calculate the original file hash locally, for example in PowerShell:

```powershell
(Get-FileHash -LiteralPath 'C:\private\original-export.json' -Algorithm SHA256).Hash.ToLowerInvariant()
```

Run the default dry run with absolute paths:

```powershell
npx tsx scripts/repair-workspace-export.ts --input 'C:\private\original-export.json' --manifest 'C:\private\reviewed-repair.json'
```

The script verifies the input hash, profile/row ownership, unique IDs, full before-values, final record schemas and workspace links. Linked order/refund transactions cannot be deleted or have their protected financial fields changed. All changes are checked in memory before a file can be created. Console output contains only the repair name, operation counts and input/output hashes.

After reviewing the manifest and dry-run counts, explicitly create a new candidate:

```powershell
npx tsx scripts/repair-workspace-export.ts --input 'C:\private\original-export.json' --manifest 'C:\private\reviewed-repair.json' --write --output 'C:\private\review-candidate.json'
```

Both `--write` and `--output` are required. The output's parent directory must already exist. Existing files are never overwritten, including the original export and manifest. The candidate includes a `repairHistory` entry with its repair name, input hash and change count. Reusing that repair name against the candidate is rejected, even if someone recalculates its input hash. An unchanged backup can always be used to reproduce the same candidate; this is offline preparation, not a live migration ledger.

Compare the candidate with the untouched backup and check all intended balances, repayments, refunds, snapshots and linked records. A successful validation only confirms the declared changes and supported record rules; it does not prove that a financial correction is true or that balances should remain unchanged.

**Applying the candidate to a real workspace is a separate operation.** The existing cloud transfer flow merges missing records and does not apply replacements or deletions. It also accepts a strict transfer envelope, so the candidate with repair provenance is not an import file for that endpoint. Do not upload it expecting a repair. A live repair requires a separately reviewed authenticated implementation with a current backup, current-state comparisons, an atomic write, and before/after balance checks. No live repair or owner-specific plan is run as part of this code change.
