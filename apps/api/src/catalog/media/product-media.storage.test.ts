import { describe, expect, it, vi } from "vitest";
import { productMediaConfigFromEnv } from "./product-media-config";
import { productMediaObjectPath, SupabaseMediaStorage } from "./product-media.storage";
import { FakeProductMediaStorage } from "../../../test/support/fake-product-media.storage";

function cfg() {
  const value = productMediaConfigFromEnv({
    PRODUCT_MEDIA_ENABLED: "1",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "local-test-key",
    PRODUCT_MEDIA_BUCKET: "nexpos-product-media",
  });
  if (!value.enabled) throw new Error("Test requires media enabled");
  return value;
}

describe("product media object storage", () => {
  it("supports an isolated fake with immutable uploads and idempotent cleanup", async () => {
    const fake = new FakeProductMediaStorage();
    const key = productMediaObjectPath("b1", "p1");
    const payload = Buffer.from("test-photo");
    const stored = await fake.put(key, payload);
    expect(stored.url).toContain("nexpos-product-media/businesses/b1/products/p1/");
    expect(await fake.get(key)).toEqual(payload);
    await expect(fake.put(key, Buffer.from("replacement"))).rejects.toThrow("PRODUCT_MEDIA_ALREADY_EXISTS");
    await fake.remove(key);
    await fake.remove(key);
    expect(await fake.get(key)).toBeNull();
  });
  it("creates immutable scoped paths without accepting path traversal or user filenames", () => {
    const a = productMediaObjectPath("tenant_1", "product-1");
    const b = productMediaObjectPath("tenant_1", "product-1");
    expect(a).toMatch(/^businesses\/tenant_1\/products\/product-1\/[a-f\d-]{36}\.webp$/);
    expect(a).not.toBe(b);
    expect(() => productMediaObjectPath("../tenant_2", "product-1")).toThrow("PRODUCT_MEDIA_PATH");
    expect(() => productMediaObjectPath("tenant_1", "../../other")).toThrow("PRODUCT_MEDIA_PATH");
  });

  it("uploads WebP without upsert, returns only a public image URL, and removes safely", async () => {
    const upload = vi.fn(async (path: string) => ({ data: { path }, error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const from = vi.fn(() => ({
      upload,
      remove,
      getPublicUrl: (path: string) => ({
        data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/nexpos-product-media/" + path },
      }),
    }));
    const store = new SupabaseMediaStorage(cfg(), { storage: { from } } as never);
    const key = productMediaObjectPath("b1", "p1");
    const result = await store.put(key, Buffer.from("RIFF"));
    expect(result.url).toContain("nexpos-product-media/businesses/b1/products/p1/");
    expect(JSON.stringify(result)).not.toContain("local-test-key");
    expect(upload).toHaveBeenCalledWith(key, expect.any(Buffer), {
      contentType: "image/webp", cacheControl: "31536000", upsert: false,
    });
    await store.remove(key);
    expect(remove).toHaveBeenCalledWith([key]);
    expect(from).toHaveBeenCalledWith("nexpos-product-media");
  });

  it("does not expose a usable URL on upload error or invalid public URL", async () => {
    const errorClient = { storage: { from: () => ({
      upload: async () => ({ data: null, error: { message: "no storage" } }),
    }) } };
    await expect(new SupabaseMediaStorage(cfg(), errorClient as never)
      .put(productMediaObjectPath("b1", "p1"), Buffer.from("x"))).rejects.toThrow("PRODUCT_MEDIA_STORAGE");
    const unsafeClient = { storage: { from: () => ({
      upload: async (path: string) => ({ data: { path }, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "http://evil.invalid/picture" } }),
    }) } };
    await expect(new SupabaseMediaStorage(cfg(), unsafeClient as never)
      .put(productMediaObjectPath("b1", "p1"), Buffer.from("x"))).rejects.toThrow("PRODUCT_MEDIA_STORAGE");
  });

  it("rejects caller-selected or unscoped object keys before any network operation", async () => {
    const from = vi.fn();
    const store = new SupabaseMediaStorage(cfg(), { storage: { from } } as never);
    await expect(store.put("../../secret", Buffer.from("x"))).rejects.toThrow("PRODUCT_MEDIA_PATH");
    await expect(store.remove("invoices/123.pdf")).rejects.toThrow("PRODUCT_MEDIA_PATH");
    expect(from).not.toHaveBeenCalled();
  });
});
