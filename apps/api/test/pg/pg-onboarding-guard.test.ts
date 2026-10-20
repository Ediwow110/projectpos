import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { defaultOnboardingState } from "../../src/business/onboarding";
import { SessionGuard } from "../../src/common/session.guard";
import { withPg } from "./helpers";

describe("PostgreSQL onboarding guard", () => {
  it("blocks protected API token routes until persisted required steps are done", async () => {
    await withPg(async (db) => {
      const business = await db.createBusiness({ name: "Onboarding guard test", currency: "PHP" });
      const state = defaultOnboardingState();
      await db.saveSettings(business.id, { onboarding: state });

      const req = {
        auth: { businessId: business.id, via: "api-token" },
        authError: undefined as string | undefined,
        method: "GET",
        path: "/api/v1/inventory/balances",
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
      const guard = new SessionGuard(db);

      expect(await guard.canActivate(context)).toBe(false);
      expect(req.authError).toBe("ONBOARDING_REQUIRED");

      state.steps.taxCurrency = "done";
      state.steps.receiptSetup = "done";
      await db.saveSettings(business.id, { onboarding: state, onboardingSchemaVersion: 2 });
      req.authError = undefined;
      // Tax and receipt flags cannot bypass a still-pending business profile.
      expect(await guard.canActivate(context)).toBe(false);
      expect(req.authError).toBe("ONBOARDING_REQUIRED");

      state.steps.businessDetails = "done";
      await db.saveSettings(business.id, { onboarding: state, onboardingSchemaVersion: 2 });
      req.authError = undefined;
      // Completed flags alone are insufficient without persisted settings.
      expect(await guard.canActivate(context)).toBe(false);
      expect(req.authError).toBe("ONBOARDING_REQUIRED");

      await db.saveSettings(business.id, {
        onboarding: state,
        onboardingSchemaVersion: 2,
        businessAddress: "123 Test Street, Manila",
        businessTimezone: "Asia/Manila",
        currency: business.currency,
        taxName: "No tax",
        taxRateBps: 0,
        standardReceiptConfirmed: true,
      });
      req.authError = undefined;
      expect(await guard.canActivate(context)).toBe(true);
      expect(req.authError).toBeUndefined();
    });
  });
});
