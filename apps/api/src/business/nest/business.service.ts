import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  applyOnboardingPatch,
  configuredOnboardingState,
  isOnboardingComplete,
  isRequiredSetupConfigured,
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
    storefrontKey: string | null;
    settings: Record<string, unknown>;
  }> {
    const business = await this.db.findBusinessById(businessId);
    if (!business) throw new Error("TENANT_REQUIRED");
    const settings = await this.db.getSettings(businessId);
    return { id: business.id, name: business.name, storefrontKey: business.storefrontKey, settings };
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
    return configuredOnboardingState(settings);
  }

  async getSaleReadiness(businessId: string): Promise<{
    businessConfigured: boolean;
    hasSellableProduct: boolean;
    hasActiveRegister: boolean;
    hasOpenShift: boolean;
    hasStaff: boolean;
    canCustomizeReceipt: boolean;
    readyForFirstSale: boolean;
    missing: string[];
  }> {
    const [settings, products, registers, balances, memberships] = await Promise.all([
      this.db.getSettings(businessId),
      this.db.listProducts(businessId),
      this.db.listRegisters(businessId),
      this.db.listBalances(businessId),
      this.db.listMembershipsByBusiness(businessId),
    ]);
    const activeRegisters = registers.filter((register) => register.isActive);
    const businessConfigured = isOnboardingComplete(configuredOnboardingState(settings));
    const hasActiveRegister = activeRegisters.length > 0;
    const hasSellableProduct = products.some((product) =>
      product.isActive && product.priceMinor > 0 && (
        !product.trackInventory || balances.some((balance) =>
          balance.productId === product.id && balance.qtyOnHand > 0)
      ));
    const openRegisterIds = new Set((await Promise.all(
      activeRegisters.map((register) => this.db.findOpenShiftByRegister(businessId, register.id)),
    )).filter((shift) => shift !== null).map((shift) => shift.registerId));
    const hasOpenShift = openRegisterIds.size > 0;
    const hasStaff = memberships.some((member) => member.role !== "owner" && !member.deactivatedAt);
    const canCustomizeReceipt = await new BillingService(this.db).checkFeature(businessId, "receipt_customization");
    const hasStockAtAnOpenRegister = activeRegisters.some((register) =>
      openRegisterIds.has(register.id) && products.some((product) =>
        product.isActive && product.priceMinor > 0 && (
          !product.trackInventory || balances.some((balance) =>
            balance.productId === product.id && balance.qtyOnHand > 0 &&
            (balance.branchId ?? null) === (register.branchId ?? null))
        )));
    const missing: string[] = [];
    if (!businessConfigured) missing.push("business_setup");
    if (!hasSellableProduct) missing.push("sellable_product_or_stock");
    if (!hasActiveRegister) missing.push("active_register");
    if (!hasOpenShift) missing.push("open_shift");
    if (hasSellableProduct && hasOpenShift && !hasStockAtAnOpenRegister) missing.push("stock_at_open_register");
    return {
      businessConfigured,
      hasSellableProduct,
      hasActiveRegister,
      hasOpenShift,
      hasStaff,
      canCustomizeReceipt,
      readyForFirstSale: missing.length === 0,
      missing,
    };
  }

  async patchOnboarding(
    businessId: string,
    actorId: string,
    patch: { step: "businessDetails" | "taxCurrency" | "receiptSetup" | "products" | "employees"; state: "done" | "skipped" },
    requestId: string,
    granted: string[] = [],
  ): Promise<OnboardingState> {
    if (!granted.includes("settings.write")) throw new Error("FORBIDDEN");
    return this.db.withLock(`business-settings:${businessId}`, async () => {
    const settings = await this.db.getSettings(businessId);
    const current = configuredOnboardingState(settings);
    if (patch.state === "done" && !isRequiredSetupConfigured(patch.step, settings)) {
      throw new Error("ONBOARDING_CONFIGURATION_REQUIRED");
    }
    if (patch.state === "done" && patch.step === "products" &&
        !(await this.db.listProducts(businessId)).some((product) => product.isActive)) {
      throw new Error("ONBOARDING_CONFIGURATION_REQUIRED");
    }
    if (patch.state === "done" && patch.step === "employees" &&
        !(await this.db.listMembershipsByBusiness(businessId)).some(
          (member) => member.role !== "owner" && !member.deactivatedAt)) {
      throw new Error("ONBOARDING_CONFIGURATION_REQUIRED");
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
