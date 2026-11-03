# Changed files

Complete local tracked/new-file inventory for this upgrade. See deployment.md for the subsequent release attempt and current deployment status.

| File | Change |
| --- | --- |
| [docs/moneynest-upgrade/README.md](../../docs/moneynest-upgrade/README.md) | Implementation, verification or changed-file report. |
| [docs/moneynest-upgrade/changed-files.md](../../docs/moneynest-upgrade/changed-files.md) | Implementation, verification or changed-file report. |
| [docs/moneynest-upgrade/screenshots/1440-expense.png](../../docs/moneynest-upgrade/screenshots/1440-expense.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/1440-loan.png](../../docs/moneynest-upgrade/screenshots/1440-loan.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/1440-selector.png](../../docs/moneynest-upgrade/screenshots/1440-selector.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/320-expense.png](../../docs/moneynest-upgrade/screenshots/320-expense.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/320-loan.png](../../docs/moneynest-upgrade/screenshots/320-loan.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/320-selector.png](../../docs/moneynest-upgrade/screenshots/320-selector.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/390-expense.png](../../docs/moneynest-upgrade/screenshots/390-expense.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/390-loan.png](../../docs/moneynest-upgrade/screenshots/390-loan.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/screenshots/390-selector.png](../../docs/moneynest-upgrade/screenshots/390-selector.png) | Synthetic responsive review capture. |
| [docs/moneynest-upgrade/verification.md](../../docs/moneynest-upgrade/verification.md) | Implementation, verification or changed-file report. |
| [playwright.upgrade.config.ts](../../playwright.upgrade.config.ts) | Isolated browser configuration reusing the existing synthetic test server settings. |
| [scripts/generate-db-schema.py](../../scripts/generate-db-schema.py) | Handle additive multi-column ALTER metadata and composite foreign keys. |
| [src/app/api/workspace/route.ts](../../src/app/api/workspace/route.ts) | Authenticated atomic-loan command dispatch, managed-record guards, archive-only account policy. |
| [src/components/analytics-workspace.tsx](../../src/components/analytics-workspace.tsx) | Show separate bank/wallet Money In and Money Out totals. |
| [src/components/editors.tsx](../../src/components/editors.tsx) | Retain editor/pickers; five creation choices, conditional fields, refund context, Profile links, metadata and unsaved/save guards. |
| [src/components/finance-app.tsx](../../src/components/finance-app.tsx) | Wire dedicated personal loans and route account management/loan events to their proper destinations. |
| [src/components/finance-provider.tsx](../../src/components/finance-provider.tsx) | Session-checked client command, stable event transition, refresh and generic mutation guards. |
| [src/components/personal-loans.tsx](../../src/components/personal-loans.tsx) | Personal-loan overview, give/borrow/repay/reverse forms and auditable detail history. |
| [src/components/private-profile.tsx](../../src/components/private-profile.tsx) | Add financial account management to the existing Profile. |
| [src/components/profile-accounts.tsx](../../src/components/profile-accounts.tsx) | Group owner accounts and reuse editors/report tools inside Profile. |
| [src/components/workspace-navigation.tsx](../../src/components/workspace-navigation.tsx) | Rename the existing Loans destination without adding a navigation tab. |
| [src/db/schema.ts](../../src/db/schema.ts) | Regenerated Drizzle columns/composite references; SQL remains authoritative. |
| [src/lib/category-platforms.ts](../../src/lib/category-platforms.ts) | Gift Given/Received category suggestions. |
| [src/lib/finance.ts](../../src/lib/finance.ts) | Personal-share consumption, distinct cash flow, linked reimbursements, interest-reversal income attribution. |
| [src/lib/personal-loans.test.ts](../../src/lib/personal-loans.test.ts) | Personal-loan, classification, cash-flow, shared-expense and precision tests. |
| [src/lib/personal-loans.ts](../../src/lib/personal-loans.ts) | Precise pure command validation, event-derived principal, idempotency and mutation protection. |
| [src/lib/private-profile-http.ts](../../src/lib/private-profile-http.ts) | Dispatch loan commands through existing private-session/origin checks. |
| [src/lib/private-profile-store.ts](../../src/lib/private-profile-store.ts) | Commit the command in one encrypted-file replacement; protect managed history and archive accounts. |
| [src/lib/supabase/commerce-store.ts](../../src/lib/supabase/commerce-store.ts) | Reuse existing state/revision mechanism for atomic loan RPC with conflict revalidation. |
| [src/lib/supabase/validation.ts](../../src/lib/supabase/validation.ts) | Backward-compatible cloud fields for loan/refund references and account scheduling. |
| [src/lib/types.ts](../../src/lib/types.ts) | Backward-compatible models plus separate creation choices/labels. |
| [src/lib/validation.ts](../../src/lib/validation.ts) | Owner/account/loan/reimbursement guards and metadata schemas. |
| [supabase/migrations/20261102190000_personal_loan_ledger.sql](../../supabase/migrations/20261102190000_personal_loan_ledger.sql) | Additive columns, caller-security views/RPC, audit-compatible invariants, repayment and reimbursement enforcement. |
| [tests/compact-expense-e2e/compact-expense.spec.ts](../../tests/compact-expense-e2e/compact-expense.spec.ts) | Adapt assertions to new refund labels, optional description, discard confirmation and existing merchant-first accessible names. |
| [tests/db-balance-snapshot-anchors.test.ts](../../tests/db-balance-snapshot-anchors.test.ts) | Keep legacy-value preservation assertions while recognizing appended nullable loan/refund columns. |
| [tests/db-multi-user-isolation.test.ts](../../tests/db-multi-user-isolation.test.ts) | Include the new RPC in existing caller-security, grant and search-path assertions. |
| [tests/db-personal-loans.test.ts](../../tests/db-personal-loans.test.ts) | Execute full SQL migrations and test atomicity, precision, history, legacy adjustments, RLS and reimbursement caps. |
| [tests/moneynest-upgrade-e2e/upgrade.spec.ts](../../tests/moneynest-upgrade-e2e/upgrade.spec.ts) | Six responsive selector/loan/Profile browser cases. |
