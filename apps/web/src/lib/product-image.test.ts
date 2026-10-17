import { describe, expect, it } from "vitest";
import { validProductImageUrl } from "./product-image";

describe("POS product media URL safety", () => {
  it("only allows bounded HTTP(S) URLs for display", () => {
    expect(validProductImageUrl("https://images.example.test/product.webp")).toBe(true);
    expect(validProductImageUrl("http://localhost:9000/photo.png")).toBe(true);
    expect(validProductImageUrl("javascript:alert(1)")).toBe(false);
    expect(validProductImageUrl("data:image/svg+xml;base64,xyz")).toBe(false);
    expect(validProductImageUrl("https://example.test/" + "x".repeat(520))).toBe(false);
  });
});
