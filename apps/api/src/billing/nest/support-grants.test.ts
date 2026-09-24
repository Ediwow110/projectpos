process.env["PLATFORM_API_KEY"] = "test-platform-key";

import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SupportGrantService } from "./support-grant.service";

describe("phase11 support grants (FR-PLATFORM-01)", () => {
  it("mints a time-bounded grant and honors single use", async () => {
    const db = createMemoryDb();
    const svc = new SupportGrantService(db);
    const grant = await svc.mint({ purpose: "invoice investigation", ttlMinutes: 30, actorId: "ops-oncall" }, "r1");
    expect(grant.token).toMatch(/^sup_[0-9a-f]{16}_[0-9a-f]{32}$/);
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const resolved = await svc.resolve(grant.token);
    expect(resolved!.purpose).toBe("invoice investigation");
    await svc.consume(resolved!.id);
    expect(await svc.resolve(grant.token)).toBeNull();
  });

  it("rejects oversized ttls", async () => {
    const db = createMemoryDb();
    const svc = new SupportGrantService(db);
    await expect(svc.mint({ purpose: "x", ttlMinutes: 61, actorId: "ops" }, "r2")).rejects.toThrow("VALIDATION");
    await expect(svc.mint({ purpose: "ok ttl", ttlMinutes: 60, actorId: "ops" }, "r3")).resolves.toBeTruthy();
  });
});
