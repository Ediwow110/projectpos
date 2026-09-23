import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbDevice, DbPort } from "../../common/db.port";

const DEVICE_MANAGERS = new Set(["owner", "manager"]);

@Injectable()
export class DeviceService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async enrollDevice(
    businessId: string,
    userId: string,
    requestId: string,
    input: { label: string },
  ): Promise<DbDevice> {
    withScope(businessId, {});
    const label = input.label.trim();
    if (!label) throw new Error("VALIDATION");
    const row = await this.db.createDevice({ businessId, userId, label, revokedAt: null });
    await this.db.appendAudit({
      businessId,
      actorId: userId,
      action: "device.enroll",
      entityType: "Device",
      entityId: row.id,
      requestId,
    });
    return row;
  }

  async listDevices(businessId: string, userId: string): Promise<DbDevice[]> {
    withScope(businessId, {});
    const all = await this.db.listDevicesByBusiness(businessId);
    return all.filter((d) => d.userId === userId);
  }

  async revokeDevice(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    role: string,
  ): Promise<DbDevice> {
    withScope(businessId, {});
    const device = await this.db.findDeviceById(id, businessId);
    if (!device) throw new Error("NOT_FOUND");
    if (!DEVICE_MANAGERS.has(role) && device.userId !== actorId) throw new Error("FORBIDDEN");
    const revoked =
      (await this.db.revokeDevice(id, businessId, new Date())) ?? device;
    await this.db.revokeSessionsByDevice(businessId, id);
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "device.revoke",
      entityType: "Device",
      entityId: id,
      requestId,
    });
    return revoked;
  }
}
