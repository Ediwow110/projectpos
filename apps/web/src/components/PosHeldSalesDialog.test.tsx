import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosHeldSalesDialog } from "./PosHeldSalesDialog";

const noop = () => undefined;

describe("POS held sales dialog", () => {
  it("renders held carts with customer, item summary, and resume action", () => {
    const html = renderToStaticMarkup(
      <PosHeldSalesDialog
        heldSales={[{
          heldId: "held-1",
          sale: {
            id: "sale-1",
            status: "DRAFT",
            createdAt: "2026-09-30T01:00:00.000Z",
            registerId: "reg-1",
            branchId: "branch-1",
            customerId: "cust-1",
            customerName: "Ana Cruz",
            discountMinor: 0,
            totalMinor: 5000,
            items: [
              { position: 0, productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 },
            ],
          },
        }]}
        loading={false}
        busySaleId={null}
        onResume={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain('aria-label="Held sales"');
    expect(html).toContain("Ana Cruz");
    expect(html).toContain("Coffee ×2");
    expect(html).toContain("₱50.00");
    expect(html).toContain("Resume sale");
  });

  it("renders an empty state without a fake resume action", () => {
    const html = renderToStaticMarkup(
      <PosHeldSalesDialog
        heldSales={[]}
        loading={false}
        busySaleId={null}
        onResume={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain("No held sales yet");
    expect(html).not.toContain("Resume sale");
  });
});
