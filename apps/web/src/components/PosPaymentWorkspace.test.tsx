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
});
