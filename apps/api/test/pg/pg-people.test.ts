import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { peopleFamily } from "../../src/common/pg/pg-people";
import type { DbCustomer, DbExchange, DbExpense, DbRefund, DbRefundItem } from "../../src/common/db.port";

// People-family tests (customers, refunds + items, expenses): the family runs
// directly over a fresh PgContext (no PgDbPort), mirroring the memory store's
// behavior — same tenant filters, same ordering, null for missing/cross-tenant
// rows, [] for empty lists. Refund/RefundItem/Expense have no saleId/shiftId
// FKs in the DDL (only businessId), so fabricated parent ids are safe.
const URL = `${process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433"}/pos_test_pg`;
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin: Client;
let ctx: PgContext;
let people: ReturnType<typeof peopleFamily>;
let tenants: ReturnType<typeof tenantsFamily>;

beforeAll(async () => {
  admin = new Client({ connectionString: URL });
  await admin.connect();
});

beforeEach(async () => {
  // Fresh state per test: truncate everything except the migration ledger,
  // exactly like helpers.ts.
  const tables = (
    await admin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_migrations')",
    )
  ).rows.map((r) => r.tablename as string);
  if (tables.length > 0) {
    await admin.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  }
  ctx = new PgContext(URL);
  people = peopleFamily(ctx);
  tenants = tenantsFamily(ctx);
});

afterEach(async () => {
  await ctx.close();
});

afterAll(async () => {
  await admin.end();
});

async function seedBusiness() {
  return tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
}

// Every runtime field filled, nullable ones explicit — the create contract.
function fullCustomer(businessId: string, name: string) {
  return {
    businessId,
    name,
    phone: uniq("0917"),
    email: uniq("mail") + "@example.com",
    address: "123 Main St",
    notes: "Regular",
    isActive: true,
  };
}

function fullExpense(businessId: string, category: string) {
  return {
    businessId,
    category,
    amountMinor: 15000,
    description: "Delivery fuel",
    method: "CASH",
    shiftId: uniq("shift") as string | null,
    branchId: uniq("br") as string | null,
    expenseDate: new Date("2026-09-25T10:00:00.000Z"),
    actorId: "user_1",
    requestId: uniq("req"),
    attachmentUrl: "https://cdn.example/receipt.png",
    voidedAt: null,
    voidReason: null,
    cashAdjusted: true,
  };
}

describe("phase12 pg people: customers", () => {
  it("creates a customer with every field and finds it by id", async () => {
    const b = await seedBusiness();
    const input = fullCustomer(b.id, "Juan Dela Cruz");
    const created = (await people.createCustomer(input)) as DbCustomer;
    expect(created.id).toBeTruthy();
    expect(await people.findCustomerById(created.id, b.id)).toEqual({ ...input, id: created.id });
  });

  it("round-trips every nullable field as null", async () => {
    const b = await seedBusiness();
    const created = (await people.createCustomer({
      businessId: b.id, name: "Walk-in", phone: null, email: null, address: null,
      notes: null, isActive: true,
    })) as DbCustomer;
    expect(await people.findCustomerById(created.id, b.id)).toEqual(created);
  });

  it("partial-updates one field and preserves the rest; can null fields out", async () => {
    const b = await seedBusiness();
    const input = fullCustomer(b.id, "Maria Santos");
    const c = (await people.createCustomer(input)) as DbCustomer;
    const renamed = await people.updateCustomer(c.id, b.id, { name: "Maria C. Santos" });
    expect(renamed).toEqual({ ...input, id: c.id, name: "Maria C. Santos" });
    expect(await people.findCustomerById(c.id, b.id)).toEqual(renamed);
    // Absent keys unchanged; nullable keys patch to null explicitly.
    const cleared = await people.updateCustomer(c.id, b.id, { notes: null, isActive: false });
    expect(cleared).toEqual({ ...input, id: c.id, name: "Maria C. Santos", notes: null, isActive: false });
  });

  it("returns null for missing or cross-tenant customers", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const c = (await people.createCustomer(fullCustomer(b2.id, "Theirs"))) as DbCustomer;
    expect(await people.findCustomerById(c.id, b1.id)).toBeNull();
    expect(await people.findCustomerById("cust_none", b1.id)).toBeNull();
    expect(await people.updateCustomer(c.id, b1.id, { name: "X" })).toBeNull();
    expect(await people.updateCustomer("cust_none", b1.id, { name: "X" })).toBeNull();
  });

  it("lists only the business's customers in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const c1 = (await people.createCustomer(fullCustomer(b1.id, "A"))) as DbCustomer;
    await sleep(2); // TIMESTAMP(3) granularity: keep createdAt strictly increasing
    await people.createCustomer(fullCustomer(b2.id, "B"));
    await sleep(2);
    const c3 = (await people.createCustomer(fullCustomer(b1.id, "C"))) as DbCustomer;
    const rows = await people.listCustomersByBusiness(b1.id);
    expect(rows.map((r) => r.id)).toEqual([c1.id, c3.id]);
    expect(await people.listCustomersByBusiness("biz_empty")).toEqual([]);
  });
});

