import "server-only";
import sharp from "sharp";
import { detectReceiptMediaType, MAX_RECEIPT_BYTES } from "./receipt-scan";

export type GeminiReceiptMediaType = "image/png" | "image/jpeg" | "image/webp";
export const MAX_GEMINI_RECEIPT_PIXELS = 25_000_000;

export class ReceiptImageError extends Error {
  constructor(public readonly code: "invalid_image" | "image_too_large") {
    super(
      code === "image_too_large"
        ? "Use an image no larger than 5 MB and 25 megapixels."
        : "The image could not be read. Choose a valid PNG, JPEG or WebP image.",
    );
    this.name = "ReceiptImageError";
  }
}

/** Rebuild pixels in memory; sharp strips EXIF, XMP, ICC and other metadata by default. */
export async function prepareGeminiReceiptImage(
  bytes: Uint8Array,
  mediaType: GeminiReceiptMediaType,
): Promise<{ bytes: Buffer; mediaType: GeminiReceiptMediaType }> {
  if (bytes.byteLength > MAX_RECEIPT_BYTES)
    throw new ReceiptImageError("image_too_large");
  if (!bytes.byteLength || detectReceiptMediaType(bytes) !== mediaType)
    throw new ReceiptImageError("invalid_image");

  const input = Buffer.from(bytes);
  try {
    const image = sharp(input, {
      limitInputPixels: MAX_GEMINI_RECEIPT_PIXELS,
      failOn: "warning",
    }).autoOrient();
    const metadata = await image.metadata();
    const expectedFormat = {
      "image/png": "png",
      "image/jpeg": "jpeg",
      "image/webp": "webp",
    }[mediaType];
    if (metadata.format !== expectedFormat)
      throw new ReceiptImageError("invalid_image");

    const output = await (
      mediaType === "image/png"
        ? image.png({ compressionLevel: 9 })
        : mediaType === "image/jpeg"
          ? image.jpeg({ quality: 95 })
          : image.webp({ lossless: true, effort: 6 })
    ).toBuffer();
    if (output.byteLength > MAX_RECEIPT_BYTES) {
      output.fill(0);
      throw new ReceiptImageError("image_too_large");
    }
    return { bytes: output, mediaType };
  } catch (error) {
    if (error instanceof ReceiptImageError) throw error;
    // Recognize only sharp's fixed limit error; never expose decoder messages or input.
    throw new ReceiptImageError(
      error instanceof Error &&
        error.message === "Input image exceeds pixel limit"
        ? "image_too_large"
        : "invalid_image",
    );
  } finally {
    input.fill(0);
  }
}
