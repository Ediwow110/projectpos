import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BusinessService } from "./business.service";

describe("phase11 settings gate and audit context", () => {
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
});
