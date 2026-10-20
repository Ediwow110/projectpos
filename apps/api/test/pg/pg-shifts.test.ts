import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { shiftsFamily } from "../../src/common/pg/pg-shifts";
import type { DbShift } from "../../src/common/db.port";

// Shifts-family tests: the family runs directly over a fresh PgContext (no
// PgDbPort), mirroring the memory store's behavior — same tenant filters, same
// insertion ordering, null for missing/cross-tenant rows, [] for empty lists.
// Same disposable database as helpers.ts; PGTEST_BASE lets CI point at its
// own service container.
const URL = `${process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433"}/${process.env["PGTEST_DB"] ?? "pos_test_pg"}`;
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin: Client;
let ctx: PgContext;
let shifts: ReturnType<typeof shiftsFamily>;
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
  shifts = shiftsFamily(ctx);
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

async function seedBranch(businessId: string) {
  const id = uniq("br");
  await admin.query(
    'INSERT INTO "Branch" ("id", "businessId", "name", "type", "isActive", "createdAt", "updatedAt")' +
      " VALUES ($1, $2, $3, 'store', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    [id, businessId, uniq("Branch")],
  );
  return id;
}

// Every runtime field filled, nullable ones explicit — the create contract
// (mirrors shift.service.ts openShift).
function fullShift(businessId: string, registerId: string, branchId: string | null, openedBy: string) {
  return {
    businessId,
    registerId,
    branchId,
    status: "OPEN",
    openedBy,
    closedBy: null,
    openingFloatMinor: 5000,
    countedCashMinor: null,
    varianceMinor: null,
    cashSalesMinor: 0,
    cashRefundsMinor: 0,
    cashExpensesMinor: 0,
    cashDepositsMinor: 0,
    cashWithdrawalsMinor: 0,
    adjustmentsMinor: 0,
    expectedCashMinor: 0,
    closeNotes: null,
  };
}

async function seedRegister(businessId: string, branchId: string | null = null) {
  return shifts.createRegister({ businessId, name: uniq("Register"), isActive: true, branchId });
}

describe("phase12 pg shifts: registers", () => {
  it("creates a register and finds it by id", async () => {
    const b = await seedBusiness();
    const created = await seedRegister(b.id);
    expect(created.id).toBeTruthy();
    expect(created.branchId).toBeNull();
    expect(await shifts.findRegisterById(created.id, b.id)).toEqual(created);
  });

  it("round-trips a register's home branch", async () => {
    const b = await seedBusiness();
    const branchId = await seedBranch(b.id);
    const created = await seedRegister(b.id, branchId);
    expect(await shifts.findRegisterById(created.id, b.id)).toEqual(created);
  });

  it("partial-updates a register and preserves the untouched fields", async () => {
    const b = await seedBusiness();
    const branchId = await seedBranch(b.id);
    const r = await seedRegister(b.id);
    const renamed = await shifts.updateRegister(r.id, b.id, { name: uniq("Renamed"), branchId });
    expect(renamed).toEqual({ ...r, name: renamed!.name, branchId });
    // Absent keys unchanged, verified through an independent read.
    expect(await shifts.findRegisterById(r.id, b.id)).toEqual(renamed);
    const flipped = await shifts.updateRegister(r.id, b.id, { isActive: false });
    expect(flipped).toEqual({ ...renamed, isActive: false });
  });

  it("returns null for missing or cross-tenant registers", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const r = await seedRegister(b2.id);
    expect(await shifts.findRegisterById(r.id, b1.id)).toBeNull();
    expect(await shifts.findRegisterById("reg_none", b1.id)).toBeNull();
    expect(await shifts.updateRegister(r.id, b1.id, { name: "X" })).toBeNull();
    expect(await shifts.updateRegister("reg_none", b1.id, { name: "X" })).toBeNull();
  });

  it("lists only the business's registers in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const r1 = await seedRegister(b1.id);
    await sleep(2); // TIMESTAMP(3) granularity: keep createdAt strictly increasing
    await seedRegister(b2.id);
    await sleep(2);
    const r3 = await seedRegister(b1.id);
    const rows = await shifts.listRegisters(b1.id);
    expect(rows.map((r) => r.id)).toEqual([r1.id, r3.id]);
    expect(await shifts.listRegisters("biz_empty")).toEqual([]);
  });
});