describe("phase12 pg people: refunds and items", () => {
  function fullRefund(businessId: string, saleId: string) {
    return {
      businessId,
      saleId,
      status: "APPROVED",
      totalMinor: 2500,
      reason: "Damaged item",
      requestedBy: "user_1",
      approvedBy: "user_2",
      requestId: uniq("req"),
      approvedRequestId: uniq("areq"),
      singleStep: true,
    };
  }

  it("creates a refund with every field and finds it by id; lists by sale", async () => {
    const b = await seedBusiness();
    const saleId = uniq("sale");
    const input = fullRefund(b.id, saleId);
    const created = (await people.createRefund(input)) as DbRefund;
    expect(created.id).toBeTruthy();
    expect(await people.findRefundById(created.id, b.id)).toEqual({ ...input, id: created.id });
    const rows = await people.listRefundsBySale(saleId, b.id);
    expect(rows.map((r) => r.id)).toEqual([created.id]);
  });

  it("creates two items and lists them by refund and by sale", async () => {
    const b = await seedBusiness();
    const saleId = uniq("sale");
    const refund = (await people.createRefund(fullRefund(b.id, saleId))) as DbRefund;
    const i1 = (await people.createRefundItem({
      businessId: b.id, refundId: refund.id, saleItemId: uniq("sitem"), productId: uniq("prod"),
      qty: 1, amountMinor: 1000, restocked: true,
    })) as DbRefundItem;
    const i2 = (await people.createRefundItem({
      businessId: b.id, refundId: refund.id, saleItemId: uniq("sitem"), productId: uniq("prod"),
      qty: 2, amountMinor: 1500, restocked: false,
    })) as DbRefundItem;
    // RefundItem has no createdAt: id order, like every other timestamp-less table.
    const byRefund = await people.listRefundItems(refund.id, b.id);
    expect(byRefund.map((r) => r.id).sort()).toEqual([i1.id, i2.id].sort());
    const bySale = await people.listRefundItemsBySale(saleId, b.id);
    expect(bySale.map((r) => r.id).sort()).toEqual([i1.id, i2.id].sort());
    // A second refund on the same sale is included; an unrelated refund is not.
    const refund2 = (await people.createRefund(fullRefund(b.id, saleId))) as DbRefund;
    const i3 = (await people.createRefundItem({
      businessId: b.id, refundId: refund2.id, saleItemId: uniq("sitem"), productId: uniq("prod"),
      qty: 1, amountMinor: 500, restocked: false,
    })) as DbRefundItem;
    expect((await people.listRefundItems(refund2.id, b.id)).map((r) => r.id)).toEqual([i3.id]);
    expect((await people.listRefundItemsBySale(saleId, b.id)).map((r) => r.id).sort()).toEqual(
      [i1.id, i2.id, i3.id].sort(),
    );
  });

  it("returns null/[] for missing or cross-tenant refunds and items", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const saleId = uniq("sale");
    const refund = (await people.createRefund(fullRefund(b2.id, saleId))) as DbRefund;
    await people.createRefundItem({
      businessId: b2.id, refundId: refund.id, saleItemId: uniq("sitem"), productId: uniq("prod"),
      qty: 1, amountMinor: 1000, restocked: false,
    });
    expect(await people.findRefundById(refund.id, b1.id)).toBeNull();
    expect(await people.findRefundById("ref_none", b1.id)).toBeNull();
    expect(await people.listRefundsBySale(saleId, b1.id)).toEqual([]);
    expect(await people.listRefundItems(refund.id, b1.id)).toEqual([]);
    expect(await people.listRefundItemsBySale(saleId, b1.id)).toEqual([]);
  });
});

describe("phase12 pg people: exchanges", () => {
  it("creates, finds and lists exchanges by original sale with tenant isolation", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const input = {
      businessId: b1.id,
      originalSaleId: uniq("sale-original"),
      refundId: uniq("refund"),
      replacementSaleId: uniq("sale-replacement"),
      returnMinor: 2500,
      replacementMinor: 3000,
      netMinor: 500,
      direction: "COLLECT" as const,
      reason: "Wrong size",
      actorId: "owner-1",
      requestId: uniq("req"),
    };
    const created = await people.createExchange(input) as DbExchange;
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await people.findExchangeById(created.id, b1.id)).toEqual(created);
    expect(await people.findExchangeById(created.id, b2.id)).toBeNull();
    expect(await people.listExchangesByOriginalSale(input.originalSaleId, b1.id)).toEqual([created]);
    expect(await people.listExchangesByOriginalSale(input.originalSaleId, b2.id)).toEqual([]);
    expect(await people.findExchangeByReplacementSale(input.replacementSaleId, b1.id)).toEqual(created);
    expect(await people.findExchangeByReplacementSale(input.replacementSaleId, b2.id)).toBeNull();
  });
});

