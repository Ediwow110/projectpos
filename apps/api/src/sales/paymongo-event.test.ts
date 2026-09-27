import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parsePayMongoPaidEvent } from "./paymongo-event";

describe("PayMongo paid-event parser", () => {
  it("parses a hosted QR Ph paid event", () => {
    const raw = JSON.stringify({
      data: {
        id: "evt_qrph",
        type: "checkout_session.payment.paid",
        data: {
          id: "cs_qrph",
          attributes: {
            reference_number: "sale_1",
            metadata: { businessId: "biz_1", saleId: "sale_1", method: "qrph" },
            payments: [{ attributes: { status: "paid", amount: 2500, source: { type: "qrph" } } }],
          },
        },
      },
    });

    expect(parsePayMongoPaidEvent(JSON.parse(raw), raw)).toEqual({
      eventId: "evt_qrph",
      type: "checkout_session.payment.paid",
      businessId: "biz_1",
      saleId: "sale_1",
      checkoutSessionId: "cs_qrph",
      method: "qrph",
      sourceType: "qrph",
      amountMinor: 2500,
    });
  });

  it("supports the generic event envelope and derives a stable event id when absent", () => {
    const payload = {
      data: {
        attributes: {
          type: "checkout_session.payment.paid",
          data: {
            id: "cs_card",
            attributes: {
              reference_number: "sale_2",
              metadata: { businessId: "biz_2", method: "card" },
              payments: [{ attributes: { status: "paid", amount: 1000, source: { type: "card" } } }],
            },
          },
        },
      },
    };
    const raw = JSON.stringify(payload);
    expect(parsePayMongoPaidEvent(payload, raw)?.eventId).toBe(
      `evt_sha256_${createHash("sha256").update(raw).digest("hex")}`,
    );
  });
});