describe("phase12 pg shifts: shifts", () => {
  it("creates a shift with every counter and finds it", async () => {
    const b = await seedBusiness();
    const reg = await seedRegister(b.id);
    const branchId = await seedBranch(b.id);
    const input = fullShift(b.id, reg.id, branchId, "user_1");
    const created = await shifts.createShift(input);
    expect(created.id).toBeTruthy();
    expect(await shifts.findShiftById(created.id, b.id)).toEqual({ ...input, id: created.id });
  });

  it("partial-updates a shift (close-style patch sets status and counters) and preserves the rest", async () => {
    const b = await seedBusiness();
    const reg = await seedRegister(b.id);
    const created = (await shifts.createShift(fullShift(b.id, reg.id, null, "user_1"))) as DbShift;
    const closed = await shifts.updateShift(created.id, b.id, {
      status: "CLOSED",
      closedBy: "user_2",
      countedCashMinor: 4800,
      varianceMinor: -200,
      cashSalesMinor: 1200,
      cashRefundsMinor: -300,
      cashExpensesMinor: -500,
      cashDepositsMinor: 2000,
      cashWithdrawalsMinor: -1000,
      adjustmentsMinor: -100,
      expectedCashMinor: 5000,
      closeNotes: "short",
    });
    // openingFloatMinor and openedBy are absent keys: unchanged.
    expect(closed).toEqual({ ...created, status: "CLOSED", closedBy: "user_2", countedCashMinor: 4800,
      varianceMinor: -200, cashSalesMinor: 1200, cashRefundsMinor: -300, cashExpensesMinor: -500,
      cashDepositsMinor: 2000, cashWithdrawalsMinor: -1000, adjustmentsMinor: -100,
      expectedCashMinor: 5000, closeNotes: "short" });
    expect(await shifts.findShiftById(created.id, b.id)).toEqual(closed);
  });

  it("returns null for missing or cross-tenant shifts", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const reg = await seedRegister(b2.id);
    const s = await shifts.createShift(fullShift(b2.id, reg.id, null, "user_1"));
    expect(await shifts.findShiftById(s.id, b1.id)).toBeNull();
    expect(await shifts.findShiftById("shift_none", b1.id)).toBeNull();
    expect(await shifts.updateShift(s.id, b1.id, { status: "CLOSED" })).toBeNull();
    expect(await shifts.updateShift("shift_none", b1.id, { status: "CLOSED" })).toBeNull();
  });

  it("lists only the business's shifts in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const reg1 = await seedRegister(b1.id);
    const reg2 = await seedRegister(b2.id);
    const s1 = await shifts.createShift(fullShift(b1.id, reg1.id, null, "user_1"));
    await sleep(2);
    await shifts.createShift(fullShift(b2.id, reg2.id, null, "user_1"));
    await sleep(2);
    const s3 = await shifts.createShift(fullShift(b1.id, reg1.id, null, "user_1"));
    const rows = await shifts.listShiftsByBusiness(b1.id);
    expect(rows.map((s) => s.id)).toEqual([s1.id, s3.id]);
    expect(await shifts.listShiftsByBusiness("biz_empty")).toEqual([]);
  });

  it("findOpenShiftByRegister returns the open shift, and null after it is closed or cross-tenant", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const reg = await seedRegister(b1.id);
    const other = await seedRegister(b1.id);
    const s = await shifts.createShift(fullShift(b1.id, reg.id, null, "user_1"));
    expect(await shifts.findOpenShiftByRegister(b1.id, reg.id)).toEqual(s);
    // A different register of the same business has no open shift.
    expect(await shifts.findOpenShiftByRegister(b1.id, other.id)).toBeNull();
    // Cross-tenant: the register id exists, the tenant does not own it.
    expect(await shifts.findOpenShiftByRegister(b2.id, reg.id)).toBeNull();
    const closed = await shifts.updateShift(s.id, b1.id, { status: "CLOSED" });
    expect(closed!.status).toBe("CLOSED");
    expect(await shifts.findOpenShiftByRegister(b1.id, reg.id)).toBeNull();
  });

  it("hasShiftForRegister is true for any shift regardless of status, false otherwise", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const reg = await seedRegister(b1.id);
    const other = await seedRegister(b1.id);
    expect(await shifts.hasShiftForRegister(b1.id, reg.id)).toBe(false);
    const s = await shifts.createShift(fullShift(b1.id, reg.id, null, "user_1"));
    expect(await shifts.hasShiftForRegister(b1.id, reg.id)).toBe(true);
    expect(await shifts.hasShiftForRegister(b1.id, other.id)).toBe(false);
    expect(await shifts.hasShiftForRegister(b2.id, reg.id)).toBe(false);
    await shifts.updateShift(s.id, b1.id, { status: "CLOSED" });
    expect(await shifts.hasShiftForRegister(b1.id, reg.id)).toBe(true);
  });
});

describe("phase12 pg shifts: cash movements", () => {
  it("creates movements with signed amounts and lists them by shift in insertion order", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const reg1 = await seedRegister(b1.id);
    const reg2 = await seedRegister(b2.id);
    const s1 = await shifts.createShift(fullShift(b1.id, reg1.id, null, "user_1"));
    const s2 = await shifts.createShift(fullShift(b2.id, reg2.id, null, "user_1"));
    const branchId = await seedBranch(b1.id);
    const m1 = await shifts.createCashMovement({
      businessId: b1.id, shiftId: s1.id, registerId: reg1.id, branchId: null,
      type: "cash_sale", amountMinor: 5000, reason: null, referenceType: null,
      referenceId: null, actorId: "user_1", requestId: "req_1",
    });
    const m2 = await shifts.createCashMovement({
      businessId: b1.id, shiftId: s1.id, registerId: reg1.id, branchId,
      type: "cash_refund", amountMinor: -1200, reason: "broken item", referenceType: "Sale",
      referenceId: "sale_1", actorId: "user_1", requestId: "req_2",
    });
    await shifts.createCashMovement({
      businessId: b2.id, shiftId: s2.id, registerId: reg2.id, branchId: null,
      type: "cash_expense", amountMinor: -300, reason: "supplies", referenceType: null,
      referenceId: null, actorId: "user_1", requestId: "req_3",
    });
    const rows = await shifts.listCashMovementsByShift(s1.id, b1.id);
    expect(rows.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(rows[1]).toEqual(m2);
    // Cross-tenant: the shift id exists, the tenant does not own it.
    expect(await shifts.listCashMovementsByShift(s1.id, b2.id)).toEqual([]);
    expect(await shifts.listCashMovementsByShift("shift_none", b1.id)).toEqual([]);
  });
});
