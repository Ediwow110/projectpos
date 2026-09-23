import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbPort } from "../../common/db.port";

export interface SyncCheckItem {
  key: string;
  commandType: string;
}

@Injectable()
export class SyncService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async checkKeys(businessId: string, keys: SyncCheckItem[]): Promise<{
    applied: Array<{ key: string; resultId: string }>;
    unknown: Array<{ key: string }>;
    serverTime: string;
  }> {
    withScope(businessId, {});
    const applied: Array<{ key: string; resultId: string }> = [];
    const unknown: Array<{ key: string }> = [];
    for (const k of keys) {
      const hit = await this.db.findIdempotency(businessId, k.key, k.commandType);
      if (hit) applied.push({ key: k.key, resultId: hit.resultId });
      else unknown.push({ key: k.key });
    }
    return { applied, unknown, serverTime: new Date().toISOString() };
  }

  async resolveConflict(
    businessId: string,
    actorId: string,
    requestId: string,
    input: { key: string; commandType: string; reason: string },
    role: string,
  ): Promise<{ ok: true }> {
    withScope(businessId, {});
    if (role !== "owner" && role !== "manager") throw new Error("FORBIDDEN");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "sync.resolve",
      entityType: "OutboxCommand",
      entityId: `${input.commandType}:${input.key}:${input.reason}`,
      requestId,
    });
    return { ok: true };
  }
}
