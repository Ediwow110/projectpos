import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../../src/common/request-context";
import { ManagerApprovalQueueService } from "../../src/auth/nest/manager-approval-queue.service";
import { ManagerApprovalPolicyService } from "../../src/auth/nest/manager-approval-policy.service";
import { StoredValueService } from "../../src/value/stored-value.service";
import { withPg } from "./helpers";

describe("PostgreSQL first-account approval safety", () => {
  it("keeps rejected requests side-effect free and creates one account on an approved adjustment", async () => {
    await withPg(async (db) => {
      const oldKey = process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
      process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = "a3".repeat(32);
      try {
        const business = await db.createBusiness({ name: "PG value safety", currency: "PHP" });
        const cashier = await db.createUser({ name: "Value cashier", email: "pg-value-cashier@example.com", passwordHash: "unused" });
        const manager = await db.createUser({ name: "Value manager", email: "pg-value-manager@example.com", passwordHash: "unused" });
        await db.createMembership({ businessId: business.id, userId: cashier.id, role: "cashier", deactivatedAt: null });
        await db.createMembership({ businessId: business.id, userId: manager.id, role: "manager", deactivatedAt: null });
        const customer = await db.createCustomer({ businessId: business.id, name: "PG value customer",
          phone: null, email: null, address: null, notes: null, isActive: true });
        const auth = {
          permissionsForRequest: (actor: RequestAuth) => actor.role === "manager"
            ? ["stored_value.adjust", "loyalty.adjust"] : [],
          mintManagerApproval: async () => ({ token: "synthetic-pg-grant", expiresAt: new Date(Date.now() + 60_000) }),
        };
        const queue = new ManagerApprovalQueueService(db, auth as never, new ManagerApprovalPolicyService(db));
        const cashierActor = { userId: cashier.id, businessId: business.id, role: "cashier",
          activeBranchId: null, allowedBranchIds: null, allowedRegisterIds: null } as RequestAuth;
        const managerActor = { userId: manager.id, businessId: business.id, role: "manager",
          activeBranchId: null, allowedBranchIds: null, allowedRegisterIds: null } as RequestAuth;
        const action = { kind: "value_adjustment" as const, valueType: "store_credit" as const,
          targetId: customer.id, amountDelta: 500, reason: "Documented correction" };
        await expect(queue.request(managerActor, "wrong-role", action, null, "pg-value-wrong-role"))
          .rejects.toThrow("FORBIDDEN");
        await expect(queue.request({ ...cashierActor, allowedBranchIds: ["branch"] }, "wrong-branch",
          action, null, "pg-value-wrong-branch")).rejects.toThrow("FORBIDDEN");
        await expect(queue.request(cashierActor, "missing", { ...action, targetId: "missing" },
          null, "pg-value-missing")).rejects.toThrow("NOT_FOUND");
        const requested = await queue.request(cashierActor, "request", action, null, "pg-value-request");
        expect((await queue.request(cashierActor, "replay", action, null, "pg-value-request")).replayed).toBe(true);
        await expect(queue.request(cashierActor, "mismatch", { ...action, amountDelta: 700 },
          null, "pg-value-request")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
        expect(await db.findStoreCreditAccount(customer.id, business.id)).toBeNull();
        await queue.decide(managerActor, "reject", requested.request.id,
          { decision: "REJECTED", reason: "No evidence" });
        expect(await db.findStoreCreditAccount(customer.id, business.id)).toBeNull();

        const approved = await queue.request(cashierActor, "approve", action, null, "pg-value-approved");
        await queue.decide(managerActor, "decision", approved.request.id,
          { decision: "APPROVED", email: manager.email, password: "synthetic" });
        await expect(queue.claim(cashierActor, approved.request.id)).resolves.toMatchObject({ token: "synthetic-pg-grant" });
        expect(await db.findStoreCreditAccount(customer.id, business.id)).toBeNull();
        const values = new StoredValueService(db);
        await expect(values.adjustStoreCredit(business.id, cashier.id, "negative", customer.id,
          -100, "Invalid debit", "pg-value-negative")).rejects.toThrow("STORE_CREDIT_INSUFFICIENT_BALANCE");
        expect(await db.findStoreCreditAccount(customer.id, business.id)).toBeNull();
        await values.adjustStoreCredit(business.id, cashier.id, "adjust", customer.id,
          500, "Documented correction", "pg-value-adjust");
        await values.adjustStoreCredit(business.id, cashier.id, "replay", customer.id,
          500, "Documented correction", "pg-value-adjust");
        await expect(values.adjustStoreCredit(business.id, cashier.id, "mismatch", customer.id,
          700, "Documented correction", "pg-value-adjust")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
        const account = await db.findStoreCreditAccount(customer.id, business.id);
        expect(account).not.toBeNull();
        expect(await db.listStoreCreditTransactions(account!.id, business.id)).toHaveLength(1);

        const loyaltyRequest = await queue.request(cashierActor, "loyalty", { ...action,
          valueType: "loyalty", amountDelta: 25 }, null, "pg-value-loyalty");
        expect(loyaltyRequest.replayed).toBe(false);
        expect(await db.findLoyaltyAccount(customer.id, business.id)).toBeNull();
        await values.adjustLoyalty(business.id, cashier.id, "loyalty-adjust", customer.id,
          25, "Documented correction", "pg-loyalty-adjust");
        await values.adjustLoyalty(business.id, cashier.id, "loyalty-replay", customer.id,
          25, "Documented correction", "pg-loyalty-adjust");
        const loyalty = await db.findLoyaltyAccount(customer.id, business.id);
        expect(await db.listLoyaltyTransactions(loyalty!.id, business.id)).toHaveLength(1);
      } finally {
        if (oldKey === undefined) delete process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"];
        else process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] = oldKey;
      }
    });
  });
});
