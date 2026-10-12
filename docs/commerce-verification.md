# Receipt previews, order history and refunds

Verified on 11 October 2026 using the production Next.js build and disposable fictional profiles. These features extend the existing local private profile. They do not provision a cloud database or migrate the user's historical records.

## Receipt and screenshot previews

Uploaded images remain in memory. Select a thumbnail to view the original image, move between photos, zoom from 100% to 300%, and scroll a magnified image. Closing the viewer returns focus to its thumbnail and preserves the scanner's photos and expense draft. Previewing makes no AI request. Removing a photo remains a separate action. Blob URLs are released when their owning scanner closes or removes the image.

## Order review

Open `/orders` through **Orders & refunds**. **Scan order history** accepts one to three PNG/JPEG/WebP screenshots, within 5 MB combined. Every visible order is extracted into its own draft, including cancellations and item statuses. Review each draft as history, pending, a new paid expense, or a link to an existing purchase.

Category and **Platform / Source** sit together in the main order form. The platform dropdown uses the same category-specific choices as Add Expense, including Stationery and Food's Swiggy, Zomato, Domino's and Other. Other opens a custom source field. Existing and scanned sources stay selectable, and changing one order's platform does not affect another draft.

The ordering app is separate from the actual seller. For example, Swiggy is the platform and Bikkgane Biryani is the seller; the seller appears in Description. Correcting Seller updates the description without retaining the old seller name. Order-created expenses, manual refund credits and CSV exports preserve platform and merchant independently.

Posting requires a positive INR amount actually paid, a successful payment, its actual date, and an active paying account or a named external payer. Missing dates and amounts stay unknown. Pending ledger entries do not change cash or posted spending. Merchant delivery status alone cannot prove payment. Displayed fares remain separate from the amount of a linked actual payment.

Repeated source batches use stable fingerprints and operation keys. Saving the same request after losing its response does not add another expense. Strong order identity can merge overlapping observations; probable matches require explicit review. Similar-looking orders with no strong identity remain separate candidates. Later screenshots can be attached to an existing order through **Order details → Update existing order**, preserving its original purchase and other items.

Statements, account limits, Pay Later snapshots, investment/loan records and design references are classified without posting shopping expenses. Supported document types show a link to their existing finance page. This is classification and routing, not statement OCR or automatic reconciliation.

## Cancellation and refund review

Use **Track refund** or **Scan cancellation or refund**. Merchant cancellation, refund initiation and expected dates create expectations only. A refund request may refer to an order, its original posted purchase, and an affected item. Expected, partially received, confirmed, rejected, reported-but-unverified and store-credit states remain distinct.

**Confirm credit** either matches a real posted incoming ledger credit or records one after explicit bank/provider-history confirmation, with a receiving account and actual credit date. Matching reclassifies and links the existing credit rather than creating a second cash movement. Manual recording creates a tagged, linked refund transaction; retrying the same confirmation cannot duplicate it. Partial credits are supported. A credit cannot be reused across refund requests, and confirmed amounts cannot exceed the expectation or original purchase. Confirmed financial links are protected from conflicting transaction edits.

The totals distinguish paid purchases, confirmed refunds, net confirmed spending and pending refunds. Pending expectations never reduce cash or confirmed spending. Store credit remains separate from bank cash. Existing monthly spending applies linked, posted refund credits on their credit dates using the app's original caps.

## Storage and AI boundaries

- Orders, refund expectations and ledger updates are validated and written together under the existing encrypted-store lock. A rejected batch leaves both unchanged.
- Existing profile files without commerce data read as an empty order/refund collection. The profile format and password/session setup remain compatible.
- `/api/orders` and `/api/ai/orders` require a local private session and loopback access. Mutations require a matching Origin. Ownership comes from the authenticated session. Foreign and inactive accounts are rejected.
- Only the uploaded images and extraction instructions reach the configured AI service. Ledger records, account IDs and profile details are not sent. Images and raw provider responses are not retained by the app.
- The app owner supplies the existing server-only AI configuration; users have no API-key controls. Gemini requires fresh redaction acknowledgement for changed photos. Metadata is removed before Gemini transmission; visible personal information still requires manual redaction under the existing Google-service disclosure.
- Each scan uses the selected provider only, with no automatic provider fallback. Credentials and upstream error text are excluded from responses and logs.
- Order extraction uses a smaller provider grammar and strict local validation of enums, text lengths, at most 60 orders, at most 40 items per order, money, calendar dates and photo evidence. The original nested bounded grammar returned Gemini HTTP 400 during live testing; simplifying that grammar resolved it. One subsequent request timed out and a separate retry passed. AI availability and accuracy remain dependent on the provider. See [Google's structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output).

## Verification

Commands used:

```sh
npm run lint
npm run typecheck
npm run test -- --maxWorkers=1 --no-file-parallelism --testTimeout=15000
npm run build
npx playwright test --config playwright.commerce.config.ts
npx playwright test --config playwright.receipt.config.ts
npx playwright test --config playwright.private.config.ts
```

All 260 unit tests pass. They cover decimal-safe order/refund rules, source identities, absent evidence, partial credits, refund caps, repeated confirmations, ownership, atomic encrypted persistence and the cloud boundary. Unsupported generated statuses and oversized order/item collections fail strict local validation with a sanitized error.

The eleven commerce browser tests exercise real authenticated APIs against synthetic encrypted storage: invalid atomic batches, pending records, item refunds, existing-credit matching, manual partial credits, store credit, lost-response retry, editing a manual draft after a lost response, linking an existing purchase, nonpurchase routing, mobile draft preservation and verified refund saving. Receipt coverage adds 22 browser flows, including three local-preview tests. The private-profile regression verifies the existing setup/sign-in/edit/reload flow. Test configuration disables owner keys and confines records to guarded temporary directories; no actual profile is used.

The 12 October platform-dropdown update passes all 13 commerce browser tests and 42 focused category/commerce unit tests, plus lint and the production build. The added 320px checks cover category-specific platforms, custom sources, independent drafts, saved category/platform values, scanned-source preservation, and reset after removing or discarding a draft. History-only saving leaves transactions, cash and posted spending unchanged.

The seller/platform follow-up passes 14 commerce browser tests, including correcting a seller without changing Swiggy or creating a cash movement. Seller names appear in descriptions, while generated and saved ordering platforms use their own field. The complete unit suite now has 290 passing checks; schema/RLS tests exercise the nullable platform migration and preserve exact money strings.

A separate real Gemini `gemini-3.5-flash-lite` call used two fully fictional overlapping order screenshots. It returned three distinct orders, the correct paid amounts and dates, a zero-value cancellation, and no identifying references. Another fully fictional cancellation image produced the expected refund amount and date without confirming a bank credit. The existing two-photo receipt call also passed. No transaction was saved by live AI validation, and billing was not changed.

Desktop order history, mobile order review, mobile refund confirmation and desktop/mobile image previews were visually inspected. Evidence is stored under ignored `artifacts/`. Actual phone camera hardware was not exercised.

## Current scope

These features currently require the private profile on this computer. Hosted/Supabase persistence for orders and refunds, retained evidence attachments, split payments across multiple purchases, combined-credit allocation, automatic bank matching and the full architecture in the supplied master document remain outside this implementation. One purchase payment is linked per order; partial refund credits are supported. Larger combined bank credits require separate ledger reconciliation rather than automatic splitting.
