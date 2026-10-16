import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosPaymentWorkspace } from "./PosPaymentWorkspace";

describe("POS payment workspace", () => {
  it("renders the Atlas V4 light chooser while preserving the payment method and total", () => {
    const html = renderToStaticMarkup(<PosPaymentWorkspace atlasV4
      count={2} due={5000} changeMinor={0} registerSelected now="10:30"
      cart={[{ productId: "p1", name: "Oat milk", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 }]}
      paymentTiles={[{ key: "cash", label: "Cash", tile: "" }, { key: "qrph", label: "QR Ph", tile: "" }]}
      offline={false} effectiveMethod="cash" received="" paying={false} canPay methodAvailable={(key) => key === "cash"}
      onMethodChange={() => undefined} onReceivedChange={() => undefined} onClose={() => undefined} onPay={() => undefined}
    />);
    expect(html).toContain('data-ui="payment-workspace"');
    expect(html).toContain('aria-label="Payment"');
    expect(html).toContain("Choose a payment method");
    expect(html).toContain("QR Ph");
    expect(html).toContain("₱50.00");
    expect(html).toContain("Complete Payment");
    expect(html).toContain("Back to sale");
    expect(html).not.toContain("Payment completed");
  });
  it("keeps optional tenders discoverable without overcrowding the initial V4 chooser", () => {
    const html = renderToStaticMarkup(<PosPaymentWorkspace atlasV4
      count={1} due={2500} changeMinor={0} registerSelected now="11:00"
      cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1, lineDiscountMinor: 0 }]}
      paymentTiles={[{ key: "cash", label: "Cash", tile: "" }, { key: "card", label: "Card", tile: "" }, { key: "qrph", label: "QR Ph", tile: "" }, { key: "gcash", label: "GCash", tile: "" }]}
      offline={false} effectiveMethod="cash" received="" paying={false} canPay methodAvailable={() => true}
      onMethodChange={() => undefined} onReceivedChange={() => undefined} onClose={() => undefined} onPay={() => undefined}
    />);
    expect(html).toContain("Cash");
    expect(html).toContain("Card");
    expect(html).toContain("QR Ph");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Other payment methods");
    expect(html).toContain('id="additional-payment-methods" hidden=""');
    expect(html).toContain('>GCash<');
  });
  it("keeps the cashier's add-to-cart order in the checkout sale summary", () => {
    const html = renderToStaticMarkup(
      <PosPaymentWorkspace
        count={3}
        due={3000}
        changeMinor={0}
        registerSelected
        now="10:30 AM"
        cart={[
          { productId: "p-z", name: "Zebra Water", priceMinor: 1000, qty: 1, lineDiscountMinor: 0 },
          { productId: "p-a", name: "Apple Juice", priceMinor: 1000, qty: 1, lineDiscountMinor: 0 },
          { productId: "p-m", name: "Mango Soda", priceMinor: 1000, qty: 1, lineDiscountMinor: 0 },
        ]}
        paymentTiles={[{ key: "cash", label: "Cash", tile: "bg-[#f35d3f]" }]}
        offline={false}
        effectiveMethod="cash"
        received=""
        paying={false}
        canPay
        methodAvailable={() => true}
        onMethodChange={() => undefined}
        onReceivedChange={() => undefined}
        onClose={() => undefined}
        onPay={() => undefined}
      />,
    );

    expect(html.indexOf("Zebra Water")).toBeLessThan(html.indexOf("Apple Juice"));
    expect(html.indexOf("Apple Juice")).toBeLessThan(html.indexOf("Mango Soda"));
  });

  it("renders mobile and desktop payment surfaces from the same sale state", () => {
    const html = renderToStaticMarkup(
      <PosPaymentWorkspace
        count={2}
        due={5000}
        changeMinor={500}
        registerSelected
        now="10:30 AM"
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 }]}
        paymentTiles={[{ key: "cash", label: "Cash", tile: "bg-[#f35d3f]" }]}
        offline={false}
        effectiveMethod="cash"
        received="55"
        paying={false}
        canPay
        methodAvailable={() => true}
        onMethodChange={() => undefined}
        onReceivedChange={() => undefined}
        onClose={() => undefined}
        onPay={() => undefined}
      />,
    );

    expect(html).toContain('data-ui="payment-workspace"');
    expect(html).toContain("Take payment");
    expect(html).toContain("Sale summary");
    expect(html).toContain("Coffee");
    expect(html).toContain("₱50.00");
    expect(html).toContain("Complete Payment");
  });

  it("does not show cash tender controls for QR Ph hosted checkout", () => {
    const html = renderToStaticMarkup(
      <PosPaymentWorkspace
        count={1}
        due={2500}
        changeMinor={0}
        registerSelected
        now="10:30 AM"
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1, lineDiscountMinor: 0 }]}
        paymentTiles={[
          { key: "cash", label: "Cash", tile: "bg-[#f35d3f]" },
          { key: "qrph", label: "QR Ph", tile: "bg-[#6554c0]" },
        ]}
        offline={false}
        effectiveMethod="qrph"
        received=""
        paying={false}
        canPay
        methodAvailable={() => true}
        onMethodChange={() => undefined}
        onReceivedChange={() => undefined}
        onClose={() => undefined}
        onPay={() => undefined}
      />,
    );

    expect(html).not.toContain("Amount Received");
    expect(html).not.toContain("Cash received");
    expect(html).not.toContain(">Change<");
    expect(html).toContain("Continue in PayMongo secure checkout");
    expect(html).toContain("QR Ph");
  });
});
