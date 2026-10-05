import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { DEFAULT_PAYMENT_METHODS, resolvePaymentMethods } from "./payment-methods";

describe("phase11 configured payment methods", () => {
  it("falls back to the defaults when settings are unset", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    expect(await resolvePaymentMethods(db, biz.id)).toEqual(DEFAULT_PAYMENT_METHODS);
  });

  it("returns the configured list when set", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    await db.saveSettings(biz.id, {
      ...(await db.getSettings(biz.id)),
      paymentMethods: [{ key: "cash", label: "Cash" }, { key: "shopee_pay", label: "ShopeePay" }],
    });
    const out = await resolvePaymentMethods(db, biz.id);
    expect(out.map((m) => m.key)).toEqual(["cash", "shopee_pay"]);
  });

  it("falls back to defaults for an empty configured list", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    await db.saveSettings(biz.id, { ...(await db.getSettings(biz.id)), paymentMethods: [] });
    expect(await resolvePaymentMethods(db, biz.id)).toEqual(DEFAULT_PAYMENT_METHODS);
  });

  it("upgrades the legacy default list to include QR Ph without changing custom lists", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    await db.saveSettings(biz.id, {
      ...(await db.getSettings(biz.id)),
      paymentMethods: [
        { key: "cash", label: "Cash" },
        { key: "card", label: "Card" },
        { key: "gcash", label: "GCash" },
        { key: "maya", label: "Maya" },
        { key: "bank_transfer", label: "Bank transfer" },
        { key: "other", label: "Other" },
      ],
    });
    expect((await resolvePaymentMethods(db, biz.id)).map((method) => method.key)).toContain("qrph");
  });

  it("upgrades the pre-Phase-20 QR-enabled default list to internal tenders", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    await db.saveSettings(biz.id, {
      ...(await db.getSettings(biz.id)),
      paymentMethods: [
        { key: "cash", label: "Cash" },
        { key: "card", label: "Card" },
        { key: "gcash", label: "GCash" },
        { key: "maya", label: "Maya" },
        { key: "qrph", label: "QR Ph" },
        { key: "bank_transfer", label: "Bank transfer" },
        { key: "other", label: "Other" },
      ],
    });
    expect(await resolvePaymentMethods(db, biz.id)).toEqual(DEFAULT_PAYMENT_METHODS);
  });

  it("keeps the current default and intentionally customized lists unchanged", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    await db.saveSettings(biz.id, {
      ...(await db.getSettings(biz.id)),
      paymentMethods: DEFAULT_PAYMENT_METHODS,
    });
    expect(await resolvePaymentMethods(db, biz.id)).toEqual(DEFAULT_PAYMENT_METHODS);

    const custom = [{ key: "cash", label: "Cash" }];
    await db.saveSettings(biz.id, { ...(await db.getSettings(biz.id)), paymentMethods: custom });
    expect(await resolvePaymentMethods(db, biz.id)).toEqual(custom);
  });
});
