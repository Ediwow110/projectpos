import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderPaymentRetry } from "./OrderPaymentRetry";

Object.assign(globalThis, { React });

function render(overrides: { status?: string; paymentMode?: string; paymentStatus?: string } = {}): string {
  const order = {
    id: "ord_1234567890",
    status: overrides.status ?? "SUBMITTED",
    paymentMode: overrides.paymentMode ?? "PREPAID",
    paymentStatus: overrides.paymentStatus ?? "FAILED",
  } as never;
  return renderToStaticMarkup(<OrderPaymentRetry order={order} />);
}

describe("order payment retry control", () => {
  it("offers the retry with every method the checkout accepts", () => {
    const html = render();
    expect(html).toContain('data-ui="order-retry-submit"');
    expect(html).toContain('data-ui="order-retry-method"');
    for (const method of ["card", "gcash", "maya", "qrph"]) {
      expect(html).toContain(`>${method}<`);
    }
  });

  it("stays out of the way once the money is settled", () => {
    expect(render({ paymentStatus: "PAID" })).not.toContain('data-ui="order-retry-submit"');
    expect(render({ paymentStatus: "REFUNDED" })).not.toContain('data-ui="order-retry-submit"');
  });

  it("stays out of the way while a payment is still being confirmed", () => {
    expect(render({ paymentStatus: "PENDING" })).not.toContain('data-ui="order-retry-submit"');
    expect(render({ paymentStatus: "UNKNOWN" })).not.toContain('data-ui="order-retry-submit"');
  });

  it("does not offer an online retry for a pay-at-pickup order", () => {
    expect(render({ paymentMode: "POS" })).not.toContain('data-ui="order-retry-submit"');
  });

  it("explains the two-hour limit instead of silently failing later", () => {
    expect(render()).toContain("two hours");
  });
});
