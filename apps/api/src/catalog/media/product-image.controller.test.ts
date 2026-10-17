import { describe, expect, it } from "vitest";
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { FirstPartyOriginGuard } from "../../common/first-party-origin.guard";
import { ProductImageController, ProductMediaOwnerGuard } from "./product-image.controller";

const owner = {
  userId: "u1", businessId: "b1", sessionId: "s1", role: "owner",
  activeBranchId: null, authenticatedAt: new Date(),
};

function context(req: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as never;
}

describe("owner-only product image HTTP boundary", () => {
  it("places session, CSRF, origin and owner guards before multipart parsing", () => {
    const proto = ProductImageController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, ProductImageController)).toBe("api/v1/products");
    const guards = Reflect.getMetadata(GUARDS_METADATA, proto.upload) as unknown[];
    for (const guard of [SessionGuard, CsrfGuard, FirstPartyOriginGuard, ProductMediaOwnerGuard]) {
      expect(guards).toContain(guard);
    }
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, proto.upload)).toHaveLength(1);
  });

  it("rejects the role before upload parsing even when media configuration is enabled", async () => {
    const previous = process.env;
    process.env = {
      ...previous,
      PRODUCT_MEDIA_ENABLED: "1",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "local-test-secret",
      PRODUCT_MEDIA_BUCKET: "nexpos-product-media",
    };
    try {
      const guard = new ProductMediaOwnerGuard();
      const cashierReq = { auth: { ...owner, role: "cashier" } };
      expect(await guard.canActivate(context(cashierReq))).toBe(false);
      expect((cashierReq as { authError?: string }).authError).toBe("FORBIDDEN");
      const tokenReq = { auth: { ...owner, via: "api-token" } };
      expect(await guard.canActivate(context(tokenReq))).toBe(false);
      expect((tokenReq as { authError?: string }).authError).toBe("FORBIDDEN");
      expect(await guard.canActivate(context({ auth: owner }))).toBe(true);
    } finally {
      process.env = previous;
    }
  });

  it("fails closed before reading image bytes while the storage feature is disabled", async () => {
    const previous = process.env;
    process.env = { ...previous, PRODUCT_MEDIA_ENABLED: "0" };
    try {
      const req = { auth: owner };
      expect(await new ProductMediaOwnerGuard().canActivate(context(req))).toBe(false);
      expect((req as { authError?: string }).authError).toBe("PRODUCT_MEDIA_DISABLED");
    } finally {
      process.env = previous;
    }
  });
});
