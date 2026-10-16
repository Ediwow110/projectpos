import sharp from "sharp";
import { PRODUCT_MEDIA_MIME_TYPES, PRODUCT_MEDIA_SOURCE_MAX_BYTES } from "./product-media-config";

const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 1600;
const MAX_WEBP_BYTES = 1024 * 1024;
const ALLOWED_FORMAT: Record<string, string> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp",
};

export interface ProductImageUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface NormalizedProductImage {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  bytes: number;
}

/** Enforces decoded format and pixel limits, and strips image metadata on WebP re-encode. */
export async function normalizeProductImage(input: ProductImageUpload): Promise<NormalizedProductImage> {
  if (!PRODUCT_MEDIA_MIME_TYPES.includes(input.mimetype as typeof PRODUCT_MEDIA_MIME_TYPES[number])) {
    throw new Error("PRODUCT_IMAGE_UNSUPPORTED");
  }
  if (input.size > PRODUCT_MEDIA_SOURCE_MAX_BYTES || input.buffer.byteLength > PRODUCT_MEDIA_SOURCE_MAX_BYTES) {
    throw new Error("PRODUCT_IMAGE_TOO_LARGE");
  }
  if (!input.size || !Number.isSafeInteger(input.size) || input.size !== input.buffer.byteLength) {
    throw new Error("PRODUCT_IMAGE_INVALID");
  }
  try {
    const image = sharp(input.buffer, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false });
    const meta = await image.metadata();
    if (meta.format !== ALLOWED_FORMAT[input.mimetype] || !meta.width || !meta.height ||
      meta.width * meta.height > MAX_PIXELS || meta.pages && meta.pages > 1) {
      throw new Error("PRODUCT_IMAGE_INVALID");
    }
    const result = await image
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > MAX_WEBP_BYTES) throw new Error("PRODUCT_IMAGE_TOO_LARGE");
    return {
      buffer: result.data,
      contentType: "image/webp",
      width: result.info.width,
      height: result.info.height,
      bytes: result.data.length,
    };
  } catch (err) {
    if (err instanceof Error && ["PRODUCT_IMAGE_INVALID", "PRODUCT_IMAGE_TOO_LARGE"].includes(err.message)) throw err;
    throw new Error("PRODUCT_IMAGE_INVALID");
  }
}
