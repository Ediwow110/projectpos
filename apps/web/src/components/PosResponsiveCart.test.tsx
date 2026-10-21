import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosResponsiveCart } from "./PosResponsiveCart";

const noop = () => undefined;

/** Shared drawer state so the gating/contrast tests render the same surface. */
const drawerProps = {
  count: 2,
  due: 4200,
  discountMinor: 800,
  canPay: true,
  saleLocked: false,
  heldCount: 1,
  status: "Payment status unknown. Do not retry blindly.",
  statusTone: "warn" as const,
  receiptId: "sale-receipt",
  reconcileSaleId: "sale-unknown",
  drawerOpen: true,
  onOpenDrawer: noop,
  onCloseDrawer: noop,
  onAssignCustomer: noop,
  onHold: noop,
  onOpenHeldSales: noop,
  onOpenDiscounts: noop,
  onSetQty: noop,
  onOpenPayment: noop,
};

const cartWithCoffee = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }];

describe("POS responsive cart", () => {
  it("renders mobile/tablet trays, status recovery, and the cart drawer", () => {
    const html = renderToStaticMarkup(
      <PosResponsiveCart
        cart={cartWithCoffee}
        count={2}
        due={4200}
        discountMinor={800}
        canPay
        saleLocked={false}
        heldCount={1}
        status="Payment status unknown. Do not retry blindly."
        statusTone="warn"
        receiptId="sale-receipt"
        reconcileSaleId="sale-unknown"
        drawerOpen
        onOpenDrawer={noop}
        onCloseDrawer={noop}
        onAssignCustomer={noop}
        onHold={noop}
        onOpenHeldSales={noop}
        onOpenDiscounts={noop}
        onSetQty={noop}
        onOpenPayment={noop}
        onOpenGiftCardLoad={noop}
      />,
    );

    expect(html).toContain('aria-label="Mobile cart"');
    expect(html).toContain('aria-label="Tablet cart"');
    expect(html).toContain('aria-label="Tablet cart details"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close cart"');
    expect(html).toContain('h-11 w-11');
    expect(html).toContain("Coffee");
    expect(html).toContain('aria-label="Remove Coffee"');
    expect(html).toContain("Line total ₱45.00");
    expect(html).toContain("Discounts");
    expect(html).toContain("−₱8.00");
    expect(html).toContain("/sales/sale-unknown");
    expect(html).toContain("/receipts/sale-receipt");
  });

  it("raises the dark drawer captions to the readable 70% white", () => {
    const html = renderToStaticMarkup(
      <PosResponsiveCart {...drawerProps} cart={cartWithCoffee} onOpenGiftCardLoad={noop} />,
    );

    expect(html).not.toContain("text-white/45");
    expect(html).not.toContain("text-white/40");
    expect(html).not.toContain("text-white/35");
    expect(html).toContain("text-white/70");
    // The drawer already carries its own Escape/Tab trap; this marks the element
    // it is bound to. The key handling itself is a DOM effect and cannot run
    // under renderToStaticMarkup.
    expect(html).toContain('data-focus-trap="true"');
  });

  it("renders the drawer Load-card control only when a handler exists", () => {
    const unwired = renderToStaticMarkup(<PosResponsiveCart {...drawerProps} cart={cartWithCoffee} />);
    const wired = renderToStaticMarkup(
      <PosResponsiveCart {...drawerProps} cart={cartWithCoffee} onOpenGiftCardLoad={noop} />,
    );

    expect(unwired).not.toContain("Load card");
    expect(wired).toContain("Load card");
    expect(wired).toContain("Add customer");
  });
});
