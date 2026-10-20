import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PosSaleConfirmedDialog } from "./PosSaleConfirmedDialog";

describe("Atlas V4 completed sale confirmation", () => {
  it("uses a verified sale and receipt link without exposing a Back or Print action", () => {
    const html = renderToStaticMarkup(
      <PosSaleConfirmedDialog
        sale={{ saleId: "sale-123", receiptNo: "2026-000123", amountMinor: 40500 }}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('data-ui="atlas-flow-modal"');
    expect(html).toContain("Payment complete");
    expect(html).toContain("₱405.00 received");
    expect(html).toContain("Sale #2026-000123");
    expect(html).toContain("Payment: confirmed");
    expect(html).toContain("Receipt: available");
    expect(html).toContain('href="/receipts/sale-123"');
    expect(html).toContain(">View receipt</a>");
    expect(html).toContain(">OK</button>");
    expect(html).not.toContain(">Back</button>");
    expect(html).not.toContain(">Print</button>");
  });

  it("does not invent a receipt number when the complete-sale response omits one", () => {
    const html = renderToStaticMarkup(
      <PosSaleConfirmedDialog sale={{ saleId: "sale-234", amountMinor: 2500 }} onClose={() => undefined} />,
    );
    expect(html).toContain("Sale recorded");
    expect(html).toContain('href="/receipts/sale-234"');
  });
});
