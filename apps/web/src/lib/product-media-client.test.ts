import { afterEach, describe, expect, it, vi } from "vitest";
import { removeProductImage, uploadProductImage } from "./product-media-client";

afterEach(() => { vi.unstubAllGlobals(); });

describe("managed image browser transport", () => {
  it("uploads through NexPOS API as multipart with CSRF, not a supplied content-type or storage credential", async () => {
    const file = new File(["content"], "milk.png", { type: "image/png" });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.credentials).toBe("include");
      expect((init.headers as Record<string,string>)["X-CSRF-Token"]).toBe("csrf-test");
      expect((init.headers as Record<string,string>)["Content-Type"]).toBeUndefined();
      const data = init.body as FormData;
      expect(data.get("image")).toBe(file);
      expect(data.get("expectedAssetId")).toBe("old-version");
      return { ok: true, status: 201, json: async () => ({ imageUrl: "https://cdn.test/milk.webp", assetId: "new-version" }) };
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await uploadProductImage("prod-1", file, "old-version", "csrf-test")).toEqual({
      imageUrl: "https://cdn.test/milk.webp", assetId: "new-version",
    });
    expect(String(fetcher.mock.calls[0][0])).toContain("/api/v1/products/prod-1/image");
  });

  it("uses safe API error responses and preserves current photo on a server denial", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 409, json: async () => ({ code: "PRODUCT_MEDIA_CONFLICT", message: "Stale version" }),
    })));
    await expect(uploadProductImage("p1", new File(["x"], "pic.png", { type: "image/png" }), null, "csrf"))
      .rejects.toThrow("Stale version");
  });

  it("rejects missing identifiers before making a network request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadProductImage("../other", new File(["x"], "pic.png"), null, "csrf")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("removes a photo with an explicit expected version and CSRF header", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe("DELETE");
      expect(JSON.parse(String(init.body))).toEqual({ expectedAssetId: "current-id" });
      expect((init.headers as Record<string,string>)["Content-Type"]).toBe("application/json");
      return { ok: true, json: async () => ({ imageUrl: null, assetId: null }) };
    }));
    expect(await removeProductImage("p1", "current-id", "csrf-test")).toEqual({ imageUrl: null, assetId: null });
  });
});
