import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../apps/api/src/common/rate-limit";
import { toSafeLogContext } from "../apps/api/src/common/log-context";
import { cookieOpts } from "../apps/api/src/auth/nest/auth.controller";

describe("phase8 exit", () => {
  it("abuse brake trips and resets on window rollover", () => {
    const limiter = createRateLimiter(2, 60_000);
    expect(limiter.hit("b1", 1000)).toBe(false);
    expect(limiter.hit("b1", 1001)).toBe(false);
    expect(limiter.hit("b1", 1002)).toBe(true);
    expect(limiter.hit("b1", 61_003)).toBe(false);
  });
  it("log contexts never carry secrets", () => {
    const out = toSafeLogContext({ businessId: "b1", passwordHash: "h", token: "t", ok: 1 });
    expect(out).toEqual({ businessId: "b1", passwordHash: "[redacted]", token: "[redacted]", ok: 1 });
  });
  it("production cookies are httpOnly, lax, and secure", () => {
    const prev = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const opts = cookieOpts({ protocol: "http" } as never);
      expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    } finally {
      process.env["NODE_ENV"] = prev;
    }
  });
  it("cashier seed withholds override-class permissions", async () => {
    const { ROLE_SEED } = await import("../apps/api/src/tenant/seed");
    for (const p of ["discount.override", "inventory.adjust", "shift.close.override"]) {
      expect(ROLE_SEED.cashier).not.toContain(p);
    }
    expect(ROLE_SEED.manager).toContain("discount.override");
  });
});
