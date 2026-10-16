import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeProductImage } from "./product-image-validation";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "base64",
);

describe("product image upload normalization", () => {
  it("turns a valid PNG into small metadata-free WebP bytes", async () => {
    const out = await normalizeProductImage({ buffer: png, size: png.byteLength, mimetype: "image/png" });
    expect(out.contentType).toBe("image/webp");
    expect(out.buffer.subarray(0, 4).toString()).toBe("RIFF");
    expect(out.buffer.subarray(8, 12).toString()).toBe("WEBP");
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.bytes).toBeLessThanOrEqual(1024 * 1024);
  });

  it("rejects HTML and SVG, including forged JPEG MIME", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(normalizeProductImage({ buffer: svg, size: svg.length, mimetype: "image/jpeg" })).rejects.toThrow("PRODUCT_IMAGE_INVALID");
    await expect(normalizeProductImage({ buffer: svg, size: svg.length, mimetype: "image/svg+xml" })).rejects.toThrow("PRODUCT_IMAGE_UNSUPPORTED");
  });

  it("rejects incompatible declared content types and corrupted bytes", async () => {
    await expect(normalizeProductImage({ buffer: png, size: png.length, mimetype: "image/jpeg" })).rejects.toThrow("PRODUCT_IMAGE_INVALID");
    const corrupt = Buffer.from("not an image");
    await expect(normalizeProductImage({ buffer: corrupt, size: corrupt.length, mimetype: "image/png" })).rejects.toThrow("PRODUCT_IMAGE_INVALID");
  });

  it("rejects empty, over-limit and inconsistent upload sizes before decoding", async () => {
    await expect(normalizeProductImage({ buffer: Buffer.alloc(0), size: 0, mimetype: "image/png" })).rejects.toThrow("PRODUCT_IMAGE_INVALID");
    await expect(normalizeProductImage({ buffer: Buffer.alloc(3 * 1024 * 1024 + 1), size: 3 * 1024 * 1024 + 1, mimetype: "image/png" })).rejects.toThrow("PRODUCT_IMAGE_TOO_LARGE");
    await expect(normalizeProductImage({ buffer: png, size: png.length + 1, mimetype: "image/png" })).rejects.toThrow("PRODUCT_IMAGE_INVALID");
  });

  it("accepts real JPEG and WebP uploads and strips encoded metadata", async () => {
    for (const [mimetype, input] of [
      ["image/jpeg", await sharp(png).jpeg().toBuffer()],
      ["image/webp", await sharp(png).webp().toBuffer()],
    ] as const) {
      const image = await normalizeProductImage({ buffer: input, size: input.length, mimetype });
      const decoded = await sharp(image.buffer).metadata();
      expect(decoded.format).toBe("webp");
      expect(decoded.exif).toBeUndefined();
      expect(decoded.icc).toBeUndefined();
    }
  });

  it("resizes a large valid image without enlarging or leaking the original", async () => {
    const image = await sharp({create: {width: 2400, height: 1600, channels: 3, background: "#123456"}}).png().toBuffer();
    const normalized = await normalizeProductImage({ buffer: image, size: image.length, mimetype: "image/png" });
    expect(normalized.width).toBe(1600);
    expect(normalized.height).toBeLessThanOrEqual(1600);
    expect(normalized.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024);
  });
});
