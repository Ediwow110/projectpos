import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { DbGuestSupportCase, DbPlatformConsent, DbPort } from "../common/db.port";
import { OrderAccessService } from "./order-access-service";

export interface GuestCaseInput {
  statusToken: string;
  category: DbGuestSupportCase["category"];
  description: string;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

@Injectable()
export class GuestSupportService {
  private readonly access: OrderAccessService;
  constructor(@Inject("DbPort") private readonly db: DbPort) { this.access = new OrderAccessService(db); }

  async submit(input: GuestCaseInput, key: string, requestId: string): Promise<{ caseId: string; status: string; replayed: boolean }> {
    if (!key || key.length > 128 || !["ORDER", "PAYMENT", "FULFILLMENT", "OTHER"].includes(input.category) ||
      typeof input.description !== "string" || input.description.trim().length < 10 ||
      input.description.length > 1000) throw new Error("VALIDATION");
    const order = await this.access.resolveStatusToken(input.statusToken);
    if (order.status === "DRAFT") throw new Error("INVALID_STATE");
    return this.db.withLock(`guest-support:${order.businessId}:${key}`, async () => {
      const prior = await this.db.findGuestSupportCaseByKey(order.businessId, key);
      if (prior) {
        if (prior.orderId !== order.id || prior.category !== input.category || prior.description !== input.description.trim()) throw new Error("IDEMPOTENCY_MISMATCH");
        return { caseId: prior.id, status: prior.status, replayed: true };
      }
      return this.db.withTransaction(async (tx) => {
        const row = await tx.createGuestSupportCase({
          businessId: order.businessId, orderId: order.id,
          category: input.category, description: input.description.trim(), status: "OPEN",
          idempotencyKey: key, closedAt: null, closedBy: null,
        });
        await tx.appendAudit({
          businessId: order.businessId, actorId: "guest", requestId, action: "guest_support.opened",
          entityType: "GuestSupportCase", entityId: row.id,
          after: { orderId: order.id, category: input.category, status: "OPEN" },
        });
        return { caseId: row.id, status: row.status, replayed: false };
      });
    });
  }

  async guestHistory(statusToken: string): Promise<Array<{ caseId: string; category: string; status: string; createdAt: Date }>> {
    const order = await this.access.resolveStatusToken(statusToken);
    return (await this.db.listGuestSupportCases(order.businessId))
      .filter((row) => row.orderId === order.id)
      .map((row) => ({ caseId: row.id, category: row.category, status: row.status, createdAt: row.createdAt }));
  }

  async listForBusiness(businessId: string): Promise<DbGuestSupportCase[]> {
    return this.db.listGuestSupportCases(businessId);
  }

  async close(businessId: string, actorId: string, id: string, requestId: string): Promise<DbGuestSupportCase> {
    return this.db.withLock(`guest-support-close:${businessId}:${id}`, async () =>
      this.db.withTransaction(async (tx) => {
        const prior = (await tx.listGuestSupportCases(businessId)).find((row) => row.id === id);
        if (!prior) throw new Error("NOT_FOUND");
        if (prior.status === "CLOSED") return prior;
        const row = await tx.closeGuestSupportCase(id, businessId, actorId);
        if (!row) throw new Error("CONFLICT");
        await tx.appendAudit({
          businessId, actorId, requestId, action: "guest_support.closed",
          entityType: "GuestSupportCase", entityId: id,
          before: { status: "OPEN" }, after: { status: "CLOSED" },
        });
        return row;
      }),
    );
  }
}

@Injectable()
export class PlatformConsentService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async issue(businessId: string, ownerId: string, purpose: string, minutes: number, requestId: string) {
    if (!purpose || purpose.trim().length < 10 || purpose.length > 200 ||
      !Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error("VALIDATION");
    const token = `ownerconsent_${randomBytes(32).toString("hex")}`;
    const row = await this.db.withTransaction(async (tx) => {
      const consent = await tx.createPlatformConsent({
        businessId, ownerId, purpose: purpose.trim(), tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + minutes * 60_000), revokedAt: null,
      });
      await tx.appendAudit({
        businessId, actorId: ownerId, requestId, action: "platform_support.owner_consent",
        entityType: "PlatformOwnerConsent", entityId: consent.id,
        reason: purpose.trim(), after: { expiresAt: consent.expiresAt, scope: "read-only-diagnostics" },
      });
      return consent;
    });
    return { id: row.id, token, expiresAt: row.expiresAt };
  }

  async list(businessId: string): Promise<Omit<DbPlatformConsent, "tokenHash">[]> {
    return (await this.db.listPlatformConsents(businessId)).map(({ tokenHash: _hash, ...row }) => {
      void _hash; return row;
    });
  }

  async revoke(businessId: string, ownerId: string, id: string, requestId: string): Promise<void> {
    await this.db.withLock(`platform-consent:${businessId}:${id}`, async () => {
      const previous = (await this.db.listPlatformConsents(businessId)).find((item) => item.id === id);
      if (!previous) throw new Error("NOT_FOUND");
      if (previous.revokedAt) return;
      const row = await this.db.revokePlatformConsent(id, businessId);
      if (!row) throw new Error("NOT_FOUND");
      await this.db.appendAudit({
        businessId, actorId: ownerId, requestId, action: "platform_support.consent_revoked",
        entityType: "PlatformOwnerConsent", entityId: id,
      });
    });
  }

  async diagnostics(businessId: string, token: string, requestId: string) {
    if (!token || !/^ownerconsent_[0-9a-f]{64}$/.test(token)) throw new Error("FORBIDDEN");
    const hash = hashToken(token);
    const found = await this.db.findPlatformConsentByHash(businessId, hash);
    if (!found) throw new Error("FORBIDDEN");
    // Serialize access and revocation using the same tenant-bound lock.
    // Revalidate inside the lock so a consent revoked while waiting cannot
    // be used to start another diagnostic read.
    return this.db.withLock(`platform-consent:${businessId}:${found.id}`, async () => {
      const row = await this.db.findPlatformConsentByHash(businessId, hash);
      if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= Date.now()) throw new Error("FORBIDDEN");
      const business = await this.db.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      // An advisory lock holds a single PostgreSQL transaction connection.
      // Issue these queries sequentially to avoid overlapping query calls
      // on that client (pg@9 disallows overlapping client.query calls).
      const members = await this.db.listMembershipsByBusiness(businessId);
      const branches = await this.db.listBranchesByBusiness(businessId);
      const sales = await this.db.listSalesByBusiness(businessId);
      const cases = await this.db.listGuestSupportCases(businessId);
      await this.db.appendAudit({
        businessId, actorId: "platform", action: "platform_support.diagnostics_viewed", requestId,
        entityType: "PlatformOwnerConsent", entityId: row.id,
        after: { scope: "read-only", expiresAt: row.expiresAt },
      });
      return {
        businessId, businessName: business.name, consentExpiresAt: row.expiresAt,
        activeStaff: members.filter((member) => !member.deactivatedAt).length,
        activeBranches: branches.filter((branch) => branch.isActive).length,
        sales: sales.length,
        openSupportCases: cases.filter((entry) => entry.status === "OPEN").length,
      };
    });
  }
}
