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

  /**
   * renderToStaticMarkup never runs effects, so the Escape handler, the Tab
   * cycling and the focus restore lifted from Modal.tsx cannot be exercised
   * here. What markup CAN prove is that the dialog element carries the trap
   * contract: role/aria-modal, the data-focus-trap marker the effect binds to,
   * and a tabindex that lets the container itself receive focus.
   */
  it("declares the modal focus-trap contract on the dialog element", () => {
    const html = renderToStaticMarkup(
      <PosCustomerDialog
        customerQuery="Ana"
        customerId=""
        walkIn="Walk-in"
        customers={[]}
        onCustomerQueryChange={noop}
        onSelectCustomer={noop}
        onWalkInChange={noop}
        onClear={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-focus-trap="true"');
    expect(html).toContain('tabindex="-1"');
  });

  it("keeps every dialog control at the 44px touch contract and readable captions", () => {
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

    expect(html).toContain("grid h-11 w-11");
    expect(html).toContain("min-h-11 w-full rounded-lg");
    expect(html).toContain("min-h-11 rounded-lg border border-white/10");
    expect(html).not.toContain("h-9 w-9");
    expect(html).not.toContain("text-white/45");
    expect(html).toContain("text-white/70");
  });
});
