import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PgContext } from "../../src/common/pg/context";
import { PgDbPort } from "../../src/common/pg/pg.db";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { integrationsFamily } from "../../src/common/pg/pg-integrations";
import { SupportGrantService } from "../../src/billing/nest/support-grant.service";

// Integrations-family tests: api tokens, printers, print jobs, display tokens,
// support grants, shift corrections and receipt shares. The family runs
// directly over a fresh PgContext (no PgDbPort), mirroring the memory store's
// behavior — same tenant filters, same ordering, null for missing/cross-tenant
// rows. Isolated database (pos_test_integ) so sibling pg suites sharing
// pos_test_pg cannot race it; the bootstrap is idempotent.
const BASE_URL = process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433";
const TEST_DB = "pos_test_integ";
const URL = `${BASE_URL}/${TEST_DB}`;
const MIGRATIONS_DIR = join(__dirname, "../../../../packages/database/prisma/migrations");
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let bootstrapped: Promise<void> | null = null;

async function bootstrapDatabase(): Promise<void> {
  const admin = new Client({ connectionString: `${BASE_URL}/postgres` });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${TEST_DB} OWNER pos`);
    }
  } catch (e) {
    // A concurrent bootstrap may have created it first; that is fine.
    if ((e as { code?: string }).code !== "42P04") throw e;
  } finally {
    await admin.end();
  }

  const client = new Client({ connectionString: URL });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS "_migrations" ("name" TEXT PRIMARY KEY)');
    const applied = new Set(
      (await client.query('SELECT "name" FROM "_migrations"')).rows.map((r) => r.name as string),
    );
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      if (applied.has(dir)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
      await client.query(sql);
      await client.query('INSERT INTO "_migrations" ("name") VALUES ($1)', [dir]);
    }
  } finally {
    await client.end();
  }
}

let admin: Client;
let ctx: PgContext;
let tenants: ReturnType<typeof tenantsFamily>;
let integrations: ReturnType<typeof integrationsFamily>;

beforeAll(async () => {
  if (!bootstrapped) bootstrapped = bootstrapDatabase();
  await bootstrapped;
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
  tenants = tenantsFamily(ctx);
  integrations = integrationsFamily(ctx);
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

// ShiftCorrection rows reference a real shift (and its register); the family
// has no create methods for those, so the fixture seeds them directly.
async function seedShift(businessId: string) {
  const registerId = `reg_${uniq("r")}`;
  await admin.query(
    'INSERT INTO "Register" ("id", "businessId", "name", "isActive", "createdAt", "updatedAt")' +
      " VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    [registerId, businessId, uniq("Register")],
  );
  const shiftId = `shift_${uniq("s")}`;
  await admin.query(
    'INSERT INTO "Shift" ("id", "businessId", "registerId", "status", "openedBy", "openedAt")' +
      " VALUES ($1, $2, $3, 'OPEN', 'user_fixture', CURRENT_TIMESTAMP)",
    [shiftId, businessId, registerId],
  );
  return shiftId;
}

describe("phase12 pg integrations: api tokens", () => {
  it("creates a token and finds it by prefix", async () => {
    const b = await seedBusiness();
    const input = {
      businessId: b.id, name: "CI", tokenHash: uniq("hash"), prefix: uniq("prfx"),
      scopes: ["sales.write", "products.read"], revokedAt: null, expiresAt: null as Date | null,
    };
    const created = await integrations.createApiToken(input);
    expect(created.id).toBeTruthy();
    expect(await integrations.findApiTokenByPrefix(input.prefix)).toEqual(created);
  });

  it("lists only the business's tokens in insertion order; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const t1 = await integrations.createApiToken({
      businessId: b1.id, name: "A", tokenHash: uniq("h"), prefix: uniq("p"),
      scopes: [], revokedAt: null, expiresAt: null,
    });
    await sleep(2); // TIMESTAMP(3) granularity: keep createdAt strictly increasing
    await integrations.createApiToken({
      businessId: b2.id, name: "B", tokenHash: uniq("h"), prefix: uniq("p"),
      scopes: [], revokedAt: null, expiresAt: null,
    });
    await sleep(2);
    const t3 = await integrations.createApiToken({
      businessId: b1.id, name: "C", tokenHash: uniq("h"), prefix: uniq("p"),
      scopes: [], revokedAt: null, expiresAt: null,
    });
    const rows = await integrations.listApiTokens(b1.id);
    expect(rows.map((r) => r.id)).toEqual([t1.id, t3.id]);
    expect(await integrations.listApiTokens("biz_empty")).toEqual([]);
  });

  it("find-by-prefix returns the first token; list-by-prefix returns every candidate", async () => {
    const b = await seedBusiness();
    const prefix = uniq("prfx");
    const t1 = await integrations.createApiToken({
      businessId: b.id, name: "first", tokenHash: uniq("h"), prefix,
      scopes: ["sales.write"], revokedAt: null, expiresAt: null,
    });
    await sleep(2);
    const t2 = await integrations.createApiToken({
      businessId: b.id, name: "second", tokenHash: uniq("h"), prefix,
      scopes: ["products.read"], revokedAt: null, expiresAt: null,
    });
    // A short prefix can collide: find returns the first, list returns all —
    // the guard verifies the full hash against every candidate.
    expect((await integrations.findApiTokenByPrefix(prefix))!.id).toBe(t1.id);
    expect((await integrations.listApiTokensByPrefix(prefix)).map((t) => t.id)).toEqual([t1.id, t2.id]);
    expect(await integrations.findApiTokenByPrefix("prfx_none")).toBeNull();
    expect(await integrations.listApiTokensByPrefix("prfx_none")).toEqual([]);
  });

  it("revoke stamps revokedAt and is tenant-guarded", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const t = await integrations.createApiToken({
      businessId: b1.id, name: "CI", tokenHash: uniq("h"), prefix: uniq("p"),
      scopes: [], revokedAt: null, expiresAt: null,
    });
    const at = new Date();
    const revoked = await integrations.revokeApiToken(t.id, b1.id, at);
    expect(revoked).toEqual({ ...t, revokedAt: at });
    // Cross-tenant and unknown ids return null without touching the row.
    expect(await integrations.revokeApiToken(t.id, b2.id, at)).toBeNull();
    expect(await integrations.revokeApiToken("tok_none", b1.id, at)).toBeNull();
    expect((await integrations.listApiTokens(b1.id))[0]!.revokedAt).toEqual(at);
  });
});

describe("phase12 pg integrations: printers", () => {
  it("creates a printer and finds it by id; cross-tenant/missing -> null", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const input = {
      businessId: b1.id, branchId: null as string | null, name: uniq("Front desk"),
      width: "80", connection: "test-double", agentTokenHash: uniq("agent"),
    };
    const created = await integrations.createPrinter(input);
    expect(created.id).toBeTruthy();
    expect(await integrations.findPrinterById(created.id, b1.id)).toEqual(created);
    expect(await integrations.findPrinterById(created.id, b2.id)).toBeNull();
    expect(await integrations.findPrinterById("prt_none", b1.id)).toBeNull();
  });

  it("lists only the business's printers; empty -> []", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const p1 = await integrations.createPrinter({
      businessId: b1.id, branchId: null, name: uniq("P1"), width: "80",
      connection: "test-double", agentTokenHash: null,
    });
    await integrations.createPrinter({
      businessId: b2.id, branchId: null, name: uniq("P2"), width: "58",
      connection: "test-double", agentTokenHash: null,
    });
    const p3 = await integrations.createPrinter({
      businessId: b1.id, branchId: null, name: uniq("P3"), width: "80",
      connection: "usb", agentTokenHash: null,
    });
    const rows = await integrations.listPrinters(b1.id);
    expect(rows.map((r) => r.id)).toEqual([p1.id, p3.id]);
    expect(await integrations.listPrinters("biz_empty")).toEqual([]);
  });

  it("finds a printer by agent token hash; null hashes never match", async () => {
    const b = await seedBusiness();
    const agentHash = uniq("agent");
    const paired = await integrations.createPrinter({
      businessId: b.id, branchId: null, name: uniq("Paired"), width: "80",
      connection: "agent", agentTokenHash: agentHash,
    });
    await integrations.createPrinter({
      businessId: b.id, branchId: null, name: uniq("Legacy"), width: "80",
      connection: "test-double", agentTokenHash: null,
    });
    expect((await integrations.findPrinterByAgentTokenHash(agentHash))!.id).toBe(paired.id);
    expect(await integrations.findPrinterByAgentTokenHash("agent_none")).toBeNull();
  });

  it("updates printer settings and last-seen state with tenant isolation", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const printer = await integrations.createPrinter({
      businessId: b1.id, branchId: null, name: uniq("Printer"), width: "80",
      connection: "manual", agentTokenHash: uniq("agent"), lastSeenAt: null,
    });
    const seen = new Date("2026-10-01T00:00:00.000Z");
    expect(await integrations.updatePrinter(printer.id, b2.id, { lastSeenAt: seen })).toBeNull();
    const updated = await integrations.updatePrinter(printer.id, b1.id, {
      name: "Updated printer",
      width: "58",
      lastSeenAt: seen,
    });
    expect(updated).toMatchObject({ name: "Updated printer", width: "58", lastSeenAt: seen });
    expect(await integrations.findPrinterById(printer.id, b1.id)).toEqual(updated);
  });
});

describe("phase12 pg integrations: print jobs", () => {
  async function seedPrinter(businessId: string) {
    return integrations.createPrinter({
      businessId, branchId: null, name: uniq("P"), width: "80",
      connection: "test-double", agentTokenHash: null,
    });
  }

  it("creates a job and lists it FIFO per business", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const p1 = await seedPrinter(b1.id);
    const p2 = await seedPrinter(b2.id);
    const j1 = await integrations.createPrintJob({
      businessId: b1.id, printerId: p1.id, receiptNo: "R-1", layout: "80",
      status: "QUEUED", payload: "payload-1", attempts: 0, createdAt: new Date(),
    });
    expect(j1.id).toBeTruthy();
    await sleep(2);
    await integrations.createPrintJob({
      businessId: b2.id, printerId: p2.id, receiptNo: "R-2", layout: "80",
      status: "QUEUED", payload: "payload-2", attempts: 0, createdAt: new Date(),
    });
    await sleep(2);
    const j3 = await integrations.createPrintJob({
      businessId: b1.id, printerId: p1.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "payload-3", attempts: 0, createdAt: new Date(),
    });
    const rows = await integrations.listPrintJobs(b1.id);
    expect(rows.map((j) => j.id)).toEqual([j1.id, j3.id]);
    expect(rows[0]).toEqual(j1);
    expect(await integrations.listPrintJobs("biz_empty")).toEqual([]);
  });

  it("filters listPrintJobs by status", async () => {
    const b = await seedBusiness();
    const p = await seedPrinter(b.id);
    const j1 = await integrations.createPrintJob({
      businessId: b.id, printerId: p.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "p1", attempts: 0, createdAt: new Date(),
    });
    await sleep(2);
    const j2 = await integrations.createPrintJob({
      businessId: b.id, printerId: p.id, receiptNo: null, layout: "80",
      status: "SENT", payload: "p2", attempts: 1, createdAt: new Date(),
    });
    expect((await integrations.listPrintJobs(b.id, "QUEUED")).map((j) => j.id)).toEqual([j1.id]);
    expect((await integrations.listPrintJobs(b.id, "SENT")).map((j) => j.id)).toEqual([j2.id]);
    expect((await integrations.listPrintJobs(b.id)).map((j) => j.id)).toEqual([j1.id, j2.id]);
  });

  it("updatePrintJob applies a plain patch and persists it", async () => {
    const b = await seedBusiness();
    const p = await seedPrinter(b.id);
    const j = await integrations.createPrintJob({
      businessId: b.id, printerId: p.id, receiptNo: "R-9", layout: "80",
      status: "QUEUED", payload: "payload", attempts: 0, createdAt: new Date(),
    });
    const updated = await integrations.updatePrintJob(j.id, b.id, { status: "SENT", attempts: 1 });
    expect(updated).toEqual({ ...j, status: "SENT", attempts: 1 });
    // Verified through an independent read; untouched fields stay as-is.
    expect((await integrations.listPrintJobs(b.id))[0]).toEqual(updated);
  });

  it("updatePrintJob CAS: matching expectedStatus applies, mismatch returns null and leaves the row", async () => {
    const b = await seedBusiness();
    const b2 = await seedBusiness();
    const p = await seedPrinter(b.id);
    const j = await integrations.createPrintJob({
      businessId: b.id, printerId: p.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "payload", attempts: 0, createdAt: new Date(),
    });
    // Matching expected status: the atomic claim applies.
    const claimed = await integrations.updatePrintJob(j.id, b.id, { status: "SENT", attempts: 1 }, "QUEUED");
    expect(claimed).toEqual({ ...j, status: "SENT", attempts: 1 });
    // Mismatching expected status: null, and the row is NOT modified.
    expect(await integrations.updatePrintJob(j.id, b.id, { status: "FAILED" }, "QUEUED")).toBeNull();
    expect((await integrations.listPrintJobs(b.id))[0]!.status).toBe("SENT");
    // Cross-tenant and unknown ids: null, guarded before the status check.
    expect(await integrations.updatePrintJob(j.id, b2.id, { status: "FAILED" })).toBeNull();
    expect(await integrations.updatePrintJob("pjob_none", b.id, { status: "FAILED" })).toBeNull();
  });

  it("finds a print job by id only inside its business", async () => {
    const b1 = await seedBusiness();
    const b2 = await seedBusiness();
    const p = await seedPrinter(b1.id);
    const job = await integrations.createPrintJob({
      businessId: b1.id, printerId: p.id, receiptNo: "R-FIND", layout: "80",
      status: "QUEUED", payload: "payload", attempts: 0, createdAt: new Date(),
    });
    expect(await integrations.findPrintJobById(job.id, b1.id)).toEqual(job);
    expect(await integrations.findPrintJobById(job.id, b2.id)).toBeNull();
    expect(await integrations.findPrintJobById("pjob_none", b1.id)).toBeNull();
  });
});

describe("phase12 pg integrations: display tokens", () => {
  it("creates a display token and finds it by hash", async () => {
    const b = await seedBusiness();
    const input = {
      businessId: b.id, registerId: "reg_1", tokenHash: uniq("dhash"),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const created = await integrations.createDisplayToken(input);
    expect(created.id).toBeTruthy();
    expect(await integrations.findDisplayToken(input.tokenHash)).toEqual(created);
    expect(await integrations.findDisplayToken("dhash_none")).toBeNull();
  });

  it("returns expired display tokens — the service filters expiry", async () => {
    const b = await seedBusiness();
    const expired = await integrations.createDisplayToken({
      businessId: b.id, registerId: "reg_1", tokenHash: uniq("dhash"),
      expiresAt: new Date(Date.now() - 60_000),
    });
    // Memory findDisplayToken ignores expiry; the display feed checks it.
    expect(await integrations.findDisplayToken(expired.tokenHash)).toEqual(expired);
  });
});

describe("phase12 pg integrations: support grants", () => {
  it("mint path: create -> find valid -> mark used -> find null", async () => {
    const hash = uniq("ghash");
    const expiresAt = new Date(Date.now() + 60_000);
    const g = await integrations.createSupportGrant({
      purpose: "impersonate", actorId: "ops", tokenHash: hash, expiresAt,
    });
    expect(g.id).toBeTruthy();
    expect(await integrations.findValidSupportGrant("ghash_none")).toBeNull();
    expect(await integrations.findValidSupportGrant(hash)).toEqual({
      id: g.id, purpose: "impersonate", actorId: "ops", expiresAt,
    });
    await integrations.markSupportGrantUsed(g.id);
    expect(await integrations.findValidSupportGrant(hash)).toBeNull();
  });

  it("expired grant is not valid", async () => {
    const hash = uniq("ghash");
    await integrations.createSupportGrant({
      purpose: "impersonate", actorId: "ops", tokenHash: hash,
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await integrations.findValidSupportGrant(hash)).toBeNull();
  });

  it("manager approval grants are tenant/requester/scope bound and one-use", async () => {
    const business = await seedBusiness();
    const tokenHash = `mgr-hash-${Date.now()}`;
    const grant = await integrations.createManagerApprovalGrant({
      businessId: business.id,
      requesterId: "cashier-1",
      approverId: "manager-1",
      permission: "discount.override",
      fingerprint: "cart-fingerprint",
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await integrations.findValidManagerApprovalGrant(
      tokenHash,
      business.id,
      "cashier-1",
      "discount.override",
    )).toEqual(expect.objectContaining({
      id: grant.id,
      approverId: "manager-1",
      fingerprint: "cart-fingerprint",
    }));
    expect(await integrations.findValidManagerApprovalGrant(
      tokenHash,
      business.id,
      "other-cashier",
      "discount.override",
    )).toBeNull();
    await integrations.markManagerApprovalGrantUsed(grant.id);
    expect(await integrations.findValidManagerApprovalGrant(
      tokenHash,
      business.id,
      "cashier-1",
      "discount.override",
    )).toBeNull();
  });

  it("atomically claims a one-time grant under concurrent PostgreSQL requests", async () => {
    const service = new SupportGrantService(new PgDbPort(ctx));
    const grant = await service.mint(
      { purpose: "concurrent pg support", ttlMinutes: 30, actorId: "ops" },
      uniq("rq"),
    );

    const resolved = await Promise.all([
      service.resolve(grant.token),
      service.resolve(grant.token),
    ]);

    expect(resolved.filter((entry) => entry !== null)).toHaveLength(1);
    expect(resolved.filter((entry) => entry === null)).toHaveLength(1);
  });
});

describe("phase12 pg integrations: shift corrections", () => {
  it("creates a correction and lists them per shift in createdAt order", async () => {
    const b = await seedBusiness();
    const shift1 = await seedShift(b.id);
    const shift2 = await seedShift(b.id);
    const c1 = await integrations.createShiftCorrection({
      businessId: b.id, shiftId: shift1, amountMinor: -500, reason: "counted early",
      actorId: "u1", requestId: uniq("rq"),
    });
    expect(c1.id).toBeTruthy();
    expect(c1.createdAt).toBeInstanceOf(Date);
    await sleep(2); // TIMESTAMP(3) granularity: keep createdAt strictly increasing
    const c2 = await integrations.createShiftCorrection({
      businessId: b.id, shiftId: shift1, amountMinor: 250, reason: "drawer fix",
      actorId: "u2", requestId: uniq("rq"),
    });
    await sleep(2);
    const c3 = await integrations.createShiftCorrection({
      businessId: b.id, shiftId: shift2, amountMinor: 100, reason: "other shift",
      actorId: "u1", requestId: uniq("rq"),
    });
    expect((await integrations.listShiftCorrections(b.id, shift1)).map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect((await integrations.listShiftCorrections(b.id, shift2)).map((c) => c.id)).toEqual([c3.id]);
    expect(await integrations.listShiftCorrections("biz_empty", shift1)).toEqual([]);
  });
});

describe("phase12 pg integrations: receipt shares", () => {
  it("finds a valid receipt share; expired -> null", async () => {
    const b = await seedBusiness();
    const hash = uniq("rhash");
    const expiresAt = new Date(Date.now() + 60_000);
    const s = await integrations.createReceiptShare({
      businessId: b.id, saleId: "sale1", tokenHash: hash, expiresAt,
    });
    expect(s.id).toBeTruthy();
    expect(await integrations.findValidReceiptShare("rhash_none")).toBeNull();
    expect(await integrations.findValidReceiptShare(hash)).toEqual({
      id: s.id, businessId: b.id, saleId: "sale1", expiresAt,
    });
    const expiredHash = uniq("rhash");
    await integrations.createReceiptShare({
      businessId: b.id, saleId: "sale2", tokenHash: expiredHash,
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await integrations.findValidReceiptShare(expiredHash)).toBeNull();
  });

  it("claims receipt email delivery idempotently and persists status transitions", async () => {
    const business = await seedBusiness();
    const saleId = `sale_${uniq("receipt")}`;
    await admin.query(
      'INSERT INTO "Sale" ("id", "businessId", "receiptNo", "status", "subtotalMinor", "discountMinor", "taxMinor", "totalMinor", "paidMinor", "changeMinor", "currency", "actorId", "requestId", "createdAt", "updatedAt")' +
        " VALUES ($1,$2,$3,'COMPLETED',1000,0,0,1000,1000,0,'PHP','u1','r1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      [saleId, business.id, uniq("PG-R")],
    );
    const input = {
      businessId: business.id,
      saleId,
      channel: "email" as const,
      recipient: "customer@example.com",
      status: "PENDING" as const,
      idempotencyKey: "pg-receipt-delivery-key",
      errorCode: null,
      sentAt: null,
    };
    const first = await integrations.claimReceiptDelivery(input);
    const replay = await integrations.claimReceiptDelivery(input);
    expect(first.claimed).toBe(true);
    expect(replay.claimed).toBe(false);
    expect(replay.delivery.id).toBe(first.delivery.id);
    const sentAt = new Date();
    const sent = await integrations.updateReceiptDelivery(first.delivery.id, business.id, { status: "SENT", sentAt });
    expect(sent).toMatchObject({ status: "SENT", recipient: "customer@example.com" });
    expect(await integrations.listReceiptDeliveries(business.id, saleId)).toEqual([
      expect.objectContaining({ id: first.delivery.id, status: "SENT" }),
    ]);
  });
});
