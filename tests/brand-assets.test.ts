import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(root, "public");
const asset = (name: string) => readFile(path.join(publicRoot, name));
const pixels = (input: Buffer) => sharp(input).ensureAlpha().raw().toBuffer();

describe("MoneyNest app icon exports", () => {
  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
    ["apple-touch-icon.png", 180],
  ] as const)("%s is a real, opaque %dpx PNG", async (name, size) => {
    const buffer = await asset(name);
    const metadata = await sharp(buffer).metadata();
    expect(metadata).toMatchObject({ format: "png", width: size, height: size });
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let offset = 3; offset < data.length; offset += info.channels) {
      if (data[offset] !== 255) throw new Error(`${name} has a transparent pixel at ${offset}`);
    }
  });

  it("uses the same panda master for the ordinary PNG, SVG and Apple exports", async () => {
    const icon = await asset("icon-512.png");
    for (const [name, size] of [["icon-192.png", 192], ["apple-touch-icon.png", 180]] as const) {
      expect(await pixels(await asset(name))).toEqual(await pixels(await sharp(icon).resize(size, size).png().toBuffer()));
    }
    const svg = (await asset("icon.svg")).toString("utf8");
    const embedded = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
    expect(embedded, "SVG must be self-contained and embed the current icon").not.toBeNull();
    expect(Buffer.from(embedded![1], "base64")).toEqual(icon);
    expect(svg).not.toMatch(/href="https?:|<text\b/);
    expect(await sharp(Buffer.from(svg)).metadata()).toMatchObject({ format: "svg", width: 512, height: 512 });
  });

  it("keeps every maskable foreground pixel inside the guaranteed central safe circle", async () => {
    const { data, info } = await sharp(await asset("icon-maskable-512.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const radius = 0.4 * Math.min(info.width, info.height);
    let foreground = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        const background = data[offset] === 167 && data[offset + 1] === 227 && data[offset + 2] === 200;
        if (background) continue;
        foreground++;
        const distance = Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2);
        if (distance > radius) throw new Error(`Maskable artwork can be cropped at (${x}, ${y})`);
      }
    }
    expect(foreground, "The safe icon must contain visible artwork").toBeGreaterThan(5000);
  });

  it("contains valid 16px, 32px and 48px ICO frames matching the panda PNG", async () => {
    const ico = await asset("favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    const icon = await asset("icon-512.png");
    for (const [index, size] of [16, 32, 48].entries()) {
      const directory = 6 + index * 16;
      expect(ico[directory]).toBe(size);
      expect(ico[directory + 1]).toBe(size);
      expect(ico.readUInt16LE(directory + 4)).toBe(1);
      expect(ico.readUInt16LE(directory + 6)).toBe(32);
      const length = ico.readUInt32LE(directory + 8);
      const offset = ico.readUInt32LE(directory + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      const frame = ico.subarray(offset, offset + length);
      expect(await sharp(frame).metadata()).toMatchObject({ format: "png", width: size, height: size, channels: 4 });
      expect(await pixels(frame)).toEqual(await pixels(await sharp(icon).resize(size, size).png().toBuffer()));
    }
  });

  it("resolves every declared manifest icon with accurate dimensions and separate purposes", async () => {
    const manifest = JSON.parse((await asset("manifest.webmanifest")).toString("utf8")) as {
      id: string; start_url: string; scope: string; display: string;
      theme_color: string; background_color: string;
      icons: { src: string; sizes: string; type: string; purpose: string }[];
    };
    expect(manifest).toMatchObject({
      id: "/dashboard", start_url: "/dashboard", scope: "/", display: "standalone",
      theme_color: "#155E50", background_color: "#F7FAF8",
    });
    expect(manifest.icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
    expect(manifest.icons.filter((icon) => icon.purpose === "any")).toHaveLength(3);
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, "https://moneynest.test");
      expect(url.origin).toBe("https://moneynest.test");
      expect(url.searchParams.get("v")).toBe("brand-v2");
      const metadata = await sharp(await asset(url.pathname.slice(1))).metadata();
      if (icon.type === "image/png") {
        expect(metadata.format).toBe("png");
        expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes);
      } else {
        expect(icon.type).toBe("image/svg+xml");
        expect(metadata.format).toBe("svg");
        expect(icon.sizes).toBe("any");
      }
    }
  });

  it("exports separate optimized website and assistant artwork with transparent backgrounds", async () => {
    const mascot = await asset("brand/moneynest-mascot.webp");
    const bot = await asset("brand/nestbot-icon.webp");
    expect(mascot.equals(bot)).toBe(false);
    expect(await sharp(mascot).metadata()).toMatchObject({ format: "webp", height: 256, hasAlpha: true });
    const botMetadata = await sharp(bot).metadata();
    expect(botMetadata.format).toBe("webp");
    expect(botMetadata.hasAlpha).toBe(true);
    expect(Math.max(botMetadata.width!, botMetadata.height!)).toBe(192);
    expect(mascot.length).toBeLessThan(100_000);
    expect(bot.length).toBeLessThan(100_000);
  });
});
