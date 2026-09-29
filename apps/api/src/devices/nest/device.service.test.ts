import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { DeviceService } from "./device.service";
import { AuthService } from "../../auth/nest/auth.service";
import { hashPassword } from "../../auth/password";

describe("phase9b device port", () => {
  it("round-trips a device scoped to its business and user", async () => {
    const db = createMemoryDb();
    const d = await db.createDevice({ businessId: "b1", userId: "u1", label: "Counter", revokedAt: null });
    expect((await db.listDevicesByBusiness("b1")).map((x) => x.id)).toContain(d.id);
    expect(await db.findDeviceById(d.id, "b2")).toBeNull();
    expect(await db.listDevicesByBusiness("b2")).toEqual([]);
  });
});

describe("phase9b device service", () => {
  it("shows owners and managers the business device fleet while staff see only their own devices", async () => {
    const db = createMemoryDb();
    const svc = new DeviceService(db);
    const mine = await svc.enrollDevice("b1", "u1", "r1", { label: "Front till" });
    const theirs = await svc.enrollDevice("b1", "u2", "r2", { label: "Back till" });
    await svc.enrollDevice("b2", "u3", "r3", { label: "Other tenant" });

    await expect(svc.listDevices("b1", "u1", "owner")).resolves.toEqual([mine, theirs]);
    await expect(svc.listDevices("b1", "u1", "manager")).resolves.toEqual([mine, theirs]);
    await expect(svc.listDevices("b1", "u1", "cashier")).resolves.toEqual([mine]);
    await expect(svc.listDevices("b1", "u1", "inventory")).resolves.toEqual([mine]);
  });

  it("enrolls devices with audit", async () => {
    const db = createMemoryDb();
    const svc = new DeviceService(db);
    const d = await svc.enrollDevice("b1", "u1", "r1", { label: "Back counter" });
    expect(d.label).toBe("Back counter");
    expect(d.revokedAt).toBeNull();
    await expect(svc.enrollDevice("b1", "u1", "r2", { label: "  " })).rejects.toThrow("VALIDATION");
    expect((await db.listAudit()).some((a) => a.action === "device.enroll")).toBe(true);
  });
  it("lets owners revoke any device but users only their own, and kills its sessions", async () => {
    const db = createMemoryDb();
    const svc = new DeviceService(db);
    const other = await svc.enrollDevice("b1", "u2", "r1", { label: "Theirs" });
    const mine = await svc.enrollDevice("b1", "u1", "r1", { label: "Mine" });
    await expect(svc.revokeDevice("b1", "u1", "r2", other.id, "cashier")).rejects.toThrow("FORBIDDEN");
    await db.createSession({
      userId: "u2", businessId: "b1", tokenHash: "tok1", expiresAt: new Date(Date.now() + 3600000),
      revokedAt: null, authenticatedAt: new Date(), ip: null, userAgent: null, deviceId: other.id,
    });
    await svc.revokeDevice("b1", "u1", "r3", other.id, "owner");
    expect((await db.findDeviceById(other.id, "b1"))!.revokedAt).not.toBeNull();
    expect(await db.listSessionsByUser("u2")).toEqual([]);
    await svc.revokeDevice("b1", "u1", "r4", mine.id, "cashier");
    expect((await db.findDeviceById(mine.id, "b1"))!.revokedAt).not.toBeNull();
    expect((await db.listAudit()).some((a) => a.action === "device.revoke")).toBe(true);
  });
  it("binds deviceId on login and rejects revoked devices", async () => {
    const db = createMemoryDb();
    const user = await db.createUser({ name: "Ana", email: "ana@example.com", passwordHash: await hashPassword("correct-horse-12") });
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    await db.createMembership({ businessId: biz.id, userId: user.id, role: "owner" });
    const svc = new DeviceService(db);
    const dev = await svc.enrollDevice(biz.id, user.id, "r0", { label: "Till" });
    const auth = new AuthService(db);
    const meta = { requestId: "r1", ip: null as string | null, userAgent: null as string | null };
    await auth.login({ email: "ana@example.com", password: "correct-horse-12" }, meta, dev.id);
    expect((await db.listSessionsByUser(user.id)).map((s) => s.deviceId)).toContain(dev.id);
    await svc.revokeDevice(biz.id, user.id, "r2", dev.id, "owner");
    await expect(
      auth.login({ email: "ana@example.com", password: "correct-horse-12" }, meta, dev.id),
    ).rejects.toThrow("FORBIDDEN");
    const plain = await auth.login({ email: "ana@example.com", password: "correct-horse-12" }, meta);
    expect(plain.userId).toBe(user.id);
  });
});
