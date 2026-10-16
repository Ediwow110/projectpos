import { describe, expect, it } from "vitest";
import { assertOwnerMediaWrite, productMediaConfigFromEnv } from "./product-media-config";
import type { RequestAuth } from "../../common/request-context";

function identity(role: string, via?: string): RequestAuth & { via?: string } {
  return {
    userId: "u1", businessId: "b1", sessionId: "s1", role,
    activeBranchId: null, authenticatedAt: new Date(),
    ...(via ? { via } : {}),
  };
}

describe("product image media configuration", () => {
  it("defaults to disabled without requiring secrets and reveals no credentials", () => {
    expect(productMediaConfigFromEnv({})).toEqual({
      enabled: false, maxSourceBytes: 3 * 1024 * 1024,
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
  });

  it("fails closed on an enabled but partially configured storage provider", () => {
    expect(() => productMediaConfigFromEnv({ PRODUCT_MEDIA_ENABLED: "1" })).toThrow("PRODUCT_MEDIA_CONFIG");
    expect(() => productMediaConfigFromEnv({
      PRODUCT_MEDIA_ENABLED: "1", SUPABASE_URL: "http://local.invalid",
      SUPABASE_SECRET_KEY: "secret",
      PRODUCT_MEDIA_BUCKET: "nexpos-product-media",
    })).toThrow("PRODUCT_MEDIA_CONFIG");
  });

  it("accepts complete server-only storage settings and never returns them in capabilities", () => {
    const config = productMediaConfigFromEnv({
      PRODUCT_MEDIA_ENABLED: "1",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "server-secret",
      PRODUCT_MEDIA_BUCKET: "nexpos-product-media",
    });
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("Expected configured product media");
    expect(config.bucket).toBe("nexpos-product-media");
    expect(JSON.stringify(config.capabilities)).not.toContain("server-secret");
    expect(JSON.stringify(config.capabilities)).not.toContain("supabase.co");
  });
});

describe("owner-only product image mutation", () => {
  it("allows only first-party owner sessions with a business", () => {
    expect(assertOwnerMediaWrite(identity("owner"))).toBeUndefined();
    for (const role of ["manager", "cashier", "inventory", "api", "platform"]) {
      expect(() => assertOwnerMediaWrite(identity(role))).toThrow("FORBIDDEN");
    }
    expect(() => assertOwnerMediaWrite(identity("owner", "api-token"))).toThrow("FORBIDDEN");
    expect(() => assertOwnerMediaWrite({ ...identity("owner"), businessId: "" })).toThrow("FORBIDDEN");
    expect(() => assertOwnerMediaWrite(undefined)).toThrow("FORBIDDEN");
  });
});
