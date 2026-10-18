import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BusinessService } from "./business.service";

describe("phase11 settings gate and audit context", () => {
  it("persists the refund threshold used by existing owner-approval policy", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Financial Rules", currency: "PHP" });
    const service = new BusinessService(db);
    await service.patchSettings(biz.id, "owner", { refundApprovalThresholdMinor: 250000 }, "financial-rule", ["settings.write"]);
    expect((await db.getSettings(biz.id))["refundApprovalThresholdMinor"]).toBe(250000);
    const events = await db.listAudit();
    expect(events.some((entry) => entry.action === "settings.write" && entry.requestId === "financial-rule")).toBe(true);
    await expect(service.patchSettings(biz.id, "cashier", { refundApprovalThresholdMinor: 0 }, "blocked", []))
      .rejects.toThrow("FORBIDDEN");
  });
  it("denies settings writes without settings.write and allows the owner", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    const svc = new BusinessService(db);
    await expect(
      svc.patchSettings(biz.id, "u-mgr", { receiptFooter: "x" }, "r1", ["sale.refund"]),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      svc.patchSettings(biz.id, "u-owner", { receiptFooter: "x" }, "r2", ["settings.write"]),
    ).resolves.toBeTruthy();
  });

  it("rejects a currency setting that differs from the registered business currency", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Currency Integrity", currency: "PHP" });
    const service = new BusinessService(db);

    await expect(service.patchSettings(
      biz.id, "owner", { currency: "USD", taxName: "No tax", taxRateBps: 0 },
      "mismatched-currency", ["settings.write"],
    )).rejects.toThrow("VALIDATION");
    expect((await db.getSettings(biz.id))["currency"]).toBeUndefined();

    await expect(service.patchSettings(
      biz.id, "owner", { currency: "PHP", taxName: "No tax", taxRateBps: 0 },
      "correct-currency", ["settings.write"],
    )).resolves.toMatchObject({ currency: "PHP" });
  });

  it("audits the settings patch with before and after snapshots", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    const svc = new BusinessService(db);
    await svc.patchSettings(biz.id, "u-owner", { receiptFooter: "x" }, "r2", ["settings.write"]);
    const row = (await db.listAudit()).at(-1)!;
    expect(row.action).toBe("settings.write");
    expect(row.before).toEqual({});
    expect(row.after).toEqual(expect.objectContaining({ receiptFooter: "x" }));
    expect(row.at).toBeInstanceOf(Date);
  });

  it("recovers safely when persisted onboarding settings have a malformed shape", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    await db.saveSettings(biz.id, { onboarding: { currentStep: "complete" } });

    const svc = new BusinessService(db);
    await expect(svc.getOnboarding(biz.id)).resolves.toEqual({
      currentStep: "businessDetails",
      steps: {
        businessDetails: "pending",
        taxCurrency: "pending",
        receiptSetup: "pending",
        products: "pending",
        employees: "pending",
      },
    });
  });

  it("protects onboarding mutations with the same settings.write permission as business setup", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    const svc = new BusinessService(db);

    await expect(
      svc.patchOnboarding(
        biz.id,
        "u-cashier",
        { step: "taxCurrency", state: "done" },
        "r3",
        [],
      ),
    ).rejects.toThrow("FORBIDDEN");

    await db.saveSettings(biz.id, {
      businessAddress: "123 Test Street, Manila",
      businessTimezone: "Asia/Manila",
      currency: "PHP",
      taxName: "No tax",
      taxRateBps: 0,
      onboardingSchemaVersion: 2,
    });
    await expect(
      svc.patchOnboarding(
        biz.id,
        "u-owner",
        { step: "taxCurrency", state: "done" },
        "r4",
        ["settings.write"],
      ),
    ).resolves.toMatchObject({ steps: { taxCurrency: "done", receiptSetup: "pending" } });
  });

  it("reports real missing products, registers and shifts for an empty business", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Empty Shop", currency: "PHP" });
    const svc = new BusinessService(db);
    await expect(svc.getSaleReadiness(biz.id)).resolves.toMatchObject({
      businessConfigured: false,
      hasSellableProduct: false,
      hasActiveRegister: false,
      hasOpenShift: false,
      readyForFirstSale: false,
      missing: ["business_setup", "sellable_product_or_stock", "active_register", "open_shift"],
    });
  });

  it.each([undefined, false, "true"])(
    "does not infer receipt confirmation from a custom header when acknowledgement is %s",
    async (acknowledgement) => {
      const db = createMemoryDb();
      const biz = await db.createBusiness({ name: "Unconfirmed Receipt", currency: "PHP" });
      const svc = new BusinessService(db);
      const settings = {
        onboardingSchemaVersion: 2,
        businessAddress: "123 Test Street, Manila",
        businessTimezone: "Asia/Manila",
        currency: "PHP",
        taxName: "No tax",
        taxRateBps: 0,
        receiptHeader: "Custom merchant header",
        standardReceiptConfirmed: acknowledgement,
        onboarding: {
          steps: {
            businessDetails: "done", taxCurrency: "done", receiptSetup: "pending",
            products: "skipped", employees: "skipped",
          },
        },
      };
      await db.saveSettings(biz.id, settings);

      await expect(svc.patchOnboarding(
        biz.id, "owner", { step: "receiptSetup", state: "done" },
        "unconfirmed-receipt", ["settings.write"],
      )).rejects.toThrow("ONBOARDING_CONFIGURATION_REQUIRED");
      expect(await db.getSettings(biz.id)).toEqual(settings);
      expect((await db.listAudit()).filter((entry) => entry.action === "onboarding.update"))
        .toHaveLength(0);

      await svc.patchSettings(
        biz.id, "owner", { standardReceiptConfirmed: true },
        "explicit-receipt-confirmation", ["settings.write"],
      );
      await expect(svc.patchOnboarding(
        biz.id, "owner", { step: "receiptSetup", state: "done" },
        "confirmed-receipt", ["settings.write"],
      )).resolves.toMatchObject({ currentStep: "complete", steps: { receiptSetup: "done" } });
      expect((await db.getSettings(biz.id))["taxRateBps"]).toBe(0);
    },
  );

  it("reopens an unconfirmed V2 receipt step even when a custom header and done flag were saved", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Reconciled Receipt", currency: "PHP" });
    await db.saveSettings(biz.id, {
      onboardingSchemaVersion: 2,
      businessAddress: "123 Test Street, Manila",
      businessTimezone: "Asia/Manila",
      currency: "PHP",
      taxName: "No tax",
      taxRateBps: 0,
      receiptHeader: "Custom merchant header",
      onboarding: {
        steps: {
          businessDetails: "done", taxCurrency: "done", receiptSetup: "done",
          products: "skipped", employees: "skipped",
        },
      },
    });
    const svc = new BusinessService(db);

    await expect(svc.getOnboarding(biz.id)).resolves.toMatchObject({
      currentStep: "receiptSetup", steps: { receiptSetup: "pending" },
    });
    await expect(svc.getSaleReadiness(biz.id)).resolves.toMatchObject({
      businessConfigured: false, readyForFirstSale: false,
    });
  });

  it("allows a Free-plan owner to confirm a standard receipt without granting paid customization", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Free Shop", currency: "PHP" });
    const free = await db.findPlanByKey("free");
    expect(free).toBeTruthy();
    await db.upsertSubscription({
      businessId: biz.id, planId: free!.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    const svc = new BusinessService(db);
    const settings = await svc.patchSettings(
      biz.id, "owner", { standardReceiptConfirmed: true }, "standard-free", ["settings.write"],
    );
    expect(settings["standardReceiptConfirmed"]).toBe(true);
    const next = await svc.patchOnboarding(
      biz.id, "owner", { step: "receiptSetup", state: "done" }, "receipt-free", ["settings.write"],
    );
    expect(next.steps.receiptSetup).toBe("done");
    const readiness = await svc.getSaleReadiness(biz.id);
    expect(readiness.canCustomizeReceipt).toBe(false);
    await expect(svc.patchSettings(
      biz.id, "owner", { receiptHeader: "Premium Only" }, "custom-denied", ["settings.write"],
    )).rejects.toThrow("PLAN_LIMIT");
  });

  it.each(["businessDetails", "taxCurrency", "receiptSetup"] as const)(
    "rejects direct attempts to skip required onboarding step %s",
    async (step) => {
      const db = createMemoryDb();
      const biz = await db.createBusiness({ name: "S", currency: "PHP" });
      const svc = new BusinessService(db);
      const before = await svc.getOnboarding(biz.id);

      await expect(svc.patchOnboarding(
        biz.id,
        "u-owner",
        { step, state: "skipped" },
        `skip-${step}`,
        ["settings.write"],
      )).rejects.toThrow("ONBOARDING_REQUIRED_STEP");

      await expect(svc.getOnboarding(biz.id)).resolves.toEqual(before);
    },
  );

  it("validates online-order branches in-tenant and active", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    const other = await db.createBusiness({ name: "Other", currency: "PHP" });
    const active = await db.createBranch({ businessId: biz.id, name: "Main", type: "store", isActive: true });
    const inactive = await db.createBranch({ businessId: biz.id, name: "Old", type: "store", isActive: false });
    const foreign = await db.createBranch({ businessId: other.id, name: "Foreign", type: "store", isActive: true });
    const svc = new BusinessService(db);

    await expect(svc.patchSettings(
      biz.id,
      "owner",
      { onlinePickupBranchIds: [active.id], onlineFulfillmentBranchId: active.id },
      "r-online-ok",
      ["settings.write"],
    )).resolves.toMatchObject({
      onlinePickupBranchIds: [active.id],
      onlineFulfillmentBranchId: active.id,
    });

    for (const badBranchId of [inactive.id, foreign.id, "missing"]) {
      await expect(svc.patchSettings(
        biz.id,
        "owner",
        { onlinePickupBranchIds: [badBranchId] },
        "r-online-bad",
        ["settings.write"],
      )).rejects.toThrow("VALIDATION");
      await expect(svc.patchSettings(
        biz.id,
        "owner",
        { onlineFulfillmentBranchId: badBranchId },
        "r-online-bad-delivery",
        ["settings.write"],
      )).rejects.toThrow("VALIDATION");
    }
  });

  it("mints a stable public storefront key when online ordering is first enabled", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "S", currency: "PHP" });
    const branch = await db.createBranch({ businessId: biz.id, name: "Main", type: "store", isActive: true });
    const svc = new BusinessService(db);

    await svc.patchSettings(
      biz.id,
      "owner",
      { onlineOrderingEnabled: true, onlinePickupBranchIds: [branch.id] },
      "r-enable-1",
      ["settings.write"],
    );
    const first = await db.findBusinessById(biz.id);
    expect(first?.storefrontKey).toMatch(/^[a-f0-9]{32}$/);

    await svc.patchSettings(
      biz.id,
      "owner",
      { onlineOrderingEnabled: false },
      "r-disable",
      ["settings.write"],
    );
    await svc.patchSettings(
      biz.id,
      "owner",
      { onlineOrderingEnabled: true },
      "r-enable-2",
      ["settings.write"],
    );
    expect((await db.findBusinessById(biz.id))?.storefrontKey).toBe(first?.storefrontKey);
    await expect(svc.getBusiness(biz.id)).resolves.toMatchObject({ storefrontKey: first?.storefrontKey });
  });
});
