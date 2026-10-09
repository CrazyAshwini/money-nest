# Receipt AI verification

Verified on 9 October 2026 against the production Next.js build, using synthetic receipts, credentials and an isolated temporary profile.

Add transaction accepts one PNG, JPEG or WebP image up to 5 MB. Scanning calls an authenticated server route, which sends the selected image to Vercel AI Gateway and the owner-configured OpenAI model. Existing financial records stay local. Extracted details are validated and shown for review; applying them and saving are separate actions.

The app owner configures `AI_GATEWAY_API_KEY` and optional `AI_GATEWAY_MODEL` on the server. Users do not enter or manage credentials. Settings shows read-only availability. Per-profile keys are no longer read or written, and existing encrypted profile files are not migrated or replaced by this change.

| Boundary | Result | Evidence |
| --- | --- | --- |
| Upload and review UI | Passed | Image validation, preview, editable fields, cancellation, stale response handling, retry, duplicate warnings and 360px layout. |
| Browser to API | Passed | Session, loopback Host and matching Origin checks; bounded request bodies, image signatures, explicit scan consent and concurrency/rate guards. |
| Owner configuration | Passed | Server environment config is validated with synthetic values; public metadata contains no key or owner identity. User credential POSTs return 403 without reading the body or changing the encrypted profile. |
| User settings | Passed | Real authenticated availability loads and refreshes through GET. No key input, key actions or server setup instructions appear in the user UI. |
| Review to ledger | Passed | Explicit account selection and review confirmation required; real synthetic transaction saved with exact amount, merchant, reference and receipt fingerprint. Editing resets confirmation. |
| Uncertain evidence | Passed | Missing dates stay empty, foreign amounts cannot fill INR fields, and failed payments remain in Needs review even when Posted is selected. |
| Live cloud provider | Awaiting key | No service key is configured. Browser extraction responses and SDK provider calls are mocked; no real receipt or paid generation was sent. |

The owner-managed update passes all 161 unit tests, lint, TypeScript checks and production build. Twelve receipt browser tests and the complete private-profile regression passed against this final build. The existing 24 desktop/mobile demo tests passed on the preceding receipt-feature build.

The [public Gateway model catalog](https://ai-gateway.vercel.sh/v1/models) confirms image input and structured output for `openai/gpt-5.4-nano`, `openai/gpt-6-luna` and `openai/gpt-6.1-sol`. The [official free-tier catalog](https://vercel.com/ai-gateway/models?freeTier=true) marks GPT 5.4 Nano eligible for free credits; the other two require paid credits. GPT 5.4 Nano is now the default and supports the existing SDK v4 contract and low reasoning setting. This verifies model eligibility, not account access or live extraction accuracy. Configuring the server key does not make a paid validation request. The first scan checks actual service access and credits.

To finish live verification, the owner sets a valid Gateway key in the ignored root `.env.local` file and restarts the server. A signed-in user can then scan a clear sample receipt, compare every field with the source, choose the payment account and save after review. Scans use the owner's AI service credits.

Synthetic UI evidence is saved in ignored `artifacts/receipt-ai-owner-settings.png`, `artifacts/receipt-review-desktop.png` and `artifacts/receipt-review-mobile.png`. The app does not retain uploaded receipt images; only the reviewed transaction and its SHA-256 source fingerprint persist.
