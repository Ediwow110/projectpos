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
      currentStep: "taxCurrency",
      steps: {
        businessDetails: "done",
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

    await db.saveSettings(biz.id, { currency: "PHP", taxName: "No tax", taxRateBps: 0 });

    await expect(
      svc.patchOnboarding(
        biz.id,
        "u-owner",
        { step: "taxCurrency", state: "done" },
        "r4",
        ["settings.write"],
      ),
    ).resolves.toMatchObject({ currentStep: "receiptSetup" });
  });

  it("does not complete tax and currency onboarding until real settings are saved", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Tax setup", currency: "PHP" });
    const svc = new BusinessService(db);
    await db.saveSettings(biz.id, { currency: "PHP" });

    await expect(svc.patchOnboarding(
      biz.id, "owner", { step: "taxCurrency", state: "done" }, "no-tax-config", ["settings.write"],
    )).rejects.toThrow("ONBOARDING_SETTINGS_REQUIRED");
    expect((await svc.getOnboarding(biz.id)).steps.taxCurrency).toBe("pending");

    await db.saveSettings(biz.id, { currency: "USD", taxName: "No tax", taxRateBps: 0 });
    await expect(svc.patchOnboarding(
      biz.id, "owner", { step: "taxCurrency", state: "done" }, "mismatched-currency", ["settings.write"],
    )).rejects.toThrow("ONBOARDING_SETTINGS_REQUIRED");
    await db.saveSettings(biz.id, { currency: "PHP", taxName: "No tax", taxRateBps: 0 });
    await expect(svc.patchOnboarding(
      biz.id, "owner", { step: "taxCurrency", state: "done" }, "with-tax-config", ["settings.write"],
    )).resolves.toMatchObject({ currentStep: "receiptSetup" });
  });

  it("requires a reviewed receipt configuration and completed tax setup before receipt signoff", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "Receipt Store", currency: "PHP" });
    const svc = new BusinessService(db);
    const confirmed = { step: "receiptSetup" as const, state: "done" as const, receiptPreviewConfirmed: true };

    await expect(svc.patchOnboarding(
      biz.id, "owner", confirmed, "premature", ["settings.write"],
    )).rejects.toThrow("ONBOARDING_SETTINGS_REQUIRED");
    await db.saveSettings(biz.id, { currency: "PHP", taxName: "No tax", taxRateBps: 0 });
    await svc.patchOnboarding(biz.id, "owner", { step: "taxCurrency", state: "done" }, "tax", ["settings.write"]);

    await expect(svc.patchOnboarding(
      biz.id, "owner", { step: "receiptSetup", state: "done" }, "unreviewed", ["settings.write"],
    )).rejects.toThrow("ONBOARDING_SETTINGS_REQUIRED");
    expect((await svc.getOnboarding(biz.id)).steps.receiptSetup).toBe("pending");

    await expect(svc.patchOnboarding(
      biz.id, "owner", confirmed, "reviewed", ["settings.write"],
    )).resolves.toMatchObject({ steps: { receiptSetup: "done" } });
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
