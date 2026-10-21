import "reflect-metadata";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { FirstPartyOriginGuard } from "../../common/first-party-origin.guard";
import { PublicOrderController } from "./public-order.controller";

const mutations = ["create", "patchDraft", "submit", "retryPayment", "status"] as const;

function context(req: { headers: Record<string, string | undefined>; authError?: string }) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as never;
}

describe("public order mutation origin boundary", () => {
  // /orders/status resolves a status token, but it is a POST on the public
  // surface like the mutations beside it, so it must not be reachable from a
  // foreign origin that can brute-force or replay tokens cross-site.
  it.each(mutations)("guards the %s route with the first-party origin check", (name) => {
    const handler = (PublicOrderController.prototype as unknown as Record<string, unknown>)[name] as object;
    // Vitest's toContain does not fail on a missing receiver, so the array check
    // is what proves the route carries any guard at all.
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined;
    expect(guards).toBeInstanceOf(Array);
    expect(guards).toContain(FirstPartyOriginGuard);
  });

  it("keeps the status lookup a POST while refusing a cross-origin request outright", () => {
    const handler = (PublicOrderController.prototype as unknown as Record<string, unknown>).status as object;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("orders/status");

    const guard = new FirstPartyOriginGuard({ WEB_URL: "https://shop.example.com" });
    for (const origin of [undefined, "https://evil.example.com", "https://shop.example.com.evil.tld"]) {
      const req: { headers: Record<string, string | undefined>; authError?: string } = { headers: { origin } };
      expect(guard.canActivate(context(req))).toBe(false);
      expect(req.authError).toBe("FORBIDDEN");
    }
    const sameOrigin: { headers: Record<string, string | undefined>; authError?: string } = {
      headers: { origin: "https://shop.example.com" },
    };
    expect(guard.canActivate(context(sameOrigin))).toBe(true);
  });
});
