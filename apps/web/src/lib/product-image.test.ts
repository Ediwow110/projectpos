import { describe, expect, it } from "vitest";
import { validProductImageUrl } from "./product-image";

describe("catalog image URL", () => {
  it("accepts an empty optional field and HTTP(S) image links", () => {
    expect(validProductImageUrl("")).toBe(true);
    expect(validProductImageUrl(" https://images.example.com/coffee.jpg ")).toBe(true);
    expect(validProductImageUrl("http://localhost:9000/photo.png")).toBe(true);
  });

  it("rejects unsafe, invalid, and oversized image URLs", () => {
    expect(validProductImageUrl("javascript:alert(1)")).toBe(false);
    expect(validProductImageUrl("HTTPS://example.com/photo.png")).toBe(false);
    expect(validProductImageUrl("ftp://images.example.com/photo.png")).toBe(false);
    expect(validProductImageUrl("not-a-url")).toBe(false);
    expect(validProductImageUrl("https://example.com/" + "a".repeat(500))).toBe(false);
  });
});
