import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { detectReceiptMediaType, MAX_RECEIPT_BYTES } from "./receipt-scan";
import {
  MAX_GEMINI_RECEIPT_PIXELS,
  prepareGeminiReceiptImage,
  ReceiptImageError,
  type GeminiReceiptMediaType,
} from "./receipt-image";

vi.mock("server-only", () => ({}));

const identity = "SYNTHETIC-METADATA-IDENTITY-ONLY";
const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>${identity}</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`;

async function metadataFixture(mediaType: GeminiReceiptMediaType) {
  const image = sharp({
    create: { width: 64, height: 48, channels: 3, background: "#4668ad" },
  })
    .withExif({
      IFD0: { Artist: identity, Copyright: identity },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "1/1 2/1 3/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "4/1 5/1 6/1",
      },
    })
    .withXmp(xmp);
  return (
    mediaType === "image/png"
      ? image.png()
      : mediaType === "image/jpeg"
        ? image.jpeg({ quality: 95 })
        : image.webp({ lossless: true })
  ).toBuffer();
}

describe("Gemini receipt image metadata stripping", () => {
  it.each<GeminiReceiptMediaType>(["image/png", "image/jpeg", "image/webp"])(
    "removes real EXIF/GPS and XMP from synthetic %s while preserving its image",
    async (mediaType) => {
      const input = await metadataFixture(mediaType);
      const original = Buffer.from(input);
      const before = await sharp(input).metadata();
      expect(before.exif?.includes(Buffer.from(identity))).toBe(true);
      expect(before.xmp?.includes(Buffer.from(identity))).toBe(true);
      expect(input.includes(Buffer.from(identity))).toBe(true);

      const prepared = await prepareGeminiReceiptImage(input, mediaType);
      expect(prepared.mediaType).toBe(mediaType);
      expect(detectReceiptMediaType(prepared.bytes)).toBe(mediaType);
      const after = await sharp(prepared.bytes).metadata();
      expect(after).toMatchObject({
        width: 64,
        height: 48,
        format: before.format,
      });
      for (const field of [
        "exif",
        "xmp",
        "icc",
        "iptc",
        "orientation",
      ] as const)
        expect(after[field]).toBeUndefined();
      expect(prepared.bytes.includes(Buffer.from(identity))).toBe(false);
      expect(input.equals(original)).toBe(true);

      const inputPixels = await sharp(input).raw().toBuffer();
      const outputPixels = await sharp(prepared.bytes).raw().toBuffer();
      expect(outputPixels.length).toBe(inputPixels.length);
      if (mediaType === "image/jpeg") {
        const averageDifference =
          outputPixels.reduce(
            (sum, value, index) => sum + Math.abs(value - inputPixels[index]),
            0,
          ) / outputPixels.length;
        expect(averageDifference).toBeLessThan(3);
      } else expect(outputPixels.equals(inputPixels)).toBe(true);
    },
  );

  it("applies EXIF orientation to the pixels before removing the orientation tag", async () => {
    const input = await sharp({
      create: { width: 12, height: 7, channels: 3, background: "#fa5d32" },
    })
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const prepared = await prepareGeminiReceiptImage(input, "image/png");
    expect(await sharp(prepared.bytes).metadata()).toMatchObject({
      width: 7,
      height: 12,
    });
    expect(
      (await sharp(prepared.bytes).metadata()).orientation,
    ).toBeUndefined();
    const expectedPixels = await sharp(input).autoOrient().raw().toBuffer();
    expect(
      (await sharp(prepared.bytes).raw().toBuffer()).equals(expectedPixels),
    ).toBe(true);
  });

  it("rejects empty, mismatched and corrupt images with safe decoder-independent errors", async () => {
    const png = await metadataFixture("image/png");
    const corrupt = Buffer.concat([png.subarray(0, 16), Buffer.from(identity)]);
    for (const [input, mediaType] of [
      [Buffer.alloc(0), "image/png"],
      [png, "image/jpeg"],
      [corrupt, "image/png"],
    ] as const) {
      const error = await prepareGeminiReceiptImage(input, mediaType).catch(
        (issue) => issue,
      );
      expect(error).toBeInstanceOf(ReceiptImageError);
      expect(error.code).toBe("invalid_image");
      expect(error.message).not.toContain(identity);
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("rejects dimensions above 25 megapixels before pixel decoding", async () => {
    const input = await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    expect(5001 * 5000).toBeGreaterThan(MAX_GEMINI_RECEIPT_PIXELS);
    expect(input.length).toBeLessThan(MAX_RECEIPT_BYTES);
    await expect(
      prepareGeminiReceiptImage(input, "image/png"),
    ).rejects.toMatchObject({
      name: "ReceiptImageError",
      code: "image_too_large",
    });
  });

  it("rejects a valid input whose higher-quality re-encoding exceeds 5 MiB", async () => {
    const width = 3200;
    const height = 3200;
    const pixels = Buffer.alloc(width * height * 3);
    let state = 123456789;
    for (let index = 0; index < pixels.length; index++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[index] = state & 255;
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 50 })
      .toBuffer();
    expect(input.length).toBeLessThanOrEqual(MAX_RECEIPT_BYTES);
    await expect(
      prepareGeminiReceiptImage(input, "image/jpeg"),
    ).rejects.toMatchObject({
      name: "ReceiptImageError",
      code: "image_too_large",
    });
  }, 30_000);
});
