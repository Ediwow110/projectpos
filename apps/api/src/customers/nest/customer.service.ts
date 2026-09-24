import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbCustomer, DbPort, DbSale } from "../../common/db.port";
import { BillingService } from "../../billing/nest/billing.service";

const MANAGE_ROLES = new Set(["owner", "manager"]);
const FULL_PII_ROLES = new Set(["owner", "manager", "inventory"]);

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface CustomerPatch {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export type CustomerDetail = DbCustomer & {
  purchaseHistory: DbSale[];
};

function cleanString(v: string | undefined, max: number): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "") return null;
  if (t.length > max) throw new Error("VALIDATION");
  return t;
}

@Injectable()
export class CustomerService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async createCustomer(
    businessId: string,
    actorId: string,
    requestId: string,
    input: CustomerInput,
  ): Promise<DbCustomer> {
    withScope(businessId, {});
    await new BillingService(this.db).requireFeature(businessId, "customers");
    const name = input.name.trim();
    if (!name || name.length > 120) throw new Error("VALIDATION");
    const phone = cleanString(input.phone, 32);
    const emailRaw = cleanString(input.email, 160);
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("VALIDATION");
    if (phone) {
      const existing = await this.db.listCustomersByBusiness(businessId);
      if (existing.some((c) => c.phone === phone)) throw new Error("VALIDATION");
    }
    const row = await this.db.createCustomer({
      businessId,
      name,
      phone,
      email,
      address: cleanString(input.address, 300),
      notes: cleanString(input.notes, 500),
      isActive: true,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "customer.create",
      entityType: "Customer",
      entityId: row.id,
      requestId,
    });
    return row;
  }

  async listCustomers(
    businessId: string,
    opts: { q?: string; active: "true" | "false" | "all"; page: number; pageSize: number },
  ): Promise<{ items: DbCustomer[]; total: number; page: number; pageSize: number }> {
    withScope(businessId, {});
    await new BillingService(this.db).requireFeature(businessId, "customers");
    let rows = await this.db.listCustomersByBusiness(businessId);
    if (opts.active === "true") rows = rows.filter((c) => c.isActive);
    else if (opts.active === "false") rows = rows.filter((c) => !c.isActive);
    const q = (opts.q ?? "").trim().toLowerCase();
    if (q !== "") {
      rows = rows.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q),
      );
    }
    rows = [...rows].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
    const total = rows.length;
    const start = (opts.page - 1) * opts.pageSize;
    return { items: rows.slice(start, start + opts.pageSize), total, page: opts.page, pageSize: opts.pageSize };
  }

  async getCustomer(businessId: string, id: string, role: string): Promise<CustomerDetail> {
    withScope(businessId, {});
    await new BillingService(this.db).requireFeature(businessId, "customers");
    const row = await this.db.findCustomerById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    const sales = (await this.db.listSalesByBusiness(businessId))
      .filter((s) => s.customerId === id && s.status !== "DRAFT" && s.status !== "VOIDED")
      .sort((a, b) => (a.receiptNo < b.receiptNo ? 1 : -1))
      .slice(0, 50);
    if (FULL_PII_ROLES.has(role)) return { ...row, purchaseHistory: sales };
    return { ...row, phone: null, email: null, address: null, purchaseHistory: sales };
  }

  async updateCustomer(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    patch: CustomerPatch,
    role: string,
  ): Promise<DbCustomer> {
    withScope(businessId, {});
    if (!MANAGE_ROLES.has(role)) throw new Error("FORBIDDEN");
    await new BillingService(this.db).requireFeature(businessId, "customers");
    const current = await this.db.findCustomerById(id, businessId);
    if (!current) throw new Error("NOT_FOUND");
    const next: Partial<Omit<DbCustomer, "id" | "businessId">> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name || name.length > 120) throw new Error("VALIDATION");
      next.name = name;
    }
    if (patch.phone !== undefined) {
      const phone = patch.phone === null ? null : cleanString(patch.phone, 32);
      if (phone) {
        const existing = await this.db.listCustomersByBusiness(businessId);
        if (existing.some((c) => c.phone === phone && c.id !== id)) throw new Error("VALIDATION");
      }
      next.phone = phone;
    }
    if (patch.email !== undefined) {
      const email = patch.email === null ? null : cleanString(patch.email, 160)?.toLowerCase() ?? null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("VALIDATION");
      next.email = email;
    }
    if (patch.address !== undefined) next.address = patch.address === null ? null : cleanString(patch.address, 300);
    if (patch.notes !== undefined) next.notes = patch.notes === null ? null : cleanString(patch.notes, 500);
    if (patch.isActive !== undefined) next.isActive = patch.isActive;
    const updated = await this.db.updateCustomer(id, businessId, next);
    if (!updated) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "customer.update",
      entityType: "Customer",
      entityId: id,
      requestId,
    });
    return updated;
  }

  async archiveCustomer(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    role: string,
  ): Promise<DbCustomer> {
    const updated = await this.updateCustomer(businessId, actorId, requestId, id, { isActive: false }, role);
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "customer.archive",
      entityType: "Customer",
      entityId: id,
      requestId,
    });
    return updated;
  }
}
