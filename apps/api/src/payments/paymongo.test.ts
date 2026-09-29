import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PayMongoHttpClient,
  createPayMongoFromEnv,
  listPayMongoWebhookDiagnosticsFromEnv,
  payMongoModeFromEnv,
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
    expect(payMongoMethodType("qrph")).toBe("qrph");
  });

  it("creates a QR Ph hosted checkout using the qrph method type", async () => {
    const fetchMock = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response(JSON.stringify({
      data: { id: "cs_qrph", attributes: { checkout_url: "https://checkout.paymongo.test/cs_qrph" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await client().createCheckout({
      saleId: "sale_qrph",
      receiptNo: "2026-000002",
      businessId: "biz_1",
      method: "qrph",
      idempotencyKey: "checkout-key-qrph",
      successUrl: "https://pos.example.com/sales/sale_qrph?paymongo=success",
      cancelUrl: "https://pos.example.com/sales/sale_qrph?paymongo=cancelled",
      lineItems: [{ name: "QR Ph sale", amount: 10000, quantity: 1 }],
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as { data: { attributes: Record<string, unknown> } };
    expect(body.data.attributes["payment_method_types"]).toEqual(["qrph"]);
  });

  it("stays disabled until both the API key and webhook secret exist", () => {
    expect(createPayMongoFromEnv({}).configured()).toBe(false);
    expect(createPayMongoFromEnv({ PAYMONGO_SECRET_KEY: "sk_test_only" }).configured()).toBe(false);
    expect(createPayMongoFromEnv({
      PAYMONGO_SECRET_KEY: "sk_test_ready",
      PAYMONGO_WEBHOOK_SECRET: "whsec_ready",
    }).configured()).toBe(true);
  });

  it("reports only the non-secret PayMongo runtime mode", () => {
    expect(payMongoModeFromEnv({})).toBe("disabled");
    expect(payMongoModeFromEnv({
      PAYMONGO_SECRET_KEY: "sk_test_ready",
      PAYMONGO_WEBHOOK_SECRET: "whsec_ready",
    })).toBe("test");
    expect(payMongoModeFromEnv({
      PAYMONGO_SECRET_KEY: "sk_live_ready",
      PAYMONGO_WEBHOOK_SECRET: "whsec_ready",
    })).toBe("live");
    expect(payMongoModeFromEnv({
      PAYMONGO_SECRET_KEY: "unexpected_key",
      PAYMONGO_WEBHOOK_SECRET: "whsec_ready",
    })).toBe("unknown");
  });

  it("lists webhook diagnostics without returning provider secrets", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: "hook_test",
          type: "webhook",
          attributes: {
            events: ["checkout_session.payment.paid"],
            livemode: false,
            secret_key: "whsk_must_not_escape",
            status: "enabled",
            url: "https://example.test/api/v1/payments/paymongo/webhook",
          },
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const diagnostics = await listPayMongoWebhookDiagnosticsFromEnv({
      PAYMONGO_SECRET_KEY: "sk_test_ready",
      PAYMONGO_WEBHOOK_SECRET: "whsec_ready",
      PAYMONGO_API_BASE: "https://api.paymongo.test",
    });

    expect(diagnostics).toEqual([{
      id: "hook_test",
      url: "https://example.test/api/v1/payments/paymongo/webhook",
      status: "enabled",
      livemode: false,
      events: ["checkout_session.payment.paid"],
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain("whsk_must_not_escape");
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

  it("accepts only the signature slot matching the configured test or live API key", () => {
    const raw = '{"data":{"id":"evt_mode"}}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${raw}`).digest("hex");
    const testClient = client();
    const liveClient = new PayMongoHttpClient({
      secretKey: "sk_live_secret",
      webhookSecret: "whsec_test",
      apiBase: "https://api.paymongo.test",
      webhookToleranceSeconds: 300,
    });

    expect(testClient.verifyWebhook(raw, `t=${timestamp},te=${signature},li=`)).toBe(true);
    expect(testClient.verifyWebhook(raw, `t=${timestamp},te=,li=${signature}`)).toBe(false);
    expect(liveClient.verifyWebhook(raw, `t=${timestamp},te=,li=${signature}`)).toBe(true);
    expect(liveClient.verifyWebhook(raw, `t=${timestamp},te=${signature},li=`)).toBe(false);
  });
});
