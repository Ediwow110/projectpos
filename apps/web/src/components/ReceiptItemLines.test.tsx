import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptItemLines } from "./ReceiptItemLines";

describe("receipt itemized line presentation", () => {
  it("shows product, quantity, unit price, authoritative line total, and piece count", () => {
    const html = renderToStaticMarkup(
      <ReceiptItemLines items={[
        { name: "Oat milk", qty: 10, priceMinor: 13500, lineTotalMinor: 135000 },
        { name: "Coffee", qty: 1, priceMinor: 18000, lineTotalMinor: 17500 },
      ]} />,
    );
    expect(html).toContain("PRODUCT");
    expect(html).toContain("QTY");
    expect(html).toContain("UNIT");
    expect(html).toContain("LINE TOTAL");
    expect(html).toContain("10 × ₱135.00");
    expect(html).toContain("₱1,350.00");
    expect(html).toContain("₱175.00");
    expect(html).toContain("Total pieces");
    expect(html).toContain(">11<");
  });
});
