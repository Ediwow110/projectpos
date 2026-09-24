import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbApiToken, DbPort } from "../../common/db.port";

const TOKEN_MANAGERS = new Set(["owner", "manager"]);

export function mintTokenSecret(): { secret: string; prefix: string } {
  const rand = randomBytes(32).toString("hex");
  const prefix = `pos_${randomBytes(4).toString("hex")}`;
  return { secret: `${prefix}_${rand}`, prefix };
}

export function hashTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface TokenCreateInput {
  name: string;
  scopes: string[];
  expiresAt?: string;
}

@Injectable()
export class ApiTokenService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async mintToken(
    businessId: string,
    actorId: string,
    requestId: string,
    input: TokenCreateInput,
    role: string,
  ): Promise<{ id: string; prefix: string; secret: string; scopes: string[] }> {
    withScope(businessId, {});
    if (!TOKEN_MANAGERS.has(role)) throw new Error("FORBIDDEN");
    const name = input.name.trim();
    if (!name) throw new Error("VALIDATION");
    let expiresAt: Date | null = null;
    if (input.expiresAt !== undefined) {
      expiresAt = new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) throw new Error("VALIDATION");
    }
    const { secret, prefix } = mintTokenSecret();
    const row: DbApiToken = await this.db.createApiToken({
      businessId,
      name,
      tokenHash: hashTokenSecret(secret),
      prefix,
      scopes: input.scopes,
      revokedAt: null,
      expiresAt,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "apitoken.mint",
      entityType: "ApiToken",
      entityId: row.id,
      requestId,
    });
    return { id: row.id, prefix, secret, scopes: input.scopes };
  }

  async listTokens(businessId: string): Promise<Array<{ id: string; name: string; prefix: string; scopes: string[]; revokedAt: Date | null; expiresAt: Date | null }>> {
    withScope(businessId, {});
    return (await this.db.listApiTokens(businessId)).map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes,
      revokedAt: t.revokedAt,
      expiresAt: t.expiresAt,
    }));
  }

  async revokeToken(businessId: string, actorId: string, requestId: string, id: string, role: string): Promise<{ id: string }> {
    withScope(businessId, {});
    if (!TOKEN_MANAGERS.has(role)) throw new Error("FORBIDDEN");
    const row = await this.db.revokeApiToken(id, businessId, new Date());
    if (!row) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "apitoken.revoke",
      entityType: "ApiToken",
      entityId: id,
      requestId,
    });
    return { id };
  }
}
