import { describe, expect, it } from "vitest";
import { validProductImageUrl } from "./product-image";

describe("catalog and POS product media URL safety", () => {
  it("allows optional empty URLs and bounded HTTP(S) links", () => {
    expect(validProductImageUrl("")).toBe(true);
    expect(validProductImageUrl("https://images.example.test/product.webp")).toBe(true);
    expect(validProductImageUrl("http://localhost:9000/photo.png")).toBe(true);
    expect(validProductImageUrl(" https://images.example.com/coffee.jpg ")).toBe(true);
  });

  it("rejects unsafe, invalid, and oversized image URLs", () => {
    expect(validProductImageUrl("javascript:alert(1)")).toBe(false);
    expect(validProductImageUrl("data:image/svg+xml;base64,xyz")).toBe(false);
    expect(validProductImageUrl("HTTPS://example.com/photo.png")).toBe(false);
    expect(validProductImageUrl("ftp://images.example.com/photo.png")).toBe(false);
    expect(validProductImageUrl("not-a-url")).toBe(false);
    expect(validProductImageUrl("https://example.com/" + "a".repeat(500))).toBe(false);
    expect(validProductImageUrl("https://example.test/" + "x".repeat(520))).toBe(false);
  });
});