describe("phase12 pg people: expenses", () => {
  it("creates an expense with every field and finds it by id", async () => {
    const b = await seedBusiness();
    const input = fullExpense(b.id, "FUEL");
    const created = (await people.createExpense(input)) as DbExpense;
    expect(created.id).toBeTruthy();
    expect(await people.findExpenseById(created.id, b.id)).toEqual({ ...input, id: created.id });
  });

  it("round-trips every nullable field as null (head-office, no attachment)", async () => {
    const b = await seedBusiness();
    const created = (await people.createExpense({
      businessId: b.id, category: "SUPPLIES", amountMinor: 5000, description: null,
      method: "CASH", shiftId: null, branchId: null, expenseDate: new Date("2026-09-25T08:00:00.000Z"),
      actorId: "user_1", requestId: uniq("req"), attachmentUrl: null,
      voidedAt: null, voidReason: null, cashAdjusted: false,
    })) as DbExpense;
    expect(await people.findExpenseById(created.id, b.id)).toEqual(created);
  });

  it("void-style update patches voidedAt/voidReason and a later patch clears them", async () => {
    const b = await seedBusiness();
    const input = fullExpense(b.id, "FUEL");
    const e = (await people.createExpense(input)) as DbExpense;
    const voidedAt = new Date("2026-09-25T12:00:00.000Z");
    const voided = await people.updateExpense(e.id, b.id, { voidedAt, voidReason: "Duplicate entry" });
    expect(voided).toEqual({ ...input, id: e.id, voidedAt, voidReason: "Duplicate entry" });
    expect(await people.findExpenseById(e.id, b.id)).toEqual(voided);
    // Absent keys unchanged; a null patch clears the void.
    const reopened = await people.updateExpense(e.id, b.id, { voidedAt: null, voidReason: null });
    expect(reopened).toEqual({ ...input, id: e.id, voidedAt: null, voidReason: null });
  });

  it("returns null for missing or cross-tenant expenses", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const e = (await people.createExpense(fullExpense(b2.id, "FUEL"))) as DbExpense;
    expect(await people.findExpenseById(e.id, b1.id)).toBeNull();
    expect(await people.findExpenseById("exp_none", b1.id)).toBeNull();
    expect(await people.updateExpense(e.id, b1.id, { amountMinor: 1 })).toBeNull();
    expect(await people.updateExpense("exp_none", b1.id, { amountMinor: 1 })).toBeNull();
  });

  it("lists only the business's expenses; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const e1 = (await people.createExpense(fullExpense(b1.id, "FUEL"))) as DbExpense;
    await people.createExpense(fullExpense(b2.id, "RENT"));
    const e3 = (await people.createExpense(fullExpense(b1.id, "SUPPLIES"))) as DbExpense;
    const rows = await people.listExpensesByBusiness(b1.id);
    expect(rows.map((r) => r.id).sort()).toEqual([e1.id, e3.id].sort());
    expect(await people.listExpensesByBusiness("biz_empty")).toEqual([]);
  });

  it("listExpensesPage pages ascending by id: afterId null gives the first N, then the cursor continues", async () => {
    const b = await seedBusiness();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const e = (await people.createExpense(fullExpense(b.id, `CAT${i}`))) as DbExpense;
      ids.push(e.id);
    }
    const sorted = [...ids].sort();
    expect((await people.listExpensesPage(b.id, null, 2)).map((e) => e.id)).toEqual(sorted.slice(0, 2));
    expect((await people.listExpensesPage(b.id, sorted[1], 2)).map((e) => e.id)).toEqual(sorted.slice(2, 4));
    expect((await people.listExpensesPage(b.id, sorted[3], 2)).map((e) => e.id)).toEqual(sorted.slice(4));
    expect(await people.listExpensesPage(b.id, sorted[4], 2)).toEqual([]);
    expect((await people.listExpensesPage(b.id, null, 10)).map((e) => e.id)).toEqual(sorted);
    // Another tenant's rows never leak into the page.
    const b2 = await seedBusiness();
    await people.createExpense(fullExpense(b2.id, "RENT"));
    expect((await people.listExpensesPage(b2.id, null, 10)).length).toBe(1);
    expect(await people.listExpensesPage("biz_empty", null, 10)).toEqual([]);
  });
});
