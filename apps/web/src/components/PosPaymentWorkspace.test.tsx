import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { PosCheckoutFailure } from "../lib/pos-checkout-feedback";
import { PosPaymentWorkspace } from "./PosPaymentWorkspace";

function payButtonMarkup(html: string): string {
  return html.match(/<button[^>]*>(?:Complete Payment|Continue to PayMongo)<\/button>/)?.[0] ?? "";
}

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
    expect(html).toContain("Take payment");
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

  it("renders an actionable failure inside the Atlas dialog and blocks a blind retry", () => {
    const failure: PosCheckoutFailure = {
      kind: "unknown_outcome",
      title: "Payment status unknown",
      message:
        "Payment status unknown. This request may already be recorded on the server. Do not retry payment; check the sale status first.",
      action: { kind: "check_sale", label: "Check sale status", href: "/sales/sale-9" },
      retryable: false,
      code: "HTTP_ERROR",
      correlationId: "corr-9",
      saleId: "sale-9",
    };
    const html = renderToStaticMarkup(<PosPaymentWorkspace atlasV4
      count={1} due={2500} changeMinor={0} registerSelected now="11:00"
      cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1, lineDiscountMinor: 0 }]}
      paymentTiles={[{ key: "cash", label: "Cash", tile: "" }]}
      offline={false} effectiveMethod="cash" received="" paying={false} canPay methodAvailable={() => true}
      onMethodChange={() => undefined} onReceivedChange={() => undefined} onClose={() => undefined} onPay={() => undefined}
      failure={failure}
    />);

    expect(html).toContain('data-ui="payment-failure"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('id="payment-failure-atlas"');
    expect(html).toContain("Payment status unknown");
    expect(html).toContain("Do not retry payment");
    expect(html).toContain('href="/sales/sale-9"');
    expect(html).toContain("Check sale status");
    expect(html).toContain('aria-describedby="payment-failure-atlas"');
    expect(payButtonMarkup(html)).toContain('disabled=""');
  });

  it("keeps the payment action available for a recoverable stock failure", () => {
    const failure: PosCheckoutFailure = {
      kind: "stock",
      title: "Not enough stock",
      message: "Not enough stock for one or more items. Go back to the sale, reduce the quantity, then try again.",
      action: { kind: "adjust_cart", label: "Back to sale to adjust" },
      retryable: true,
      code: "INSUFFICIENT_STOCK",
      correlationId: "",
      saleId: "sale-stock",
    };
    const html = renderToStaticMarkup(<PosPaymentWorkspace atlasV4
      count={1} due={2500} changeMinor={0} registerSelected now="11:00"
      cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1, lineDiscountMinor: 0 }]}
      paymentTiles={[{ key: "cash", label: "Cash", tile: "" }]}
      offline={false} effectiveMethod="cash" received="" paying={false} canPay methodAvailable={() => true}
      onMethodChange={() => undefined} onReceivedChange={() => undefined} onClose={() => undefined} onPay={() => undefined}
      failure={failure}
    />);

    expect(html).toContain("Back to sale to adjust");
    expect(html).not.toContain('data-failure-kind="unknown_outcome"');
    expect(payButtonMarkup(html)).not.toContain('disabled=""');
  });

  it("gives the legacy mobile and desktop surfaces distinct failure alerts", () => {
    const failure: PosCheckoutFailure = {
      kind: "permission",
      title: "Approval needed",
      message: "You do not have permission to complete this sale. Ask an owner or manager to approve it or take over the payment.",
      action: { kind: "none" },
      retryable: false,
      code: "FORBIDDEN",
      correlationId: "",
      saleId: null,
    };
    const html = renderToStaticMarkup(<PosPaymentWorkspace
      count={1} due={2500} changeMinor={0} registerSelected now="11:00"
      cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1, lineDiscountMinor: 0 }]}
      paymentTiles={[{ key: "cash", label: "Cash", tile: "" }]}
      offline={false} effectiveMethod="cash" received="" paying={false} canPay methodAvailable={() => true}
      onMethodChange={() => undefined} onReceivedChange={() => undefined} onClose={() => undefined} onPay={() => undefined}
      failure={failure}
    />);

    expect(html).toContain('id="payment-failure-mobile"');
    expect(html).toContain('id="payment-failure-desktop"');
    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(html).toContain('aria-describedby="payment-failure-mobile"');
    expect(html).toContain('aria-describedby="payment-failure-desktop"');
  });
});
