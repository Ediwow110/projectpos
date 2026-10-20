import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PosPaymentUnknownDialog } from "./PosPaymentUnknownDialog";

describe("Atlas V4 unknown-payment recovery", () => {
  it("shows a real sale reference and routes to review without offering a second charge", () => {
    const html = renderToStaticMarkup(
      <PosPaymentUnknownDialog saleId="sale-unknown-123" onClose={() => undefined} />,
    );
    expect(html).toContain('data-ui="atlas-flow-modal"');
    expect(html).toContain("Payment not yet confirmed");
    expect(html).toContain("Never charge again without checking evidence.");
    expect(html).toContain("Sale reference: sale-unknown-123");
    expect(html).toContain("Status: UNKNOWN");
    expect(html).toContain('href="/sales/sale-unknown-123"');
    expect(html).toContain(">Check status</a>");
    expect(html).not.toContain("aria-label=\"Close\"");
    expect(html).not.toMatch(/>Try again|>Retry|>Pay now/);
    expect(html).not.toContain("Payment complete");
    expect(html).not.toContain("View receipt");
  });

  it("encodes the actual sale id in the recovery destination", () => {
    const html = renderToStaticMarkup(
      <PosPaymentUnknownDialog saleId="sale/needs?checking" onClose={() => undefined} />,
    );
    expect(html).toContain('href="/sales/sale%2Fneeds%3Fchecking"');
  });
});
