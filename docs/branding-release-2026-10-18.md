# Panda branding release — 18 October 2026

The owner explicitly requested deployment of the logo update after the preceding main release. This authorizes releasing PR #2 and supersedes its earlier draft approval hold. Its original artwork and 16 October audit remain historical evidence; no artwork was regenerated for this integration.

## Integration with current main

Merged main at `8892729` into the branding branch. Retained current signup/OTP/public access handlers, account carousels and compact summaries, Profile layout, and the single controlled Radix NestBot with its focus restoration and receipt handoff. Conflicts were resolved by retaining the current implementations and applying only branding changes.

The shared website logo now uses the panda with a rupee bag, preserving the Money NEST wordmark, bird and nest. Loading/private/404 surfaces use the shared artwork, and the newer login illustration uses the same website mascot. NestBot uses its separate headset panda in the current header and assistant/loading messages. The chat keeps its current controls and viewport behavior, with a visible white keyboard focus ring on teal.

Ordinary app icons, the safe-area maskable icon, Apple icon and favicon come from the existing dedicated app artwork. Metadata uses revisioned icon URLs, consistent teal theme colors and the existing `/dashboard` installation identity. Financial calculations, APIs, auth handlers/provider, database files, dependencies and deployment configuration have no diff from main.

## Verification of the combined source

Checks used a credentials-free source copy on the E drive, the existing locked dependencies and a separate production server on port 3204. No private files or environment configuration were copied. Browser routes supplied synthetic workspace/chat responses and blocked external requests and workspace writes.

| Check | Result |
| --- | --- |
| Production build (`next build --webpack`) | Passed |
| Full ESLint | Passed |
| Standalone TypeScript | Passed |
| Unit/database tests | 1,003 passed across 43 files |
| Deterministic artwork export check | All eight exports match their masters |
| Scoped branding browser tests | 17/17 passed in the final complete run |
| Widths | 320, 375, 390, 430, 768, 1024 and 1440 CSS pixels |

Browser checks cover asset decoding, full wordmark/bird/nest, no horizontal overflow, current navigation, financial dialog close/focus behavior, access/recovery/private/404/loading surfaces, manifest metadata and Chromium parsing. Mocked NestBot checks cover distinct header/message/loading/error avatars, keyboard focus, Escape restoration and receipt editor/scanner handoff. No real provider or financial write was invoked. Representative mobile/desktop dashboard, bot and app icon images were visually inspected.

The first adapted browser run passed 15 cases and failed two because the spending button's old accessible label had changed on main. Only the test selector was corrected; all 17 then passed together. The old floating/minimized/unavailable-panel screenshots in `branding-review/` do not represent the current consolidated NestBot.

Raw logs and current synthetic browser captures are retained in the ignored local `artifacts/branding-release/` directory. Fresh Android/iOS installation and operating-system refresh of an existing home-screen icon remain manual device checks. Public deployment asset checks cannot certify those device behaviors; see [icon refresh guidance](branding-icon-refresh.md).
