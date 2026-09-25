import { describe, expect, it } from "vitest";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { devicesFamily } from "../../src/common/pg/pg-devices";
import type { DbSession } from "../../src/common/db.port";
import { withDbill } from "./dbill.helpers";

// Devices-family tests, mirroring the memory store's behavior: tenant-scoped
// reads (null/[] for missing or cross-tenant rows), insertion-ordered lists,
// revokeDevice returning the updated row or null, and revokeSessionsByDevice
// touching only live sessions bound to the device within the business. Runs on
// the isolated dbill database (see dbill.helpers.ts).
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function deviceInput(businessId: string, userId: string) {
  return { businessId, userId, label: uniq("POS-"), revokedAt: null as Date | null };
}

describe("phase12 pg devices", () => {
  it("creates a device and finds it by id; cross-tenant and missing reads are null", async () => {
    await withDbill(async (ctx: PgContext) => {
      const tenants = tenantsFamily(ctx);
      const devices = devicesFamily(ctx);
      const user = await tenants.createUser({ name: "u", email: uniq("u") + "@x.test", passwordHash: "h" });
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const created = await devices.createDevice(deviceInput(b1.id, user.id));
      expect(created.id).toBeTruthy();
      expect(await devices.findDeviceById(created.id, b1.id)).toEqual(created);
      expect(await devices.findDeviceById(created.id, b2.id)).toBeNull();
      expect(await devices.findDeviceById("dev_none", b1.id)).toBeNull();
    });
  });

  it("lists only the business's devices in insertion order; empty -> []", async () => {
    await withDbill(async (ctx: PgContext) => {
      const tenants = tenantsFamily(ctx);
      const devices = devicesFamily(ctx);
      const user = await tenants.createUser({ name: "u", email: uniq("u") + "@x.test", passwordHash: "h" });
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const dev1 = await devices.createDevice(deviceInput(b1.id, user.id));
      await devices.createDevice(deviceInput(b2.id, user.id));
      const dev2 = await devices.createDevice(deviceInput(b1.id, user.id));
      const rows = await devices.listDevicesByBusiness(b1.id);
      expect(rows.map((r) => r.id)).toEqual([dev1.id, dev2.id]);
      expect(await devices.listDevicesByBusiness("biz_empty")).toEqual([]);
    });
  });

  it("revokeDevice stamps revokedAt and returns the updated row; missing/cross-tenant -> null", async () => {
    await withDbill(async (ctx: PgContext) => {
      const tenants = tenantsFamily(ctx);
      const devices = devicesFamily(ctx);
      const user = await tenants.createUser({ name: "u", email: uniq("u") + "@x.test", passwordHash: "h" });
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const created = await devices.createDevice(deviceInput(b1.id, user.id));
      const at = new Date("2026-09-25T10:00:00.123Z");
      const revoked = await devices.revokeDevice(created.id, b1.id, at);
      expect(revoked).toEqual({ ...created, revokedAt: at });
      expect(await devices.findDeviceById(created.id, b1.id)).toEqual(revoked);
      expect(await devices.revokeDevice(created.id, b2.id, at)).toBeNull();
      expect(await devices.revokeDevice("dev_none", b1.id, at)).toBeNull();
    });
  });

  it("revokeSessionsByDevice revokes only the device's live sessions within the business", async () => {
    await withDbill(async (ctx: PgContext) => {
      const tenants = tenantsFamily(ctx);
      const devices = devicesFamily(ctx);
      const user = await tenants.createUser({ name: "u", email: uniq("u") + "@x.test", passwordHash: "h" });
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const d1 = await devices.createDevice(deviceInput(b1.id, user.id));
      const d2 = await devices.createDevice(deviceInput(b1.id, user.id));
      const d3 = await devices.createDevice(deviceInput(b2.id, user.id));
      const earlier = new Date(Date.now() - 60_000);
      const seedSession = (businessId: string, deviceId: string | null, opts?: { revokedAt?: Date }) =>
        tenants.createSession({
          userId: user.id, businessId, activeBusinessId: null, tokenHash: uniq("tok"),
          expiresAt: new Date(Date.now() + 3_600_000),
          revokedAt: opts?.revokedAt ?? null,
          authenticatedAt: new Date(), ip: "127.0.0.1", userAgent: "vitest", deviceId,
        });
      const s1 = await seedSession(b1.id, d1.id); // bound + live -> revoked
      const s2 = await seedSession(b1.id, d2.id); // other device -> untouched
      const s3 = await seedSession(b1.id, null); // unbound -> untouched
      const s4 = await seedSession(b2.id, d3.id); // other business -> untouched
      const s5 = await seedSession(b1.id, d1.id, { revokedAt: earlier }); // already revoked keeps its stamp
      await devices.revokeSessionsByDevice(b1.id, d1.id);
      const reread = async (s: DbSession) => (await tenants.findSessionByTokenHash(s.tokenHash))!;
      expect((await reread(s1)).revokedAt).not.toBeNull();
      expect((await reread(s2)).revokedAt).toBeNull();
      expect((await reread(s3)).revokedAt).toBeNull();
      expect((await reread(s4)).revokedAt).toBeNull();
      expect((await reread(s5)).revokedAt).toEqual(earlier);
    });
  });

  it("round-trips a pre-revoked device (revokedAt set at creation) through create and list", async () => {
    await withDbill(async (ctx: PgContext) => {
      const tenants = tenantsFamily(ctx);
      const devices = devicesFamily(ctx);
      const user = await tenants.createUser({ name: "u", email: uniq("u") + "@x.test", passwordHash: "h" });
      const b = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const at = new Date("2026-09-25T09:30:00.456Z");
      const created = await devices.createDevice({ businessId: b.id, userId: user.id, label: "POS-retro", revokedAt: at });
      const rows = await devices.listDevicesByBusiness(b.id);
      expect(rows).toEqual([created]);
      expect(rows[0]!.revokedAt).toEqual(at);
    });
  });
});
