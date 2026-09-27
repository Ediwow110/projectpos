import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosCartPanel } from "./PosCartPanel";

const noop = () => undefined;

describe("POS current-sale panel", () => {
  it("renders the desktop cart rail with totals, payment action, and quantity controls", () => {
    const html = renderToStaticMarkup(
      <PosCartPanel
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2 }]}
        count={2}
        due={5000}
        selectedRegisterName="Counter 1"
        canSell
        canPay
        offline={false}
        effectiveMethod="cash"
        status=""
        statusTone="neutral"
        receiptId={null}
        reconcileId={null}
        reconcileSaleId={null}
        methodAvailable={() => true}
        onHold={noop}
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
    expect(html).toContain("₱50.00");
    expect(html).toContain("Pay ₱50.00");
    expect(html).toContain('aria-label="Decrease Coffee"');
    expect(html).toContain('aria-label="Increase Coffee"');
  });

  it("keeps unresolved payment and receipt recovery links visible in the rail", () => {
    const html = renderToStaticMarkup(
      <PosCartPanel
        cart={[]}
        count={0}
        due={0}
        selectedRegisterName="—"
        canSell
        canPay={false}
        offline={false}
        effectiveMethod="cash"
        status="Payment status unknown. Do not retry blindly."
        statusTone="warn"
        receiptId="sale-receipt"
        reconcileId="pay-1"
        reconcileSaleId="sale-unknown"
        methodAvailable={() => true}
        onHold={noop}
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
