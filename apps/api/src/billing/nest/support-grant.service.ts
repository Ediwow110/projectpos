import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { supportGrantSchema } from "@pos/validation";
import type { DbPort } from "../../common/db.port";

export function hashGrantToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// FR-PLATFORM-01: platform support access is time-bounded and purpose-bound.
// The static PLATFORM_API_KEY mints grants; the routes themselves accept a
// grant (or the key) and every granted action is audited with its purpose.
@Injectable()
export class SupportGrantService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async mint(
    input: { purpose: string; ttlMinutes: number; actorId: string },
    requestId: string,
  ): Promise<{ grantId: string; token: string; expiresAt: Date }> {
    const parsed = supportGrantSchema.safeParse(input);
    if (!parsed.success) throw new Error("VALIDATION");
    const token = `sup_${randomBytes(8).toString("hex")}_${randomBytes(16).toString("hex")}`;
    const expiresAt = new Date(Date.now() + parsed.data.ttlMinutes * 60 * 1000);
    const row = await this.db.createSupportGrant({
      purpose: parsed.data.purpose,
      actorId: parsed.data.actorId,
      tokenHash: hashGrantToken(token),
      expiresAt,
    });
    await this.db.appendAudit({
      businessId: null,
      actorId: parsed.data.actorId,
      action: "support.grant.minted",
      entityType: "PlatformSupportGrant",
      entityId: row.id,
      requestId,
      reason: parsed.data.purpose,
    });
    return { grantId: row.id, token, expiresAt };
  }

  async resolve(token: string): Promise<{ id: string; purpose: string; actorId: string; expiresAt: Date } | null> {
    if (typeof token !== "string" || token.length === 0) return null;
    const tokenHash = hashGrantToken(token);
    return this.db.withLock(`support-grant:${tokenHash}`, async () => {
      const grant = await this.db.findValidSupportGrant(tokenHash);
      if (!grant) return null;
      // Claim at authorization time so two app instances cannot both
      // authorize mutations with the same one-time bearer.
      await this.db.markSupportGrantUsed(grant.id);
      return grant;
    });
  }

  async consume(grantId: string): Promise<void> {
    await this.db.markSupportGrantUsed(grantId);
  }
}
