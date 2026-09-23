import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { CustomerService } from "./customer.service";

async function setup() {
  const db = createMemoryDb();
  return { db, svc: new CustomerService(db) };
}

describe("phase6 customer port", () => {
  it("round-trips a customer scoped to its business", async () => {
    const { db } = await setup();
    const c = await db.createCustomer({
      businessId: "b1", name: "Ana", phone: "0917", email: null,
      address: null, notes: null, isActive: true,
    });
    expect((await db.listCustomersByBusiness("b1")).map((x) => x.id)).toContain(c.id);
    expect(await db.listCustomersByBusiness("b2")).toEqual([]);
    expect(await db.findCustomerById(c.id, "b2")).toBeNull();
  });
});

describe("phase6 customer service", () => {
  it("creates and searches customers with audit", async () => {
    const { db, svc } = await setup();
    await svc.createCustomer("b1", "u1", "r1", { name: "Ana Santos", phone: "0917" });
    const page = await svc.listCustomers("b1", { q: "santos", active: "true", page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect((await db.listAudit()).some((a) => a.action === "customer.create")).toBe(true);
  });
  it("rejects duplicate phone within a business but allows across businesses", async () => {
    const { svc } = await setup();
    await svc.createCustomer("b1", "u1", "r1", { name: "Ana", phone: "0917" });
    await expect(svc.createCustomer("b1", "u1", "r2", { name: "Bo", phone: "0917" })).rejects.toThrow("VALIDATION");
    await svc.createCustomer("b2", "u1", "r3", { name: "Cy", phone: "0917" });
  });
  it("redacts PII for cashier role", async () => {
    const { svc } = await setup();
    const c = await svc.createCustomer("b1", "u1", "r1", { name: "Ana", phone: "0917", email: "a@x.yz" });
    const full = await svc.getCustomer("b1", c.id, "owner");
    expect(full.phone).toBe("0917");
    const redacted = await svc.getCustomer("b1", c.id, "cashier");
    expect(redacted.phone).toBeNull();
    expect(redacted.email).toBeNull();
  });
  it("blocks cashier edits and cross-tenant reads", async () => {
    const { svc } = await setup();
    const c = await svc.createCustomer("b1", "u1", "r1", { name: "Ana" });
    await expect(svc.updateCustomer("b1", "u1", "r2", c.id, { notes: "x" }, "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(svc.getCustomer("b2", c.id, "owner")).rejects.toThrow("NOT_FOUND");
  });
});
