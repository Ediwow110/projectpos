import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PayMongoHttpClient,
  createPayMongoFromEnv,
  payMongoMethodType,
} from "./paymongo";

function client() {
  return new PayMongoHttpClient({
    secretKey: "sk_test_secret",
    webhookSecret: "whsec_test",
    apiBase: "https://api.paymongo.test",
    webhookToleranceSeconds: 300,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PayMongo adapter", () => {
  it("maps the NexPOS Maya key to PayMongo paymaya", () => {
    expect(payMongoMethodType("card")).toBe("card");
    expect(payMongoMethodType("gcash")).toBe("gcash");
    expect(payMongoMethodType("maya")).toBe("paymaya");
  });

  it("stays disabled until both the API key and webhook secret exist", () => {
    expect(createPayMongoFromEnv({}).configured()).toBe(false);
    expect(createPayMongoFromEnv({ PAYMONGO_SECRET_KEY: "sk_test_only" }).configured()).toBe(false);
    expect(createPayMongoFromEnv({
      PAYMONGO_SECRET_KEY: "sk_test_ready",
      PAYMONGO_WEBHOOK_SECRET: "whsec_ready",
    }).configured()).toBe(true);
  });

  it("creates hosted checkout v2 server-side with PayMongo idempotency", async () => {
    const fetchMock = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response(JSON.stringify({
      data: { id: "cs_123", attributes: { checkout_url: "https://checkout.paymongo.test/cs_123" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await client().createCheckout({
      saleId: "sale_1",
      receiptNo: "2026-000001",
      businessId: "biz_1",
      method: "maya",
      idempotencyKey: "checkout-key-1",
      successUrl: "https://pos.example.com/sales/sale_1?paymongo=success",
      cancelUrl: "https://pos.example.com/sales/sale_1?paymongo=cancelled",
      lineItems: [{ name: "NexPOS sale 2026-000001", amount: 2500, quantity: 1 }],
    });

    expect(out).toEqual({ sessionId: "cs_123", checkoutUrl: "https://checkout.paymongo.test/cs_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.paymongo.test/v2/checkout_sessions");
    expect(init?.headers).toMatchObject({
      "Idempotency-Key": "checkout-key-1",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body)) as {
      data: { attributes: Record<string, unknown> };
    };
    expect(body.data.attributes["payment_method_types"]).toEqual(["paymaya"]);
    expect(body.data.attributes["reference_number"]).toBe("sale_1");
    expect(body.data.attributes["line_items"]).toEqual([
      { name: "NexPOS sale 2026-000001", amount: 2500, currency: "PHP", quantity: 1 },
    ]);
  });

  it("verifies the Paymongo-Signature over timestamp dot raw body", () => {
    const raw = '{"data":{"id":"evt_1"}}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${raw}`).digest("hex");
    expect(client().verifyWebhook(raw, `t=${timestamp},te=${signature},li=`)).toBe(true);
    expect(client().verifyWebhook(raw, `t=${timestamp},te=deadbeef,li=`)).toBe(false);
  });
});
