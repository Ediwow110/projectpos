import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosCartPanel } from "./PosCartPanel";

const noop = () => undefined;

describe("POS current-sale panel", () => {
  it("renders the desktop cart rail with totals, payment action, and quantity controls", () => {
    const html = renderToStaticMarkup(
      <PosCartPanel
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }]}
        count={2}
        subtotalMinor={5000}
        due={4200}
        discountMinor={800}
        selectedRegisterName="Counter 1"
        canSell
        canPay
        offline={false}
        saleLocked={false}
        heldCount={1}
        effectiveMethod="cash"
        status=""
        statusTone="neutral"
        receiptId={null}
        reconcileId={null}
        reconcileSaleId={null}
        methodAvailable={() => true}
        onHold={noop}
        onOpenHeldSales={noop}
        onOpenDiscounts={noop}
        onClearCart={noop}
        onResetSale={noop}
        onSetQty={noop}
        onAssignCustomer={noop}
        onOpenPayment={noop}
        onSelectShortcut={noop}
      />,
    );

    expect(html).toContain('aria-label="Cart"');
    expect(html).toContain("Current sale");
    expect(html).toContain("Coffee");
    expect(html).toContain("−₱8.00");
    expect(html).toContain("Discounts");
    expect(html).toContain("Pay ₱42.00");
    expect(html).toContain('aria-label="Decrease Coffee"');
    expect(html).toContain('aria-label="Increase Coffee"');
  });

  it("keeps unresolved payment and receipt recovery links visible in the rail", () => {
    const html = renderToStaticMarkup(
      <PosCartPanel
        cart={[]}
        count={0}
        subtotalMinor={0}
        due={0}
        discountMinor={0}
        selectedRegisterName="—"
        canSell
        canPay={false}
        offline={false}
        saleLocked={false}
        heldCount={0}
        effectiveMethod="cash"
        status="Payment status unknown. Do not retry blindly."
        statusTone="warn"
        receiptId="sale-receipt"
        reconcileId="pay-1"
        reconcileSaleId="sale-unknown"
        methodAvailable={() => true}
        onHold={noop}
        onOpenHeldSales={noop}
        onOpenDiscounts={noop}
        onClearCart={noop}
        onResetSale={noop}
        onSetQty={noop}
        onAssignCustomer={noop}
        onOpenPayment={noop}
        onSelectShortcut={noop}
      />,
    );

    expect(html).toContain("/sales/sale-unknown");
    expect(html).toContain("Review unknown payment");
    expect(html).toContain("/receipts/sale-receipt");
  });
});
