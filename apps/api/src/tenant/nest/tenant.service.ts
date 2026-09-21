import { Inject, Injectable } from "@nestjs/common";
import type { DbPort } from "../../common/db.port";

@Injectable()
export class TenantService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async me(userId: string, businessId: string): Promise<{
    userId: string;
    email: string;
    name: string;
    businessId: string;
    businessName: string;
    role: string;
  }> {
    const user = await this.db.findUserById(userId);
    const business = await this.db.findBusinessById(businessId);
    const membership = await this.db.findMembership(userId, businessId);
    if (!user || !business || !membership) throw new Error("TENANT_REQUIRED");
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      businessId: business.id,
      businessName: business.name,
      role: membership.role,
    };
  }
}
