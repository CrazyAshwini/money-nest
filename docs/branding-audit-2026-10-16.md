# MoneyNest branding audit — 16 October 2026

## Audit before changes

Reviewed `main` at `8805c28`, the existing assets/components/generator, metadata and live public icon responses. PR [#1](https://github.com/CrazyAshwini/money-nest/pull/1) was merged on 15 October; its remote branch has no unmerged commits against current main. The open-PR search returned no results. Work is isolated on the follow-up `codex/branding-refinement` branch.

The text brief did not include the original logo image. A focused repository/branding-package search did not locate it. The owner answered the reference question with “make image,” so three new related panda illustrations were generated. No claim is made that they exactly reproduce the missing original. See [artwork provenance and prompts](../design/brand/README.md).

| Requirement | Initial status | Necessary action |
| --- | --- | --- |
| Main website logo | NEEDS IMPROVEMENT | Reuse shared lockup; replace the inaccurate panda artwork and remaining M brand headers. |
| Panda mascot | NEEDS IMPROVEMENT | Existing bag mark was dollar-like; create friendly panda artwork with clear ₹. |
| Money NEST wordmark | COMPLETE | Preserve existing charcoal/green text and proportions. |
| Bird and nest details | COMPLETE | Preserve existing vector decorations. |
| Installed PWA icon | NEEDS IMPROVEMENT | SVG was panda, but deployed PNG/Apple assets remained M; maskable icon was missing. |
| NestBot icon | MISSING | Main mascot was reused in one flow; actual floating chat used a generic robot and lacked message avatars. |
| Desktop branding | NEEDS IMPROVEMENT | Sidebar shared component existed; auth/private/loading/404 brand surfaces retained M. |
| Mobile branding | UNVERIFIED | Responsive rules existed; verify all seven requested widths before changing sizing. |
| Favicon and app metadata | NEEDS IMPROVEMENT | Old M favicon, incomplete generation and inconsistent manifest/document theme colors. |

Existing navigation links, wordmark/bird/nest markup, financial logic, account records, auth, database schema, backend calls and NestBot interaction/availability handlers were not redesigned. The header's existing unavailable panel and the separate floating chat remain their existing behaviors.

## Implemented scope

- `BrandLogo` refines the existing component; the `BrandLockup` alias preserves its current consumers. `AppBrandIcon` supplies loading artwork; `NestBotAvatar` uses its own headset panda and honors requested size.
- Shared login/private/404 headers now use the full logo. Actual floating chat, header and assistant/loading message rows use the dedicated bot identity. A local teal CSS token fixes the previously undefined chat color while keeping handlers intact.
- One deterministic Sharp generator produces current app/Apple/ICO/maskable exports, plus optimized transparent website and bot WebPs. Source PNGs are immutable. The app SVG is an explicitly documented self-contained raster wrapper.
- Manifest identity remains `/dashboard`; icon revision queries refresh browser resource URLs without changing install identity. Theme colors agree. Refresh/reinstall instructions avoid recommending deletion of site data.

## Verification

The credentials-free production build, standalone TypeScript check, full ESLint run, all **729 unit/database tests across 36 files**, and deterministic generator `--check` passed. Nine asset tests cover real formats/dimensions, opaque backgrounds, consistent ICO/PNG/SVG artwork, distinct transparent WebPs, manifest purposes and the entire maskable safe circle. A scoped white keyboard focus ring was added after review found weak contrast against the new teal chat header. The final production build, full lint and standalone typecheck also passed after that fix.

The final browser run passed **17 tests (18.8 seconds)** on the final production build. It decoded the actual served assets, checked no horizontal overflow at 320/375/390/430/768/1024/1440px, exercised the preserved unavailable panel and mocked floating chat, checked all four financial card dialogs and focus restoration, and covered login/recovery/private access/404/loading/metadata. Browser API responses contained synthetic records; all outgoing external requests and workspace writes were blocked. Dark-preference tests at 390px and 1440px used real Tab navigation to Minimize and Close, verified the white focus ring and closed the chat with Enter. Chromium parsed the served manifest without errors. The screenshots and their scope are indexed in [branding-review](branding-review/README.md).

Visual inspection of all seven dashboard widths, the 320px drawer, mobile chat and 512px app icon confirmed recognizable, uncropped artwork and preserved wordmark/bird/nest placement. The product explicitly keeps its existing light color scheme; dark system preference is checked without adding a new theme. Chat header white text on `#155E50` has a calculated contrast ratio of **7.64:1**. The logo's charcoal and green text remain on the existing light surfaces.

An initial build in the C-drive managed worktree failed because its E-drive dependency junction produced invalid cross-drive Webpack paths. Verification therefore uses a credentials-free E-drive source copy beside the same locked dependencies. No production settings or application configuration were changed to work around that environment issue.

Fresh Android/iOS home-screen installation and OS icon refresh are separate device checks. Asset decoding, manifest validation and screenshots do not by themselves prove that an installed OS icon was updated. No owner finance records or real AI calls are used for browser verification.

| Requirement | Initial status | Action taken | Final verification |
| --- | --- | --- | --- |
| Main website logo | NEEDS IMPROVEMENT | Reused lockup, replaced mascot and remaining M headers. | Shared full logo decodes and fits tested layouts. |
| Panda mascot | NEEDS IMPROVEMENT | New smiling panda hugging a clear ₹ bag. | Generated master and optimized export visually inspected. |
| Money NEST wordmark | COMPLETE | Skipped; retained existing text/styles. | Visible and unclipped at all seven widths. |
| Bird and nest details | COMPLETE | Skipped; retained existing vector markup. | Present in screenshots and hidden from assistive technology. |
| Installed PWA icon | NEEDS IMPROVEMENT | Dedicated art, ordinary/maskable/Apple/ICO exports. | Asset/manifest checks pass; fresh Android/iOS installation remains UNVERIFIED. |
| NestBot icon | MISSING | Dedicated headset panda in genuine assistant surfaces. | Both entry points, mocked messages and keyboard controls pass. |
| Desktop branding | NEEDS IMPROVEMENT | Shared headers and app loading artwork. | Sidebar/access/404 tested; desktop screenshots inspected. |
| Mobile branding | UNVERIFIED | Reused responsive sizing; no unnecessary layout rewrite. | 320/375/390/430px header/drawer and chat checks pass. |
| Favicon and app metadata | NEEDS IMPROVEMENT | Regenerated matching exports and revision URLs/colors. | Decoding, ICO frames, served metadata and Chromium parser pass. |

## Changed-file map

| Files | Change and purpose |
| --- | --- |
| `.gitattributes` | Preserve generated SVG bytes across Windows Git checkouts for reproducible `--check`. |
| `design/brand/moneynest-mascot.png` | New immutable website panda master. |
| `design/brand/moneynest-app-art.png` | New immutable app-specific upper-body panda master. |
| `design/brand/nestbot-icon.png` | New immutable headset panda master. |
| `design/brand/README.md` | Artwork provenance, exact prompts and master/export mapping. |
| `public/brand/moneynest-mascot.webp` | Optimized transparent website mascot. |
| `public/brand/nestbot-icon.webp` | Separate optimized assistant avatar. |
| `public/icon.svg` | Self-contained raster wrapper of the app artwork. |
| `public/icon-192.png`, `public/icon-512.png` | Opaque ordinary launcher exports, replacing stale M artwork. |
| `public/icon-maskable-512.png` | New padded opaque safe-area launcher export. |
| `public/apple-touch-icon.png` | Matching 180px Apple icon. |
| `public/favicon.ico` | Matching 16/32/48px PNG frames. |
| `public/manifest.webmanifest` | Correct icon purposes, revision URLs, consistent colors, preserved app identity. |
| `scripts/generate-brand-assets.mjs` | Deterministic Sharp export/check pipeline from immutable masters. |
| `src/app/layout.tsx` | Matching favicon/Apple references and viewport theme color. |
| `src/app/not-found.tsx` | Existing home link uses shared full logo. |
| `src/components/brand-lockup.tsx` | Reusable `BrandLogo`, compatibility alias, `AppBrandIcon`, distinct `NestBotAvatar`. |
| `src/components/brand-lockup.css` | Preserve avatar size prop; shared app artwork and 404 alignment. |
| `src/components/finance-app.tsx` | Shared mobile logo and loading artwork only. |
| `src/components/workspace-pages.tsx` | Shared full logo in desktop/mobile access headers. |
| `src/components/private-profile.tsx` | Shared full logo in private access header. |
| `src/components/nestbot.tsx` | Assistant imagery in launcher/header/bot message rows; handlers unchanged. |
| `src/components/nestbot.css` | Defined scoped teal color, avatar spacing, readable header and keyboard focus. |
| `tests/brand-assets.test.ts` | Nine independent asset regressions. |
| `playwright.branding.config.ts` | Separate production test port, fixtures/private/backends disabled, no server reuse. |
| `tests/branding-e2e/brand.spec.ts` | Synthetic browser/layout/metadata/keyboard regression coverage. |
| `docs/branding-icon-refresh.md` | Generator, safe area, cache/refresh guidance and device verification limits. |
| `docs/branding-audit-2026-10-16.md` | This audit, classification, results and changed-file map. |
| `docs/branding-review/` | Synthetic desktop/mobile screenshots for review. |
| `docs/project-context.md` | Link this branding-only review and retain its deployment/device limitations. |

## Release status

Prepared as a follow-up review branch. The owner explicitly requires approval before merging or deploying this branding update to production. Existing installed-device icon verification remains a release check; this report does not certify it.
