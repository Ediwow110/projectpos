import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";

describe("manager approval requests PostgreSQL persistence", () => {
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
});
