import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  applyOnboardingPatch,
  defaultOnboardingState,
  mergeSettings,
  normalizeOnboardingState,
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
    currency: string;
    storefrontKey: string | null;
    settings: Record<string, unknown>;
  }> {
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("TENANT_REQUIRED");
    const settings = await this.db.getSettings(businessId);
    return { id: business.id, name: business.name, currency: business.currency, storefrontKey: business.storefrontKey, settings };
  }

  async ensureStorefrontKey(businessId: string): Promise<string> {
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("TENANT_REQUIRED");
    if (business.storefrontKey) return business.storefrontKey;
    const key = randomBytes(16).toString("hex");
    const updated = await this.db.setBusinessStorefrontKey(businessId, key);
    if (!updated) throw new Error("TENANT_REQUIRED");
    return updated.storefrontKey!;
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
    return this.db.withLock(`business-settings:${businessId}`, async () => {
    const current = await this.db.getSettings(businessId);
    // Receipt customization is a paid feature: the settings schema accepts
    // receipt, receipt.*, receiptHeader and receiptFooter, so the gate matches
    // the whole receipt* family rather than a single key spelling.
    if (Object.keys(patch).some((k) => k === "receipt" || k.startsWith("receipt"))) {
      await new BillingService(this.db).requireFeature(businessId, "receipt_customization");
    }
    if (patch["onlinePickupBranchIds"] !== undefined) {
      const ids = patch["onlinePickupBranchIds"];
      if (!Array.isArray(ids)) throw new Error("VALIDATION");
      for (const id of ids) {
        if (typeof id !== "string") throw new Error("VALIDATION");
        const branch = await this.db.findBranchById(id, businessId);
        if (!branch?.isActive) throw new Error("VALIDATION");
      }
    }
    if (patch["onlineFulfillmentBranchId"] !== undefined && patch["onlineFulfillmentBranchId"] !== null) {
      const id = patch["onlineFulfillmentBranchId"];
      if (typeof id !== "string") throw new Error("VALIDATION");
      const branch = await this.db.findBranchById(id, businessId);
      if (!branch?.isActive) throw new Error("VALIDATION");
    }
    if (patch["deliveryFlatFeeMinor"] !== undefined) {
      const fee = patch["deliveryFlatFeeMinor"];
      if (typeof fee !== "number" || !Number.isSafeInteger(fee) || fee < 0) throw new Error("VALIDATION");
    }
    if (patch["onlineOrderingEnabled"] === true) {
      await this.ensureStorefrontKey(businessId);
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
    });
  }

  async getOnboarding(businessId: string): Promise<OnboardingState> {
    const settings = await this.db.getSettings(businessId);
    const stored = settings["onboarding"];
    return stored === undefined ? defaultOnboardingState() : normalizeOnboardingState(stored);
  }

  async patchOnboarding(
    businessId: string,
    actorId: string,
    patch: { step: "businessDetails" | "taxCurrency" | "receiptSetup" | "products" | "employees"; state: "done" | "skipped"; receiptPreviewConfirmed?: boolean },
    requestId: string,
    granted: string[] = [],
  ): Promise<OnboardingState> {
    if (!granted.includes("settings.write")) throw new Error("FORBIDDEN");
    return this.db.withLock(`business-settings:${businessId}`, async () => {
    const settings = await this.db.getSettings(businessId);
    if (patch.step === "taxCurrency" && patch.state === "done") {
      const currency = settings["currency"];
      const taxName = settings["taxName"];
      const taxRateBps = settings["taxRateBps"];
      const business = await this.db.findBusinessById(businessId);
      if (!business || currency !== business.currency ||
        typeof currency !== "string" || currency.length !== 3 || currency !== currency.toUpperCase() ||
        typeof taxName !== "string" || taxName.trim().length === 0 || taxName.length > 80 ||
        typeof taxRateBps !== "number" || !Number.isInteger(taxRateBps) ||
        taxRateBps < 0 || taxRateBps > 10000) {
        throw new Error("ONBOARDING_SETTINGS_REQUIRED");
      }
    }
    const current = await this.getOnboarding(businessId);
    if (patch.step === "receiptSetup" && patch.state === "done" &&
        (patch.receiptPreviewConfirmed !== true ||
          current.steps.businessDetails !== "done" ||
          current.steps.taxCurrency !== "done")) {
      throw new Error("ONBOARDING_SETTINGS_REQUIRED");
    }
    const next = applyOnboardingPatch(current, patch);
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
    });
  }
}
