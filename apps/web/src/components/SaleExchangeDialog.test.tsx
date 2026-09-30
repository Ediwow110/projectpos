import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SaleExchangeDialog } from "./SaleExchangeDialog";

describe("sale exchange dialog", () => {
  it("explains cash-only settlement and exposes return, replacement, reason, and completion controls", () => {
    const html = renderToStaticMarkup(
      <SaleExchangeDialog
        lines={[{ id: "line-1", name: "Original Shirt", qty: 1, lineTotalMinor: 2500, alreadyRefundedQty: 0 }]}
        products={[{ id: "p2", name: "Replacement Shirt", priceMinor: 3000, taxRateBps: null }]}
        businessTaxRateBps={null}
        search=""
        productsLoading={false}
        busy={false}
        error=""
        onSearchChange={() => undefined}
        onSubmit={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Exchange items");
    expect(html).toContain("Cash-settled sale");
    expect(html).toContain("Original Shirt");
    expect(html).toContain("Replacement Shirt");
    expect(html).toContain("Reason for exchange");
    expect(html).toContain("Net difference");
    expect(html).toContain("Complete exchange");
  });
});
