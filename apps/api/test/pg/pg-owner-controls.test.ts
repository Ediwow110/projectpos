import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { withPg } from "./helpers";
import { MembershipService } from "../../src/memberships/nest/membership.service";
import { SessionGuard } from "../../src/common/session.guard";
import { hashToken } from "../../src/auth/sessions";
import { assignedBranches, assignedRegisters } from "../../src/auth/member-permissions";

describe("Phase A PostgreSQL-backed owner access controls", () => {
  it("persists tenant-scoped branch/register grants and enforces them on subsequent sessions", async () => {
    await withPg(async (db) => {
      const business = await db.createBusiness({ name: "Phase A Local Test", currency: "PHP" });
      const foreignBusiness = await db.createBusiness({ name: "Foreign Tenant", currency: "PHP" });
      const owner = await db.createUser({ name: "Owner", email: "pg-a-owner@test.invalid", passwordHash: "unused" });
      const worker = await db.createUser({ name: "Worker", email: "pg-a-worker@test.invalid", passwordHash: "unused" });
      await db.createMembership({ businessId: business.id, userId: owner.id, role: "owner" });
      const seat = await db.createMembership({ businessId: business.id, userId: worker.id, role: "cashier" });
      const localBranch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
      const foreignBranch = await db.createBranch({
        businessId: foreignBusiness.id, name: "Other business", type: "store", isActive: true,
      });
      const otherBranch = await db.createBranch({ businessId: business.id, name: "Other", type: "store", isActive: true });
      const local = await db.createRegister({
        businessId: business.id, branchId: localBranch.id, name: "Allowed register", isActive: true,
      });
      const sameBranchOther = await db.createRegister({
        businessId: business.id, branchId: localBranch.id, name: "Excluded register", isActive: true,
      });
      const manager = new MembershipService(db);
      await expect(manager.setBranchAssignment(business.id, owner.id, "foreign", ["user.manage"], seat.id, [foreignBranch.id]))
        .rejects.toThrow("VALIDATION");
      await manager.setBranchAssignment(business.id, owner.id, "set-branch", ["user.manage"], seat.id, [localBranch.id]);
      await manager.setRegisterAssignment(business.id, owner.id, "set-reg", ["user.manage"], seat.id, [local.id]);
      const settings = await db.getSettings(business.id);
      expect(assignedBranches(settings, seat.id)).toEqual([localBranch.id]);
      expect(assignedRegisters(settings, seat.id)).toEqual([local.id]);
      await db.saveSettings(business.id, {
        ...settings,
        onboarding: {
          currentStep: "complete",
          steps: {
            businessDetails: "done", taxCurrency: "done", receiptSetup: "done",
            products: "skipped", employees: "skipped",
          },
        },
      });
      expect(await db.getSettings(foreignBusiness.id)).not.toHaveProperty("memberRegisterAssignments");
      await expect(manager.setBranchAssignment(business.id, owner.id, "bad-switch", ["user.manage"], seat.id, [otherBranch.id]))
        .rejects.toThrow("VALIDATION");

      const token = "pg-owner-controls-test-token";
      await db.createSession({
        userId: worker.id, businessId: business.id,
        tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null, authenticatedAt: new Date(),
        ip: null, userAgent: null,
      });
      const guard = new SessionGuard(db);
      async function permits(method: string, path: string, body?: Record<string, unknown>): Promise<boolean> {
        const req: Record<string, unknown> = {
          cookies: { pos_session: token }, method, path, body: body ?? {}, query: {},
        };
        const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
        const ok = await guard.canActivate(context);
        if (ok) {
          expect((req.auth as { activeBranchId: string }).activeBranchId).toBe(localBranch.id);
        }
        return ok;
      }
      expect(await permits("GET", "/api/v1/registers")).toBe(true);
      expect(await permits("GET", "/api/v1/reports/sales")).toBe(false);
      expect(await permits("POST", "/api/v1/sales/drafts", { registerId: local.id, lines: [] })).toBe(true);
      expect(await permits("POST", "/api/v1/sales/drafts", { registerId: sameBranchOther.id, lines: [] })).toBe(false);
      expect(await permits("POST", "/api/v1/sync/check", { keys: ["unknown"] })).toBe(false);

      await manager.setBranchAssignment(business.id, owner.id, "unrestrict", ["user.manage"], seat.id, null);
      const unrestricted = await db.getSettings(business.id);
      expect(assignedBranches(unrestricted, seat.id)).toBeUndefined();
      expect(assignedRegisters(unrestricted, seat.id)).toBeUndefined();
      expect(await permits("GET", "/api/v1/reports/sales")).toBe(true);
      expect((await db.listAudit(business.id)).some((event) => event.action === "member.registers.changed"))
        .toBe(true);
    });
  });
});
