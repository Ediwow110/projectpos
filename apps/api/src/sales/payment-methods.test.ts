import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { DEFAULT_PAYMENT_METHODS, resolvePaymentMethods } from "./payment-methods";

describe("phase11 configured payment methods", () => {
  it("falls back to the six defaults when settings are unset", async () => {
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
});
