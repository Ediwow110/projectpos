import { createHmac, timingSafeEqual } from "node:crypto";

export const PAYMONGO_PORT = "PayMongoPort";

export type PayMongoMethod = "card" | "gcash" | "maya" | "qrph";

export interface PayMongoCheckoutInput {
  saleId: string;
  receiptNo: string;
  businessId: string;
  method: PayMongoMethod;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  lineItems: Array<{ name: string; amount: number; quantity: number }>;
}

export interface PayMongoCheckoutResult {
  sessionId: string;
  checkoutUrl: string;
}

export interface PayMongoCheckoutSnapshot {
  sessionId: string;
  checkoutUrl: string | null;
  status: "active" | "expired" | "unknown";
  paid: boolean;
}

export interface PayMongoPort {
  configured(): boolean;
  createCheckout(input: PayMongoCheckoutInput): Promise<PayMongoCheckoutResult>;
  retrieveCheckout(sessionId: string): Promise<PayMongoCheckoutSnapshot>;
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): boolean;
}

export function isPayMongoMethod(value: string): value is PayMongoMethod {
  return value === "card" || value === "gcash" || value === "maya" || value === "qrph";
}

export function payMongoMethodType(method: PayMongoMethod): "card" | "gcash" | "paymaya" | "qrph" {
  return method === "maya" ? "paymaya" : method;
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export class DisabledPayMongo implements PayMongoPort {
  configured(): boolean { return false; }
  async createCheckout(): Promise<PayMongoCheckoutResult> { throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED"); }
  async retrieveCheckout(sessionId: string): Promise<PayMongoCheckoutSnapshot> {
    return { sessionId, checkoutUrl: null, status: "unknown", paid: false };
  }
  verifyWebhook(): boolean { return false; }
}

interface PayMongoClientConfig {
  secretKey: string;
  webhookSecret: string;
  apiBase: string;
  webhookToleranceSeconds: number;
}

export class PayMongoHttpClient implements PayMongoPort {
  constructor(private readonly config: PayMongoClientConfig) {}

  configured(): boolean { return true; }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`${this.config.secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  async createCheckout(input: PayMongoCheckoutInput): Promise<PayMongoCheckoutResult> {
    let response: Response;
    try {
      response = await fetch(`${this.config.apiBase}/v2/checkout_sessions`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Idempotency-Key": input.idempotencyKey },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: input.lineItems.map((item) => ({
                name: item.name,
                amount: item.amount,
                currency: "PHP",
                quantity: item.quantity,
              })),
              payment_method_types: [payMongoMethodType(input.method)],
              success_url: input.successUrl,
              cancel_url: input.cancelUrl,
              reference_number: input.saleId,
              send_email_receipt: false,
              metadata: {
                businessId: input.businessId,
                saleId: input.saleId,
                receiptNo: input.receiptNo,
                method: input.method,
              },
            },
          },
        }),
      });
    } catch {
      throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (!response.ok) {
      throw new Error(response.status >= 500 ? "PAYMENT_PROVIDER_UNAVAILABLE" : "PAYMENT_PROVIDER_REJECTED");
    }
    const body = await response.json() as {
      data?: { id?: unknown; attributes?: { checkout_url?: unknown } };
    };
    const sessionId = body.data?.id;
    const checkoutUrl = body.data?.attributes?.checkout_url;
    if (typeof sessionId !== "string" || typeof checkoutUrl !== "string") {
      throw new Error("PAYMENT_PROVIDER_INVALID_RESPONSE");
    }
    return { sessionId, checkoutUrl };
  }

  async retrieveCheckout(sessionId: string): Promise<PayMongoCheckoutSnapshot> {
    let response: Response;
    try {
      response = await fetch(`${this.config.apiBase}/v1/checkout_sessions/${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers: this.authHeaders(),
      });
    } catch {
      throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (response.status === 404) return { sessionId, checkoutUrl: null, status: "unknown", paid: false };
    if (!response.ok) throw new Error(response.status >= 500 ? "PAYMENT_PROVIDER_UNAVAILABLE" : "PAYMENT_PROVIDER_REJECTED");
    const body = await response.json() as {
      data?: {
        id?: unknown;
        attributes?: {
          checkout_url?: unknown;
          status?: unknown;
          payments?: Array<{ attributes?: { status?: unknown } }>;
          payment_intent?: { attributes?: { status?: unknown } } | null;
        };
      };
    };
    const attrs = body.data?.attributes;
    const rawStatus = attrs?.status;
    const status = rawStatus === "active" || rawStatus === "expired" ? rawStatus : "unknown";
    const paid = (attrs?.payments ?? []).some((payment) => payment.attributes?.status === "paid") || attrs?.payment_intent?.attributes?.status === "succeeded";
    return {
      sessionId,
      checkoutUrl: typeof attrs?.checkout_url === "string" ? attrs.checkout_url : null,
      status,
      paid,
    };
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((part) => {
        const [key, ...rest] = part.trim().split("=");
        return [key, rest.join("=")];
      }),
    );
    const timestamp = parts["t"];
    if (!timestamp || !/^\d+$/.test(timestamp)) return false;
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (Number.isFinite(ageSeconds) && ageSeconds > this.config.webhookToleranceSeconds) return false;
    const expected = createHmac("sha256", this.config.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const signatureField = this.config.secretKey.startsWith("sk_live_")
      ? "li"
      : this.config.secretKey.startsWith("sk_test_")
        ? "te"
        : null;
    if (!signatureField) return false;
    const candidate = parts[signatureField];
    return typeof candidate === "string" && safeHexEqual(expected, candidate);
  }
}

export function createPayMongoFromEnv(env: NodeJS.ProcessEnv = process.env): PayMongoPort {
  const secretKey = env["PAYMONGO_SECRET_KEY"]?.trim() ?? "";
  const webhookSecret = env["PAYMONGO_WEBHOOK_SECRET"]?.trim() ?? "";
  if (!secretKey || !webhookSecret) return new DisabledPayMongo();
  const tolerance = Number(env["PAYMONGO_WEBHOOK_TOLERANCE_SECONDS"] ?? 300);
  return new PayMongoHttpClient({
    secretKey,
    webhookSecret,
    apiBase: (env["PAYMONGO_API_BASE"]?.trim() || "https://api.paymongo.com").replace(/\/$/, ""),
    webhookToleranceSeconds: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 300,
  });
}

export function payMongoModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): "test" | "live" | "disabled" | "unknown" {
  const secretKey = env["PAYMONGO_SECRET_KEY"]?.trim() ?? "";
  const webhookSecret = env["PAYMONGO_WEBHOOK_SECRET"]?.trim() ?? "";
  if (!secretKey || !webhookSecret) return "disabled";
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return "unknown";
}
