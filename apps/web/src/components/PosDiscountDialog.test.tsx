import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosDiscountDialog } from "./PosDiscountDialog";

describe("POS discount dialog", () => {
  it("shows order and per-line fixed discount controls plus the server-authorization threshold", () => {
    const html = renderToStaticMarkup(
      <PosDiscountDialog
        cart={[{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }]}
        orderDiscountMinor={300}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Sale discounts");
    expect(html).toContain("Order discount (PHP)");
    expect(html).toContain("Line discount — Coffee (PHP)");
    expect(html).toContain("10%");
    expect(html).toContain("20%");
    expect(html).toContain("discount.override");
    expect(html).toContain("request an owner or manager approval");
    expect(html).toContain("Apply discounts");
    expect(html).toContain("Clear all");
  });
});
