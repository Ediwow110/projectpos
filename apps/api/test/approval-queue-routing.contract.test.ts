import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

const priorKey = process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
const ownerEmail = "queue-route-owner@example.com";
const ownerPassword = "correct-horse-12";

function cookies(headers: unknown): string {
  const array = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return array.map((value) => String(value).split(";")[0]).join("; ");
}

describe("assigned-branch approval queue HTTP routes", () => {
  let app: INestApplication;
  let db: DbPort;
  let businessId: string;
  let branchId: string;
  let remoteBranchId: string;
  let registerId: string;
  let productId: string;
  let ownerCookie: string;
  let ownerCsrf: string;
  let cashierCookie: string;
  let cashierCsrf: string;

  beforeAll(async () => {
    process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = "c8".repeat(32);
    app = await createTestApp({ completedOnboardingFixture: true });
    db = app.get<DbPort>("DbPort");
    const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Queue owner", email: ownerEmail, password: ownerPassword,
      businessName: "Queue route store",
    });
    expect(owner.status).toBe(201);
    businessId = owner.body.business.id as string;
    ownerCookie = cookies(owner.headers["set-cookie"]);
    ownerCsrf = owner.body.csrfToken as string;
    const invited = await request(app.getHttpServer()).post("/api/v1/memberships")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ name: "Queue cashier", email: "queue-route-cashier@example.com", role: "cashier" });
    expect(invited.status).toBe(201);
    const cashier = await request(app.getHttpServer()).post("/api/v1/auth/login")
      .send({ email: "queue-route-cashier@example.com", password: invited.body.tempPassword });
    expect(cashier.status).toBe(201);
    cashierCookie = cookies(cashier.headers["set-cookie"]);
    cashierCsrf = cashier.body.csrfToken as string;

    const branch = await db.createBranch({ businessId, name: "Assigned branch", type: "store", isActive: true });
    const remote = await db.createBranch({ businessId, name: "Other branch", type: "store", isActive: true });
    branchId = branch.id;
    remoteBranchId = remote.id;
    registerId = (await db.createRegister({ businessId, name: "Assigned till", branchId, isActive: true })).id;
    productId = (await db.createProduct({ businessId, categoryId: null, name: "Queue stock", sku: "QUEUE-ROUTE",
      barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null,
      reorderLevel: 1, trackInventory: true, isActive: true, imageUrl: null })).id;
    const settings = await db.getSettings(businessId);
    const membershipId = invited.body.membershipId as string;
    await db.saveSettings(businessId, { ...settings,
      memberBranchAssignments: { [membershipId]: [branchId] },
      memberRegisterAssignments: { [membershipId]: [registerId] },
    });
  });

  afterAll(async () => {
    await app?.close();
    if (priorKey === undefined) delete process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
    else process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = priorKey;
  });

  const queuePath = "/api/v1/approvals/requests";
  const movement = () => ({ kind: "inventory_movement", productId, movementType: "adjustment",
    qtyDelta: -1, reason: "Damaged unit" });
  const postQueue = (action: Record<string, unknown>, key: string, register?: string) =>
    request(app.getHttpServer()).post(queuePath).set("Cookie", cashierCookie)
      .set("X-CSRF-Token", cashierCsrf)
      .send({ action, idempotencyKey: key, ...(register ? { registerId: register } : {}) });

  it("creates, reads, approves and claims a registerless inventory movement once", async () => {
    const created = await postQueue(movement(), "http-movement-approval");
    expect(created.status).toBe(201);
    expect(created.body.request).toMatchObject({ branchId, registerId: null, kind: "inventory_movement" });
    const id = created.body.request.id as string;
    const detail = await request(app.getHttpServer()).get(`${queuePath}/${id}`).set("Cookie", cashierCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.request).toMatchObject({ id, branchId, registerId: null });
    expect(JSON.stringify(detail.body)).not.toContain("tokenCiphertext");

    const decision = await request(app.getHttpServer()).post(`${queuePath}/${id}/decision`)
      .set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf)
      .send({ decision: "APPROVED", email: ownerEmail, password: ownerPassword });
    expect(decision.status).toBe(201);
    const claim = await request(app.getHttpServer()).post(`${queuePath}/${id}/claim`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).send({});
    expect(claim.status).toBe(201);
    expect(claim.body.token).toMatch(/^mgr_/);
    const replay = await request(app.getHttpServer()).post(`${queuePath}/${id}/claim`)
      .set("Cookie", cashierCookie).set("X-CSRF-Token", cashierCsrf).send({});
    expect(replay.status).not.toBe(201);
  });

  it("permits a submitted local count and blocks remote or draft counts", async () => {
    const base = { businessId, scopeType: "PARTIAL" as const, name: "Count", notes: null, createdBy: "cashier",
      startedAt: new Date(), submittedBy: "cashier", submittedAt: new Date(), approvedBy: null,
      approvedAt: null, approvalFingerprint: null, postedBy: null, postedAt: null,
      cancelledBy: null, cancelledAt: null, version: 2 };
    const local = await db.createInventoryCount({ ...base, countNumber: "HTTP-LOCAL", branchId, status: "SUBMITTED" });
    const remote = await db.createInventoryCount({ ...base, countNumber: "HTTP-REMOTE", branchId: remoteBranchId, status: "SUBMITTED" });
    const draft = await db.createInventoryCount({ ...base, countNumber: "HTTP-DRAFT", branchId, status: "DRAFT" });
    const valid = await postQueue({ kind: "inventory_count", countId: local.id }, "http-count-valid");
    expect(valid.status).toBe(201);
    expect(valid.body.request).toMatchObject({ branchId, registerId: null });
    expect((await postQueue({ kind: "inventory_count", countId: remote.id }, "http-count-remote")).status).toBe(403);
    expect((await postQueue({ kind: "inventory_count", countId: draft.id }, "http-count-draft")).status).toBe(403);
  });

  it("rejects spoofed branches, register mismatches and global value actions", async () => {
    expect((await postQueue({ ...movement(), branchId: remoteBranchId }, "http-spoof-branch")).status).toBe(403);
    expect((await postQueue(movement(), "http-spoof-register", registerId)).status).toBe(403);
    expect((await postQueue({ kind: "value_adjustment", valueType: "store_credit", targetId: "customer",
      amountDelta: 100, reason: "Global correction" }, "http-global-value")).status).toBe(403);
  });
});
