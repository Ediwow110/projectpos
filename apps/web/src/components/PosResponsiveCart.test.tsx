import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosResponsiveCart } from "./PosResponsiveCart";

const noop = () => undefined;

describe("POS responsive cart", () => {
  it("renders mobile/tablet trays, status recovery, and the cart drawer", () => {
    const html = renderToStaticMarkup(
      <PosResponsiveCart
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2 }]}
        count={2}
        due={5000}
        canPay
        status="Payment status unknown. Do not retry blindly."
        statusTone="warn"
        receiptId="sale-receipt"
        reconcileSaleId="sale-unknown"
        drawerOpen
        onOpenDrawer={noop}
        onCloseDrawer={noop}
        onAssignCustomer={noop}
        onSetQty={noop}
        onOpenPayment={noop}
      />,
    );

    expect(html).toContain('aria-label="Mobile cart"');
    expect(html).toContain('aria-label="Tablet cart"');
    expect(html).toContain('aria-label="Tablet cart details"');
    expect(html).toContain("Coffee");
    expect(html).toContain("/sales/sale-unknown");
    expect(html).toContain("/receipts/sale-receipt");
  });
});
