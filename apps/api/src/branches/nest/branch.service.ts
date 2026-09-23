import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbBranch, DbPort } from "../../common/db.port";

const BRANCH_MANAGERS = new Set(["owner", "manager"]);

export interface BranchInput {
  name: string;
  type?: string;
  isActive?: boolean;
}

@Injectable()
export class BranchService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async createBranch(
    businessId: string,
    actorId: string,
    requestId: string,
    input: BranchInput,
    role: string,
  ): Promise<DbBranch> {
    withScope(businessId, {});
    if (!BRANCH_MANAGERS.has(role)) throw new Error("FORBIDDEN");
    const name = input.name.trim();
    if (!name) throw new Error("VALIDATION");
    const existing = await this.db.listBranchesByBusiness(businessId);
    if (existing.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("VALIDATION");
    }
    const type = input.type ?? "store";
    const row = await this.db.createBranch({
      businessId,
      name,
      type,
      isActive: input.isActive ?? true,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "branch.create",
      entityType: "Branch",
      entityId: row.id,
      requestId,
    });
    return row;
  }

  async listBranches(businessId: string): Promise<DbBranch[]> {
    withScope(businessId, {});
    return this.db.listBranchesByBusiness(businessId);
  }

  async updateBranch(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    patch: { name?: string; isActive?: boolean },
    role: string,
  ): Promise<DbBranch> {
    withScope(businessId, {});
    if (!BRANCH_MANAGERS.has(role)) throw new Error("FORBIDDEN");
    const current = await this.db.findBranchById(id, businessId);
    if (!current) throw new Error("NOT_FOUND");
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("VALIDATION");
      const existing = await this.db.listBranchesByBusiness(businessId);
      if (existing.some((b) => b.id !== id && b.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("VALIDATION");
      }
    }
    const next = await this.db.updateBranch(id, businessId, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    });
    if (!next) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "branch.update",
      entityType: "Branch",
      entityId: id,
      requestId,
    });
    return next;
  }
}
