import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import type { RequestAuth } from "../../src/common/request-context";
import { ManagerApprovalQueueService } from "../../src/auth/nest/manager-approval-queue.service";
import { encryptApprovalToken } from "../../src/auth/approval-token-crypto";

describe("manager approval requests PostgreSQL persistence", () => {
  it("reads approval timestamps as UTC when the API process uses another timezone", async () => {
    await withPg(async (db) => {
      const previousTimezone = process.env["TZ"];
      process.env["TZ"] = "Asia/Shanghai";
      try {
        const business = await db.createBusiness({ name: "UTC approval timestamps", currency: "PHP" });
        const request = await db.createManagerApprovalRequest({
          businessId: business.id, requesterId: "timezone-cashier", branchId: null, registerId: null,
          kind: "inventory_movement", permission: "inventory.adjust",
          action: { kind: "inventory_movement", productId: "product", movementType: "receive", qtyDelta: 1 },
          fingerprint: "timezone-fingerprint", stateFingerprint: null, status: "PENDING",
          idempotencyKey: "timezone-request", approverId: null, decidedAt: null, decisionReason: null,
          tokenCiphertext: null, tokenExpiresAt: null, tokenClaimedAt: null,
        });
        expect(Math.abs(request.createdAt.getTime() - Date.now())).toBeLessThan(5_000);
        const expiresAt = new Date(Date.now() + 60_000);
        const approved = await db.transitionManagerApprovalRequest(request.id, business.id, "PENDING", {
          status: "APPROVED", approverId: "timezone-manager", decidedAt: new Date(),
          tokenCiphertext: "synthetic-encrypted-token", tokenExpiresAt: expiresAt,
        });
        expect(approved?.tokenExpiresAt?.toISOString()).toBe(expiresAt.toISOString());
        const claimed = await db.claimManagerApprovalRequestToken(request.id, business.id,
          "timezone-cashier", new Date());
        expect(claimed?.tokenExpiresAt.toISOString()).toBe(expiresAt.toISOString());
        expect(Math.abs((claimed?.request.tokenClaimedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(5_000);
      } finally {
        if (previousTimezone === undefined) delete process.env["TZ"];
        else process.env["TZ"] = previousTimezone;
      }
    });
  });

  it("enforces tenant scope, idempotency, compare-and-transition, and one-use grants", async () => {
    await withPg(async (db, ctx) => {
      const business = await db.createBusiness({ name: "Approval PG", currency: "PHP" });
      const other = await db.createBusiness({ name: "Other Approval PG", currency: "PHP" });
      const input = {
        businessId: business.id,
        requesterId: "cashier-pg",
        branchId: null,
        registerId: null,
        kind: "sale_void",
        permission: "sale.void",
        action: { kind: "sale_void", saleId: "sale-pg", reason: "Duplicate sale" },
        fingerprint: "fp-approval-pg",
        stateFingerprint: null,
        status: "PENDING" as const,
        idempotencyKey: "approval-pg-key",
        approverId: null,
        decidedAt: null,
        decisionReason: null,
        tokenCiphertext: null,
        tokenExpiresAt: null,
        tokenClaimedAt: null,
      };
      const request = await db.createManagerApprovalRequest(input);
      expect(await db.findManagerApprovalRequest(request.id, other.id)).toBeNull();
      expect(await db.findManagerApprovalRequestByIdempotency(business.id, input.requesterId, input.idempotencyKey))
        .toMatchObject({ id: request.id, action: input.action, status: "PENDING" });
      await expect(db.createManagerApprovalRequest(input)).rejects.toMatchObject({ code: "23505" });

      const expiresAt = new Date(Date.now() + 60_000);
      expect(await db.transitionManagerApprovalRequest(request.id, business.id, "PENDING", {
        status: "APPROVED", approverId: "manager-pg", decidedAt: new Date(),
        tokenCiphertext: "encrypted-one-use-token", tokenExpiresAt: expiresAt,
      })).toMatchObject({ status: "APPROVED", approverId: "manager-pg" });
      expect(await db.transitionManagerApprovalRequest(request.id, business.id, "PENDING", { status: "REJECTED" })).toBeNull();

      const claims = await Promise.all([
        db.claimManagerApprovalRequestToken(request.id, business.id, input.requesterId, new Date()),
        db.claimManagerApprovalRequestToken(request.id, business.id, input.requesterId, new Date()),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)).toMatchObject({ encryptedToken: "encrypted-one-use-token" });
      expect(await db.claimManagerApprovalRequestToken(request.id, business.id, input.requesterId, new Date())).toBeNull();
      expect(await db.findManagerApprovalRequest(request.id, business.id)).toMatchObject({ tokenCiphertext: null, tokenClaimedAt: expect.any(Date) });

      const client = await ctx.client();
      try {
        const rls = await client.query('SELECT "relrowsecurity" FROM pg_class WHERE "relname" = $1', ["ManagerApprovalRequest"]);
        expect(rls.rows[0]?.relrowsecurity).toBe(true);
      } finally { if (ctx.owns()) client.release(); }
    });
  });

  it("preserves a grant after failed validation and allows only one concurrent service claim", async () => {
    await withPg(async (db) => {
      const priorKey = process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
      const key = "e4".repeat(32);
      process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = key;
      try {
        const business = await db.createBusiness({ name: "PG claim recovery", currency: "PHP" });
        const foreign = await db.createBusiness({ name: "Foreign PG claim", currency: "PHP" });
        const approver = await db.createUser({ name: "PG approver", email: "pg-approver@example.com", passwordHash: "unused" });
        const membership = await db.createMembership({ businessId: business.id, userId: approver.id,
          role: "manager", deactivatedAt: null });
        const requesterId = "pg-claim-requester";
        const input = {
          businessId: business.id, requesterId, branchId: null, registerId: null,
          kind: "inventory_movement", permission: "inventory.adjust",
          action: { kind: "inventory_movement", productId: "product", movementType: "adjustment", qtyDelta: -1 },
          fingerprint: "pg-claim-fingerprint", stateFingerprint: null, status: "PENDING" as const,
          idempotencyKey: "pg-claim-recovery", approverId: null, decidedAt: null, decisionReason: null,
          tokenCiphertext: null, tokenExpiresAt: null, tokenClaimedAt: null,
        };
        const row = await db.createManagerApprovalRequest(input);
        const encrypted = encryptApprovalToken("synthetic-manager-grant", key);
        await db.transitionManagerApprovalRequest(row.id, business.id, "PENDING", {
          status: "APPROVED", approverId: approver.id, decidedAt: new Date(),
          tokenCiphertext: encrypted, tokenExpiresAt: new Date(Date.now() + 120_000),
        });
        const queue = new ManagerApprovalQueueService(db, null as never, null as never);
        const actor = { businessId: business.id, userId: requesterId, role: "cashier" } as RequestAuth;
        process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = "f5".repeat(32);
        await expect(queue.claim(actor, row.id)).rejects.toThrow("APPROVAL_TOKEN_UNAVAILABLE");
        expect(await db.findManagerApprovalRequest(row.id, business.id))
          .toMatchObject({ tokenCiphertext: encrypted, tokenClaimedAt: null });
        process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = key;

        await db.updateMembership(membership.id, business.id, { deactivatedAt: new Date() });
        await expect(queue.claim(actor, row.id)).rejects.toThrow("APPROVAL_TOKEN_UNAVAILABLE");
        expect(await db.findManagerApprovalRequest(row.id, business.id))
          .toMatchObject({ tokenCiphertext: encrypted, tokenClaimedAt: null });
        await db.updateMembership(membership.id, business.id, { deactivatedAt: null });
        await expect(queue.claim({ ...actor, userId: "different" }, row.id))
          .rejects.toThrow("APPROVAL_TOKEN_UNAVAILABLE");
        await expect(queue.claim({ ...actor, businessId: foreign.id }, row.id))
          .rejects.toThrow("APPROVAL_TOKEN_UNAVAILABLE");

        const results = await Promise.allSettled([queue.claim(actor, row.id), queue.claim(actor, row.id)]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(await db.findManagerApprovalRequest(row.id, business.id))
          .toMatchObject({ tokenCiphertext: null, tokenClaimedAt: expect.any(Date) });

        const expired = await db.createManagerApprovalRequest({ ...input, idempotencyKey: "pg-expired-claim" });
        await db.transitionManagerApprovalRequest(expired.id, business.id, "PENDING", {
          status: "APPROVED", approverId: approver.id, decidedAt: new Date(),
          tokenCiphertext: encrypted, tokenExpiresAt: new Date(Date.now() - 1_000),
        });
        await expect(queue.claim(actor, expired.id)).rejects.toThrow("APPROVAL_TOKEN_UNAVAILABLE");
        expect(await db.findManagerApprovalRequest(expired.id, business.id))
          .toMatchObject({ tokenCiphertext: encrypted, tokenClaimedAt: null });
      } finally {
        if (priorKey === undefined) delete process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
        else process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = priorKey;
      }
    });
  });
});
