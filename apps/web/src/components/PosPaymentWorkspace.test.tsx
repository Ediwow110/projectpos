import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosPaymentWorkspace } from "./PosPaymentWorkspace";

describe("POS payment workspace", () => {
  it("renders mobile and desktop payment surfaces from the same sale state", () => {
    const html = renderToStaticMarkup(
      <PosPaymentWorkspace
        count={2}
        due={5000}
        changeMinor={500}
        registerSelected
        now="10:30 AM"
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2 }]}
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
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 1 }]}
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
