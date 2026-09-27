import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosCustomerDialog } from "./PosCustomerDialog";

const noop = () => undefined;

describe("POS customer dialog", () => {
  it("renders customer search, walk-in state, and clear/use actions", () => {
    const html = renderToStaticMarkup(
      <PosCustomerDialog
        customerQuery="Ana"
        customerId="cust-1"
        walkIn=""
        customers={[{ id: "cust-1", name: "Ana Cruz", phone: "09170000000" }]}
        onCustomerQueryChange={noop}
        onSelectCustomer={noop}
        onWalkInChange={noop}
        onClear={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain('aria-label="Customer assignment"');
    expect(html).toContain("Ana Cruz");
    expect(html).toContain("09170000000");
    expect(html).toContain("Selected: Ana");
    expect(html).toContain("Use for sale");
    expect(html).toContain("Clear");
  });
});
