# MoneyNest artwork sources

These three transparent PNG masters were generated on 16 October 2026 using the built-in image generation tool. The original reference mentioned in the brief was not attached. When asked for its location, the owner replied **“make image”**; these are new artwork, not a claimed reproduction of an unavailable original.

The existing Money NEST wordmark, perched bird and nest underline remain code/vector artwork in `src/components/brand-lockup.tsx`. They were reused rather than regenerated. The older `public/brand/panda-money-bag.svg` is preserved unchanged; active website and bot surfaces use the distinct new exports.

| Master | Use | Generated export |
| --- | --- | --- |
| `moneynest-mascot.png` | Website panda hugging ₹ bag, with botanical accent | `public/brand/moneynest-mascot.webp` |
| `moneynest-app-art.png` | Simplified panda upper body and ₹ bag | `public/icon.svg`, app PNGs, maskable PNG, Apple PNG, ICO |
| `nestbot-icon.png` | Panda head with green headset and microphone | `public/brand/nestbot-icon.webp` |

Run `node scripts/generate-brand-assets.mjs` to regenerate the eight optimized public exports, or add `--check` to detect stale/missing outputs. PNG masters are retained unchanged. The SVG app export embeds raster artwork and is not represented as a vector illustration.

## Final prompt set

### Website mascot — new generation, transparent background

Use case: logo-brand. Asset type: MoneyNest website panda mascot, transparent cutout, standalone illustration ONLY, no wordmark, no page mockup. Create a polished professional flat vector-style brand illustration of an irresistibly friendly black-and-white panda hugging a soft mint green drawstring money bag bearing one unmistakable Indian rupee symbol ₹ (NOT a dollar sign). Rounded balanced silhouette, slightly tilted oversized panda head, small rounded charcoal ears, warm expressive crescent smiling eyes inside charcoal eye patches, tiny heart-like black nose and cheerful smile. Panda sits with two rounded charcoal paws/feet, arms visibly hugging the bag on its right side. Elegant restrained botanical sprig on far left. Favor clean smooth contours, confident tasteful shapes and gentle limited shading, NO photorealism, NO 3D rendering, NO busy tiny textures. Palette: panda charcoal #263139, warm white, deep teal #155E50, emerald #0F8A65, mint #A7E3C8, minimal soft green accents. Fully visible centered mascot, tight intentional bounding silhouette, modest 5% clear margin, no clipped ears/feet/sprig. Transparent background, no white square, no sticker border, no letters/words except the clear ₹ on the bag, no decorative text, no watermark. Must read as a cute high-quality trustworthy personal finance brand at 40px.

### App mascot — website master as identity reference, transparent background

Use case: logo-brand, identity-preserve variant. Input image is the new MoneyNest panda mascot reference. Create a dedicated app-launcher mascot using this SAME friendly panda identity and drawing style: recognizable rounded black-and-white panda head, friendly smiling eyes, tiny black nose, two charcoal arms hugging a large soft mint-green money bag at chest height. The bag bears one clear Indian rupee symbol ₹, never a dollar sign. Close, balanced upper-body composition; simplified silhouette and restrained gentle shading for legibility at 48px. No full body feet, no botanical sprig, no wordmark, no bird, no nest underline, no headset, no chat bubble, no extra text. Pale mint/emerald bag, charcoal #263139, warm white, teal #155E50. Isolated on a truly TRANSPARENT background; centered with 5% clear border, full ears and bag visible. This will be composited on an opaque mint square separately, so do not include a square/background/rounded icon frame, do not draw a phone mockup. Deliver only the panda-with-bag upper body cutout.

### NestBot — website master as identity reference, transparent background

Use case: logo-brand, identity-preserve variant. Input image is the MoneyNest panda mascot REFERENCE only. Create the distinct NestBot assistant identity related to this SAME friendly panda: a rounded white panda head with two small charcoal ears, expressive friendly open eyes inside soft charcoal eye patches, tiny heart-like black nose and approachable smiling mouth. Give it a clearly recognizable simple emerald-green headset with a tiny teal microphone ending near the cheek. A small mint speech bubble beside the ear may communicate assistance. Clean bold rounded logo shapes, very minimal details, restrained subtle shading matching the reference. Must be perfectly readable at 24–48px. Palette charcoal #263139, white, teal #155E50, emerald #0F8A65, mint #A7E3C8. NO money bag, NO rupee symbol, NO body, NO wordmark, NO text, NO botanical sprigs, NO bird, NO nest underline, NO robot antenna. This is a friendly PANDA assistant, visibly different from the MoneyNest finance app icon. Tight centered head-and-headset cutout on a genuinely TRANSPARENT background, full ears and microphone visible, modest 5% clear margin, no square or app-icon frame, no watermark.
