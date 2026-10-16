# MoneyNest app icons

The app icon uses a panda with a rupee money bag on an opaque soft mint background. It is separate from the website wordmark and the NestBot assistant mascot.

## Master artwork and exports

`design/brand/moneynest-app-art.png` is the immutable transparent source illustration. The generator trims transparent margins in memory and creates the 192px/512px app PNGs, the 180px Apple icon, and the 16px/32px/48px embedded PNG frames inside `favicon.ico`. It also exports alpha-trimmed, quality-92 WebP files for the separate website mascot (256px high) and NestBot assistant (up to 192px), from their own immutable PNG masters in `design/brand/`. The masters are never modified by generation.

```text
node scripts/generate-brand-assets.mjs
node scripts/generate-brand-assets.mjs --check
```

`public/icon.svg` is a self-contained SVG wrapper embedding the generated 512px PNG. It preserves the raster artwork; it is **not a true vector illustration**. It needs no remote images or fonts. Every ordinary icon export comes from the same rendered master, so the browser, Apple and installed-app icons keep the same panda identity. The supplied original logo reference was unavailable for this implementation; these are newly generated panda illustrations, not a verified reproduction of that reference.

The separate maskable PNG has an opaque background all the way to its edges. Its artwork fits within a centered square no larger than 56% of the icon width. This keeps every part of the panda inside the central circle with radius 40% of the icon width, the [manifest specification's guaranteed safe area](https://www.w3.org/TR/appmanifest/#icon-masks). The manifest declares ordinary icons as `any` and the dedicated padded icon as `maskable`.

The manifest keeps `/dashboard` as both its explicit identity and start URL. `/dashboard` was also the implicit identity before this change; changing it to `/` could create a separate installed app. The icon URLs use `?v=brand-v2`, and the document and manifest share the deep teal theme color `#155E50`. Increase the icon revision in both files when replacing the artwork again.

## Refreshing an existing icon

After the reviewed branding release is deployed:

1. Open MoneyNest in the browser while online and reload it. Close and reopen the installed app. A browser may update its stored app icon on its own schedule.
2. If the home-screen icon still shows the old green M, remove that installed app or home-screen shortcut, revisit MoneyNest in the browser, and choose **Install app** or **Add to Home Screen** again. On iPhone/iPad, use Safari's Share menu and **Add to Home Screen**.
3. Avoid clearing site storage as an icon-refresh step. It can sign you out or remove browser-held preferences. Uninstall/shortcut-removal dialogs differ by browser and operating system; leave any option to delete site data unchecked unless you intend to remove it.

The website has no service worker or custom offline cache. Icon resources are served with normal HTTP revalidation; installed-app icons can also be retained by the browser or operating system separately. Adding a service worker is not needed for this branding change. [Chrome supports installation from its menu without a service-worker fetch handler](https://developer.chrome.com/blog/update-install-criteria).

## Verification scope

The static asset tests check declared dimensions and formats, opaque backgrounds, PNG/ICO/SVG consistency, and the maskable safe area. Browser checks must also verify the rendered metadata, public asset responses and the visual result at mobile and desktop sizes. A successful asset check does not establish that Android or iOS has refreshed an existing installed icon. Fresh installation and existing-install refresh remain manual device checks unless explicitly recorded in the release verification.
