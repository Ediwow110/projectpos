import { createHash, randomBytes } from "node:crypto";
import type { DbOrderAccessToken, DbOrderAccessTokenKind, DbPort } from "../common/db.port";
import { recordGuestAccess } from "../common/metrics";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class OrderAccessService {
  constructor(private readonly db: DbPort) {}

  async mint(
    businessId: string,
    orderId: string,
    kind: DbOrderAccessTokenKind,
    expiresAt: Date,
    now: Date = new Date(),
  ): Promise<{ token: string; row: DbOrderAccessToken }> {
    const order = await this.db.findOrderById(orderId, businessId);
    if (!order) throw new Error("NOT_FOUND");
    const token = randomBytes(32).toString("hex");
    const row = await this.db.createOrderAccessToken({
      businessId,
      orderId,
      kind,
      tokenHash: hashToken(token),
      expiresAt,
      revokedAt: null,
      createdAt: now,
    });
    return { token, row };
  }

  async mintCheckoutToken(
    businessId: string,
    orderId: string,
    now: Date = new Date(),
  ): Promise<{ token: string; row: DbOrderAccessToken }> {
    return this.mint(
      businessId,
      orderId,
      "CHECKOUT",
      new Date(now.getTime() + 2 * 60 * 60 * 1000),
      now,
    );
  }

  async mintStatusToken(
    businessId: string,
    orderId: string,
    now: Date = new Date(),
  ): Promise<{ token: string; row: DbOrderAccessToken }> {
    return this.mint(
      businessId,
      orderId,
      "STATUS",
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      now,
    );
  }

  async requireCheckoutToken(
    businessId: string,
    orderId: string,
    token: string,
    now: Date = new Date(),
  ): Promise<DbOrderAccessToken> {
    try {
      const row = await this.authenticate(token, "CHECKOUT", orderId, now);
      if (row.businessId !== businessId) throw new Error("FORBIDDEN");
      return row;
    } catch {
      throw new Error("FORBIDDEN");
    }
  }

  async resolveStatusToken(token: string, now: Date = new Date()) {
    try {
      const row = await this.authenticate(token, "STATUS", undefined, now);
      const order = await this.db.findOrderById(row.orderId, row.businessId);
      if (!order) throw new Error("FORBIDDEN");
      return order;
    } catch {
      throw new Error("FORBIDDEN");
    }
  }

  async revokeCheckoutTokens(
    businessId: string,
    orderId: string,
    revokedAt: Date = new Date(),
  ): Promise<number> {
    return this.revokeAll(businessId, orderId, "CHECKOUT", revokedAt);
  }

  async revokeStatusTokens(
    businessId: string,
    orderId: string,
    revokedAt: Date = new Date(),
  ): Promise<number> {
    return this.revokeAll(businessId, orderId, "STATUS", revokedAt);
  }

  async replaceStatusTokens(
    businessId: string,
    orderId: string,
    now: Date = new Date(),
  ): Promise<{ token: string; row: DbOrderAccessToken }> {
    await this.revokeStatusTokens(businessId, orderId, now);
    return this.mintStatusToken(businessId, orderId, now);
  }

  async authenticate(
    token: string,
    kind: DbOrderAccessTokenKind,
    orderId?: string,
    now: Date = new Date(),
  ): Promise<DbOrderAccessToken> {
    if (!token || token.length < 32) {
      recordGuestAccess("failure");
      throw new Error("NOT_FOUND");
    }
    const row = await this.db.findOrderAccessTokenByHash(hashToken(token));
    if (
      !row ||
      row.kind !== kind ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= now.getTime() ||
      (orderId !== undefined && row.orderId !== orderId)
    ) {
      recordGuestAccess("failure");
      throw new Error("NOT_FOUND");
    }
    return row;
  }

  async revokeAll(
    businessId: string,
    orderId: string,
    kind: DbOrderAccessTokenKind,
    revokedAt: Date = new Date(),
  ): Promise<number> {
    const rows = await this.db.listActiveOrderAccessTokens(orderId, businessId, kind, revokedAt);
    let count = 0;
    for (const row of rows) {
      if (await this.db.revokeOrderAccessToken(row.id, businessId, revokedAt)) count += 1;
    }
    if (count > 0) recordGuestAccess("revoked");
    return count;
  }
}
