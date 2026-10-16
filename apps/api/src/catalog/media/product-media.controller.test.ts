import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ProductMediaController } from "./product-media.controller";
import { SessionGuard } from "../../common/session.guard";

describe("product media capability route", () => {
  it("is session protected, not a public or API token capability", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProductMediaController)).toBe("api/v1/product-media");
    expect(Reflect.getMetadata(GUARDS_METADATA, ProductMediaController)).toContain(SessionGuard);
  });

  it("only returns enabled state, limits, and supported types; never storage credentials", () => {
    const json = vi.fn();
    const controller = new ProductMediaController();
    const oldEnv = process.env;
    process.env = {
      ...oldEnv,
      PRODUCT_MEDIA_ENABLED: "1",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "private-123",
      PRODUCT_MEDIA_BUCKET: "nexpos-product-media",
    };
    try {
      controller.capabilities({ auth: { sessionId: "s", businessId: "b", userId: "u", role: "owner" } } as never, { json } as never);
      expect(json).toHaveBeenCalledWith({
        enabled: true, maxSourceBytes: 3 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      });
      expect(JSON.stringify(json.mock.calls)).not.toContain("private-123");
    } finally {
      process.env = oldEnv;
    }
  });
});
