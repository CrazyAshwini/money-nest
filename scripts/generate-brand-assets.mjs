import { readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const designRoot = path.join(root, "design", "brand");
const mint = "#A7E3C8";

async function trimmedArtwork(name) {
  const art = await readFile(path.join(designRoot, name));
  const { data, info } = await sharp(art).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let transparent = false;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha < 255) transparent = true;
      if (alpha === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (!transparent || right < left || bottom < top) {
    throw new Error(`${name} must contain visible artwork on a transparent background.`);
  }
  return sharp(art)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}

/** One transparent panda cutout supplies every app, browser and Apple icon. */
async function buildAssets() {
  const trimmed = await trimmedArtwork("moneynest-app-art.png");
  const canvas = async (size, artworkFraction) => {
    const edge = Math.floor(size * artworkFraction);
    const artwork = await sharp(trimmed).resize(edge, edge, { fit: "inside" }).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 3, background: mint } })
      .composite([{ input: artwork, gravity: "centre" }])
      .removeAlpha()
      .png()
      .toBuffer();
  };

  const master = await canvas(1024, 0.86);
  const icon = await sharp(master).resize(512, 512).png().toBuffer();
  const resize = (size) => sharp(icon).resize(size, size).png().toBuffer();
  // A 56% bounding square fits entirely inside the guaranteed safe circle:
  // 0.56 * sqrt(2) / 2 < 0.40. The background stays fully opaque to every edge.
  const maskable = await canvas(512, 0.56);
  const frames = await Promise.all([16, 32, 48].map(async (size) => ({
    size,
    png: await sharp(icon).resize(size, size).ensureAlpha().png().toBuffer(),
  })));
  const directory = Buffer.alloc(6 + 16 * frames.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  frames.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  const mascot = await sharp(await trimmedArtwork("moneynest-mascot.png"))
    .resize({ height: 256, withoutEnlargement: true })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
  const bot = await sharp(await trimmedArtwork("nestbot-icon.png"))
    .resize(192, 192, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
  return new Map([
    ["brand/moneynest-mascot.webp", mascot],
    ["brand/nestbot-icon.webp", bot],
    ["icon-512.png", icon],
    ["icon-192.png", await resize(192)],
    ["apple-touch-icon.png", await resize(180)],
    ["icon-maskable-512.png", maskable],
    ["favicon.ico", Buffer.concat([directory, ...frames.map(({ png }) => png)])],
    ["icon.svg", Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>MoneyNest app icon</title><!-- Self-contained raster artwork; this wrapper is not vector artwork. --><image width="512" height="512" href="data:image/png;base64,${icon.toString("base64")}"/></svg>\n`,
    )],
  ]);
}

const assets = await buildAssets();
if (process.argv.includes("--check")) {
  const mismatches = [];
  for (const [name, expected] of assets) {
    const saved = await readFile(path.join(publicRoot, name)).catch(() => null);
    if (!saved?.equals(expected)) mismatches.push(name);
  }
  if (mismatches.length) throw new Error(`Stale or missing brand exports: ${mismatches.join(", ")}. Run node scripts/generate-brand-assets.mjs.`);
  process.stdout.write(`Verified ${assets.size} brand exports against design/brand masters.\n`);
} else {
  for (const [name, buffer] of assets) await writeFile(path.join(publicRoot, name), buffer);
  process.stdout.write(`Generated ${assets.size} brand exports from design/brand masters.\n`);
}
