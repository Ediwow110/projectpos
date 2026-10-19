import { describe, expect, it } from "vitest";
import {
  FIRST_SALE_CHECKS,
  readinessGapLabels,
  readSavedBusinessSettings,
  saleReadinessChecks,
} from "./sale-readiness";

const baseReadiness = {
  businessConfigured: true,
  legacySetupReviewSteps: [] as string[],
  hasSellableProduct: false,
  hasActiveRegister: false,
  hasOpenShift: false,
  hasStaff: false,
  canCustomizeReceipt: false,
  readyForFirstSale: false,
};

describe("sale readiness", () => {
  it("maps the server checks to the real product, register and shift routes", () => {
    const checks = saleReadinessChecks({
      ...baseReadiness,
      missing: ["sellable_product_or_stock", "active_register", "open_shift"],
    });
    expect(checks.map((check) => check.href)).toEqual(["/products", "/registers", "/shifts"]);
    expect(checks.every((check) => !check.done)).toBe(true);
    expect(checks[0].label).toBe("Sellable product with available stock");
    expect(checks[0].pending).toBe("No sellable product yet");
  });

  it("reports every check as satisfied when the server says the business is ready", () => {
    const checks = saleReadinessChecks({
      ...baseReadiness,
      hasSellableProduct: true,
      hasActiveRegister: true,
      hasOpenShift: true,
      readyForFirstSale: true,
      missing: [],
    });
    expect(checks.every((check) => check.done)).toBe(true);
    expect(checks.map((check) => check.href)).toEqual(["/products", "/registers", "/shifts"]);
  });

  it("never invents a branch prerequisite for a register", () => {
    expect(FIRST_SALE_CHECKS.map((check) => check.href)).not.toContain("/branches");
  });

  it("names server gaps that the visible checklist does not already cover", () => {
    expect(readinessGapLabels({ ...baseReadiness, missing: ["open_shift", "stock_at_open_register"] }))
      .toEqual(["No stock is available at the open register."]);
    expect(readinessGapLabels({ ...baseReadiness, missing: ["business_setup_review"] }))
      .toEqual(["Business setup needs to be reviewed and saved."]);
    expect(readinessGapLabels({ ...baseReadiness })).toEqual([]);
  });

  it("reads saved business settings from the server payload rather than form state", () => {
    const saved = readSavedBusinessSettings({
      name: "Tindahanko",
      currency: "PHP",
      settings: {
        businessAddress: "123 Rizal St",
        businessPhone: "09171234567",
        businessTimezone: "Asia/Manila",
        taxName: "no tax",
        taxRateBps: 0,
        standardReceiptConfirmed: true,
      },
    });
    expect(saved.name).toBe("Tindahanko");
    expect(saved.address).toBe("123 Rizal St");
    expect(saved.phone).toBe("09171234567");
    expect(saved.timezone).toBe("Asia/Manila");
    expect(saved.currency).toBe("PHP");
    expect(saved.taxName).toBe("no tax");
    expect(saved.taxRateBps).toBe(0);
    expect(saved.receiptConfirmed).toBe(true);
  });

  it("does not invent a tax rate or receipt confirmation the server has not stored", () => {
    const saved = readSavedBusinessSettings({ name: "B", currency: "PHP", settings: {} });
    expect(saved.taxRateBps).toBeNull();
    expect(saved.receiptConfirmed).toBe(false);
    expect(saved.address).toBe("");
  });
});
