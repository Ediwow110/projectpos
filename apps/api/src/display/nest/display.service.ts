import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";

const SELL_ROLES = new Set(["owner", "manager", "cashier"]);

export interface DisplayFeed {
  businessName: string;
  shiftStatus: "OPEN" | "CLOSED" | "NONE";
  lastSale: { id: string; receiptNo: string; totalMinor: number; createdAt: string } | null;
}

@Injectable()
export class DisplayService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async mintToken(
    businessId: string,
    actorId: string,
    requestId: string,
    registerId: string,
    role: string,
    now: Date = new Date(),
  ): Promise<{ token: string; expiresAt: string }> {
    withScope(businessId, {});
    if (!SELL_ROLES.has(role)) throw new Error("FORBIDDEN");
    const register = await this.db.findRegisterById(registerId, businessId);
    if (!register) throw new Error("NOT_FOUND");
    const token = randomBytes(32).toString("hex");
    const row = await this.db.createDisplayToken({
      businessId,
      registerId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    });
    await this.db.appendAudit({
      businessId, actorId, action: "display.token",
      entityType: "DisplayToken", entityId: row.id, requestId,
    });
    return { token, expiresAt: row.expiresAt.toISOString() };
  }

  // The token is the only credential: it names the business and the register,
  // so the caller never supplies a tenant id that could be tampered with.
  async feed(registerId: string, token: string, now: Date = new Date()): Promise<DisplayFeed> {
    const stored = await this.db.findDisplayToken(createHash("sha256").update(token).digest("hex"));
    if (!stored || stored.registerId !== registerId) throw new Error("NOT_FOUND");
    if (stored.expiresAt.getTime() <= now.getTime()) throw new Error("NOT_FOUND");
    const businessId = stored.businessId;
    withScope(businessId, {});
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("NOT_FOUND");
    const open = await this.db.findOpenShiftByRegister(businessId, registerId);
    const anyForRegister = await this.db.hasShiftForRegister(businessId, registerId);
    // Two indexed point reads, not a full-table scan: this endpoint is polled
    // every few seconds by every customer display.
    const last = await this.db.findLatestSaleForRegister(businessId, registerId);
    return {
      businessName: business.name,
      shiftStatus: open ? "OPEN" : anyForRegister ? "CLOSED" : "NONE",
      lastSale: last
        ? { id: last.id, receiptNo: last.receiptNo, totalMinor: last.totalMinor, createdAt: last.createdAt.toISOString() }
        : null,
    };
  }
}
