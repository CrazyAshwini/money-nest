# Receipt AI verification

Verified on 11 October 2026 against the production Next.js build using synthetic receipts, credentials and an isolated temporary profile. Gemini support is checked separately from live provider access.

Add transaction accepts one PNG, JPEG or WebP image up to 5 MB. Scanning calls an authenticated server route, which sends the selected image to the displayed, owner-selected provider. Google Gemini is the default; Vercel AI Gateway is an explicit alternative. Existing financial records stay local. Extracted details are validated and shown for review; applying them and saving are separate actions.

The app owner configures `RECEIPT_AI_PROVIDER=gemini`, `GOOGLE_GENERATIVE_AI_API_KEY` and optional `GOOGLE_GENERATIVE_AI_MODEL` on the server. Gateway instead uses an explicit `RECEIPT_AI_PROVIDER=gateway`, `AI_GATEWAY_API_KEY` and optional `AI_GATEWAY_MODEL`. Users do not enter or manage credentials. Settings shows read-only availability. Existing encrypted profile files are not migrated or replaced by this change.

| Boundary | Result | Evidence |
| --- | --- | --- |
| Upload and review UI | Passed | Image validation, preview, editable fields, cancellation, stale response handling, retry, duplicate warnings and 360px layout. |
| Browser to API | Passed | Session, loopback Host and matching Origin checks; bounded request bodies, image signatures, explicit scan consent and concurrency/rate guards. Gemini additionally requires redaction acknowledgement before any provider invocation. Stale provider/model consent is rejected before a cloud call. |
| Owner configuration | Passed | Provider/model pairs are allowlisted; public metadata contains no key or owner identity. Missing Gemini credentials never reuse a Gateway key. User credential POSTs return 403 without reading the body or changing the encrypted profile. |
| User settings | Passed | Real authenticated availability loads and refreshes through GET. No key input, key actions or server setup instructions appear in the user UI. |
| Review to ledger | Passed | Explicit account selection and review confirmation required; real synthetic transaction saved with exact amount, merchant, reference and receipt fingerprint. Editing resets confirmation. |
| Uncertain evidence | Passed | Missing dates stay empty, foreign amounts cannot fill INR fields, and failed payments remain in Needs review even when Posted is selected. |
| Provider isolation | Passed | Exactly one provider is created. Authentication, quota, timeout, malformed output and server errors return sanitized failures without a fallback provider or model. Gemini results cannot retain reconstructed account hints or references. |
| Hidden image metadata | Passed | Real synthetic JPEG/PNG/WebP fixtures lose EXIF, GPS and XMP; dimensions, orientation and image content are checked. Corrupt, oversized and excessive-pixel inputs fail before any provider call. |
| Live Gemini | Passed with synthetic image | An owner key from a Free Tier project completed a real `gemini-3.5-flash-lite` scan. Amount, currency and date matched the fictional source; identifying fields were omitted. No real financial document was submitted and no transaction was saved. |

All 188 unit tests pass, including seven image-decoding tests. Lint, TypeScript and the production build pass. All sixteen receipt browser tests and the complete private-profile regression pass against the final build. Unit tests ran with one worker and a 15-second test timeout to avoid contention in the existing password-hashing tests on this Windows host. Browser checks exercise both Gemini and Gateway with synthetic extraction responses; SDK provider calls are mocked.

The [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) confirms image input and structured output; [Google pricing](https://ai.google.dev/gemini-api/docs/pricing) lists free standard input and output on Free Tier. This verifies model capability, not account eligibility or extraction accuracy. A billing-enabled project may incur charges; the app does not inspect or change Google billing. Gemini quota is shared by project, and no fixed or unlimited free capacity is promised.

Google's [unpaid-service terms](https://ai.google.dev/gemini-api/terms) permit product improvement and human review and prohibit personal, sensitive or confidential input. Redaction acknowledgement is a user assertion, not automatic redaction or a pixel audit. QR codes, barcodes and identifying references must also be removed. The server decodes and re-encodes Gemini images without metadata before transmission, with pixel/output limits. The terms restrict use to professional/business purposes and users aged 18 or older, with regional requirements. Only permitted, non-sensitive synthetic images are used for live validation.

To repeat live verification, the owner configures a key from [AI Studio](https://aistudio.google.com/apikey) for a Free Tier project in the ignored root `.env.local` file and restarts the server. Compare every returned field with a fully fictional sample image before exercising the separate review/save flow. Configuring a key makes no validation generation request by itself. The verified owner key remains server-only and is excluded from the repository; billing was not enabled or changed.

Synthetic UI evidence is saved in ignored `artifacts/receipt-ai-owner-settings.png`, `artifacts/receipt-gemini-redaction-mobile.png`, `artifacts/receipt-review-desktop.png` and `artifacts/receipt-review-mobile.png`. The app does not retain uploaded receipt images; only the reviewed transaction and its SHA-256 source fingerprint persist.
