import { Inject, Injectable } from "@nestjs/common";
import {
  applyOnboardingPatch,
  defaultOnboardingState,
  mergeSettings,
  type OnboardingState,
} from "../onboarding";
import type { DbPort } from "../../common/db.port";
import { BillingService } from "../../billing/nest/billing.service";

@Injectable()
export class BusinessService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async getBusiness(businessId: string): Promise<{
    id: string;
    name: string;
    settings: Record<string, unknown>;
  }> {
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("TENANT_REQUIRED");
    const settings = await this.db.getSettings(businessId);
    return { id: business.id, name: business.name, settings };
  }

  async patchSettings(
    businessId: string,
    actorId: string,
    patch: Record<string, unknown>,
    requestId: string,
    granted: string[] = [],
  ): Promise<Record<string, unknown>> {
    // PLAN FR-RBAC-02: settings changes are a permission-sensitive action; the
    // role seed withholds settings.write from manager/cashier.
    if (!granted.includes("settings.write")) throw new Error("FORBIDDEN");
    const current = await this.db.getSettings(businessId);
    // Receipt customization is a paid feature: the settings schema accepts
    // receipt, receipt.*, receiptHeader and receiptFooter, so the gate matches
    // the whole receipt* family rather than a single key spelling.
    if (Object.keys(patch).some((k) => k === "receipt" || k.startsWith("receipt"))) {
      await new BillingService(this.db).requireFeature(businessId, "receipt_customization");
    }
    const next = mergeSettings(current, patch);
    await this.db.saveSettings(businessId, next);
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "settings.write",
      entityType: "Business",
      entityId: businessId,
      requestId,
      before: current,
      after: next,
    });
    return next;
  }

  async getOnboarding(businessId: string): Promise<OnboardingState> {
    const settings = await this.db.getSettings(businessId);
    const stored = settings["onboarding"] as OnboardingState | undefined;
    return stored ?? defaultOnboardingState();
  }

  async patchOnboarding(
    businessId: string,
    actorId: string,
    patch: { step: "businessDetails" | "taxCurrency" | "receiptSetup" | "products" | "employees"; state: "done" | "skipped" },
    requestId: string,
    granted: string[] = [],
  ): Promise<OnboardingState> {
    if (!granted.includes("settings.write")) throw new Error("FORBIDDEN");
    const current = await this.getOnboarding(businessId);
    const next = applyOnboardingPatch(current, patch);
    const settings = await this.db.getSettings(businessId);
    await this.db.saveSettings(businessId, { ...settings, onboarding: next });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "onboarding.update",
      entityType: "Business",
      entityId: businessId,
      requestId,
    });
    return next;
  }
}
