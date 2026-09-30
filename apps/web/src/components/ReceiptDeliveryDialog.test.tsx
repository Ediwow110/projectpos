import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReceiptDeliveryDialog } from "./ReceiptDeliveryDialog";

describe("receipt delivery dialog", () => {
  it("prefills customer email and explains email/share delivery without claiming SMS support", () => {
    const html = renderToStaticMarkup(
      <ReceiptDeliveryDialog
        receiptNo="2026-000123"
        customerEmail="ana@example.com"
        deliveries={[{
          id: "d1",
          channel: "email",
          recipient: "ana@example.com",
          status: "SENT",
          createdAt: "2026-10-01T00:00:00.000Z",
          sentAt: "2026-10-01T00:00:01.000Z",
          errorCode: null,
        }]}
        busy={false}
        error=""
        success=""
        onEmail={() => undefined}
        onShare={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Deliver receipt");
    expect(html).toContain("ana@example.com");
    expect(html).toContain("Email receipt");
    expect(html).toContain("Create secure share link");
    expect(html).toContain("SENT");
    expect(html).not.toContain("SMS");
  });
});
