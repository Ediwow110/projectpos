import { describe, expect, it } from "vitest";
import { renderReceiptText } from "./receipt-text";

describe("phase11 receipt text", () => {
  it("renders items, totals, and change", () => {
    const text = renderReceiptText({
      receiptNo: "2026-000001",
      status: "COMPLETED",
      items: [{ name: "Audit Coke", qty: 1, lineTotalMinor: 2500 }],
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0, totalMinor: 2500,
      paidMinor: 5000, changeMinor: 2500,
      tenders: [{ method: "cash", amountMinor: 5000 }],
    });
    expect(text).toContain("Receipt 2026-000001");
    expect(text).toContain("Audit Coke x 1 — 25.00");
    expect(text).toContain("SUBTOTAL 25.00");
    expect(text).toContain("TOTAL 25.00");
    expect(text).toContain("CHANGE 25.00");
    expect(text).toContain("cash 50.00");
  });
});
