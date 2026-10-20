import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { branchesFamily } from "../../src/common/pg/pg-branches";
import type { DbStockTransfer } from "../../src/common/db.port";

// Branches-family tests: the family runs directly over a fresh PgContext (no
// PgDbPort), mirroring the memory store's behavior — same tenant filters, the
// name-ordered branch list, insertion-ordered transfers/lines, null for
// missing/cross-tenant rows, [] for empty lists. Same disposable database as
// helpers.ts; PGTEST_BASE lets CI point at its own service container.
const URL = `${process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433"}/${process.env["PGTEST_DB"] ?? "pos_test_pg"}`;
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin: Client;
let ctx: PgContext;
let branches: ReturnType<typeof branchesFamily>;
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
  branches = branchesFamily(ctx);
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

// Distinct first letters so "sorted by name" is deterministic regardless of
// the unique suffix.
const NAME_A = () => uniq("Alpha-");
const NAME_B = () => uniq("Beta-");

// Every runtime field filled, nullable ones explicit — the create contract.
function fullTransfer(businessId: string, fromBranchId: string, toBranchId: string): Omit<DbStockTransfer, "id"> {
  return {
    businessId,
    fromBranchId,
    toBranchId,
    status: "DRAFT",
    requestedBy: "user_req",
    dispatchedBy: null,
    receivedBy: null,
    requestId: uniq("req"),
  };
}

describe("phase12 pg branches: branches", () => {
  it("creates a branch and finds it by id", async () => {
    const b = await seedBusiness();
    const created = await branches.createBranch({
      businessId: b.id, name: NAME_A(), type: "store", isActive: true,
    });
    expect(created.id).toBeTruthy();
    expect(await branches.findBranchById(created.id, b.id)).toEqual(created);
  });

  it("partial-updates a branch and preserves the untouched fields", async () => {
    const b = await seedBusiness();
    const created = await branches.createBranch({
      businessId: b.id, name: NAME_A(), type: "store", isActive: true,
    });
    const renamed = await branches.updateBranch(created.id, b.id, { name: NAME_B() });
    expect(renamed).toEqual({ ...created, name: renamed!.name });
    // Absent keys unchanged, verified through an independent read.
    expect(await branches.findBranchById(created.id, b.id)).toEqual(renamed);
    const flipped = await branches.updateBranch(created.id, b.id, { isActive: false });
    expect(flipped).toEqual({ ...renamed, isActive: false });
  });

  it("returns null for missing or cross-tenant branches", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const branch = await branches.createBranch({
      businessId: b2.id, name: NAME_A(), type: "store", isActive: true,
    });
    expect(await branches.findBranchById(branch.id, b1.id)).toBeNull();
    expect(await branches.findBranchById("br_none", b1.id)).toBeNull();
    expect(await branches.updateBranch(branch.id, b1.id, { name: "X" })).toBeNull();
    expect(await branches.updateBranch("br_none", b1.id, { name: "X" })).toBeNull();
  });

  it("lists only the business's branches sorted by name; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const beta = await branches.createBranch({
      businessId: b1.id, name: NAME_B(), type: "store", isActive: true,
    });
    await branches.createBranch({ businessId: b2.id, name: NAME_A(), type: "warehouse", isActive: true });
    const alpha = await branches.createBranch({
      businessId: b1.id, name: NAME_A(), type: "store", isActive: false,
    });
    const rows = await branches.listBranchesByBusiness(b1.id);
    expect(rows.map((r) => r.id)).toEqual([alpha.id, beta.id]);
    expect(await branches.listBranchesByBusiness("biz_empty")).toEqual([]);
  });
});

describe("phase12 pg branches: transfers", () => {
  it("creates a transfer with two lines and reads them back", async () => {
    const b = await seedBusiness();
    const from = await branches.createBranch({ businessId: b.id, name: NAME_A(), type: "store", isActive: true });
    const to = await branches.createBranch({ businessId: b.id, name: NAME_B(), type: "warehouse", isActive: true });
    const t = await branches.createTransfer(fullTransfer(b.id, from.id, to.id));
    expect(t.id).toBeTruthy();
    const line1 = await branches.createTransferLine({
      businessId: b.id, transferId: t.id, productId: "prod_1", qty: 5,
    });
    await sleep(2); // distinct nid timestamp bucket: keeps id-order == insertion-order
    const line2 = await branches.createTransferLine({
      businessId: b.id, transferId: t.id, productId: "prod_2", qty: 3,
    });
    expect(await branches.findTransferById(t.id, b.id)).toEqual(t);
    expect(await branches.listTransferLines(t.id, b.id)).toEqual([line1, line2]);
  });

  it("patches the transfer through its state transitions and preserves absent keys", async () => {
    const b = await seedBusiness();
    const t = await branches.createTransfer(fullTransfer(b.id, "br_from", "br_to"));
    const dispatched = await branches.updateTransfer(t.id, b.id, {
      status: "IN_TRANSIT", dispatchedBy: "user_dispatch",
    });
    expect(dispatched).toEqual({ ...t, status: "IN_TRANSIT", dispatchedBy: "user_dispatch" });
    expect(await branches.findTransferById(t.id, b.id)).toEqual(dispatched);
    const received = await branches.updateTransfer(t.id, b.id, {
      status: "RECEIVED", receivedBy: "user_recv",
    });
    // dispatchedBy was set by the earlier patch and must survive this one.
    expect(received).toEqual({ ...dispatched, status: "RECEIVED", receivedBy: "user_recv" });
  });

  it("returns null / [] for missing or cross-tenant transfers", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const t = await branches.createTransfer(fullTransfer(b2.id, "br_from", "br_to"));
    await branches.createTransferLine({ businessId: b2.id, transferId: t.id, productId: "prod_1", qty: 1 });
    expect(await branches.findTransferById(t.id, b1.id)).toBeNull();
    expect(await branches.findTransferById("trx_none", b1.id)).toBeNull();
    expect(await branches.updateTransfer(t.id, b1.id, { status: "CANCELLED" })).toBeNull();
    expect(await branches.updateTransfer("trx_none", b1.id, { status: "CANCELLED" })).toBeNull();
    expect(await branches.listTransferLines(t.id, b1.id)).toEqual([]);
  });

  it("lists only the business's transfers in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const t1 = await branches.createTransfer(fullTransfer(b1.id, "br_from", "br_to"));
    await sleep(2); // TIMESTAMP(3) granularity: keep createdAt strictly increasing
    await branches.createTransfer(fullTransfer(b2.id, "br_from", "br_to"));
    await sleep(2);
    const t3 = await branches.createTransfer(fullTransfer(b1.id, "br_from", "br_to"));
    const rows = await branches.listTransfersByBusiness(b1.id);
    expect(rows.map((r) => r.id)).toEqual([t1.id, t3.id]);
    expect(await branches.listTransfersByBusiness("biz_empty")).toEqual([]);
  });
});
