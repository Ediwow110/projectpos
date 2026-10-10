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

export interface PayMongoWebhookState {
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  events: string[];
  created: boolean;
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

  async ensureWebhook(url: string): Promise<PayMongoWebhookState> {
    let listResponse: Response;
    try {
      listResponse = await fetch(`${this.config.apiBase}/v1/webhooks`, {
        method: "GET",
        headers: this.authHeaders(),
      });
    } catch {
      throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (!listResponse.ok) {
      throw new Error(listResponse.status >= 500 ? "PAYMENT_PROVIDER_UNAVAILABLE" : "PAYMENT_PROVIDER_REJECTED");
    }
    const listBody = await listResponse.json() as {
      data?: Array<{
        id?: unknown;
        attributes?: {
          url?: unknown;
          status?: unknown;
          livemode?: unknown;
          events?: unknown;
          secret_key?: unknown;
        };
      }>;
    };
    const existing = (listBody.data ?? []).find((entry) => {
      const attrs = entry.attributes;
      return attrs?.url === url
        && Array.isArray(attrs.events)
        && attrs.events.includes("checkout_session.payment.paid");
    });
    if (existing) {
      const attrs = existing.attributes;
      if (
        typeof existing.id !== "string" ||
        typeof attrs?.url !== "string" ||
        typeof attrs.status !== "string" ||
        typeof attrs.livemode !== "boolean" ||
        !Array.isArray(attrs.events)
      ) {
        throw new Error("PAYMENT_PROVIDER_INVALID_RESPONSE");
      }
      if (typeof attrs.secret_key === "string" && attrs.secret_key.trim() !== "") {
        this.config.webhookSecret = attrs.secret_key.trim();
      } else {
        throw new Error("PAYMONGO_WEBHOOK_SECRET_UNAVAILABLE");
      }
      let status = attrs.status;
      if (status !== "enabled") {
        let enableResponse: Response;
        try {
          enableResponse = await fetch(
            `${this.config.apiBase}/v1/webhooks/${encodeURIComponent(existing.id)}/enable`,
            { method: "POST", headers: this.authHeaders() },
          );
        } catch {
          throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
        }
        if (!enableResponse.ok) {
          throw new Error(enableResponse.status >= 500
            ? "PAYMENT_PROVIDER_UNAVAILABLE"
            : "PAYMENT_PROVIDER_REJECTED");
        }
        status = "enabled";
      }
      return {
        id: existing.id,
        url: attrs.url,
        status,
        livemode: attrs.livemode,
        events: attrs.events.filter((event): event is string => typeof event === "string"),
        created: false,
      };
    }

    let createResponse: Response;
    try {
      createResponse = await fetch(`${this.config.apiBase}/v1/webhooks`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          data: {
            attributes: {
              url,
              events: ["checkout_session.payment.paid"],
            },
          },
        }),
      });
    } catch {
      throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (!createResponse.ok) {
      throw new Error(createResponse.status >= 500 ? "PAYMENT_PROVIDER_UNAVAILABLE" : "PAYMENT_PROVIDER_REJECTED");
    }
    const createdBody = await createResponse.json() as {
      data?: {
        id?: unknown;
        attributes?: {
          url?: unknown;
          status?: unknown;
          livemode?: unknown;
          events?: unknown;
          secret_key?: unknown;
        };
      };
    };
    const created = createdBody.data;
    const attrs = created?.attributes;
    if (
      typeof created?.id !== "string" ||
      typeof attrs?.url !== "string" ||
      typeof attrs.status !== "string" ||
      typeof attrs.livemode !== "boolean" ||
      !Array.isArray(attrs.events) ||
      typeof attrs.secret_key !== "string" ||
      attrs.secret_key.trim() === ""
    ) {
      throw new Error("PAYMENT_PROVIDER_INVALID_RESPONSE");
    }
    this.config.webhookSecret = attrs.secret_key.trim();
    return {
      id: created.id,
      url: attrs.url,
      status: attrs.status,
      livemode: attrs.livemode,
      events: attrs.events.filter((event): event is string => typeof event === "string"),
      created: true,
    };
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || this.config.webhookSecret.trim() === "") return false;
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
  if (!secretKey) return new DisabledPayMongo();
  const tolerance = Number(env["PAYMONGO_WEBHOOK_TOLERANCE_SECONDS"] ?? 300);
  return new PayMongoHttpClient({
    secretKey,
    webhookSecret,
    apiBase: (env["PAYMONGO_API_BASE"]?.trim() || "https://api.paymongo.com").replace(/\/$/, ""),
    webhookToleranceSeconds: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 300,
  });
}

export async function createManagedPayMongoFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PayMongoPort> {
  const client = createPayMongoFromEnv(env);
  if (env["PAYMONGO_MANAGED_WEBHOOK"] !== "1" || !(client instanceof PayMongoHttpClient)) {
    return client;
  }
  const baseUrl = (
    env["PAYMONGO_WEBHOOK_URL"]?.trim()
    || env["RENDER_EXTERNAL_URL"]?.trim()
    || ""
  ).replace(/\/$/, "");
  if (!baseUrl) throw new Error("PAYMONGO_WEBHOOK_URL_REQUIRED");
  const webhookUrl = baseUrl.endsWith("/api/v1/payments/paymongo/webhook")
    ? baseUrl
    : `${baseUrl}/api/v1/payments/paymongo/webhook`;
  await client.ensureWebhook(webhookUrl);
  return client;
}

export function payMongoModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): "test" | "live" | "disabled" | "unknown" {
  const secretKey = env["PAYMONGO_SECRET_KEY"]?.trim() ?? "";
  if (!secretKey) return "disabled";
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return "unknown";
}

export async function listPayMongoWebhookDiagnosticsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Array<{
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  events: string[];
}>> {
  const secretKey = env["PAYMONGO_SECRET_KEY"]?.trim() ?? "";
  if (!secretKey) return [];
  const apiBase = (env["PAYMONGO_API_BASE"]?.trim() || "https://api.paymongo.com").replace(/\/$/, "");
  const response = await fetch(`${apiBase}/v1/webhooks`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) throw new Error("PAYMONGO_WEBHOOK_DIAGNOSTIC_FAILED");
  const body = await response.json() as {
    data?: Array<{
      id?: unknown;
      attributes?: {
        url?: unknown;
        status?: unknown;
        livemode?: unknown;
        events?: unknown;
      };
    }>;
  };
  return (body.data ?? []).flatMap((entry) => {
    const attrs = entry.attributes;
    if (
      typeof entry.id !== "string" ||
      typeof attrs?.url !== "string" ||
      typeof attrs.status !== "string" ||
      typeof attrs.livemode !== "boolean" ||
      !Array.isArray(attrs.events)
    ) {
      return [];
    }
    return [{
      id: entry.id,
      url: attrs.url,
      status: attrs.status,
      livemode: attrs.livemode,
      events: attrs.events.filter((event): event is string => typeof event === "string"),
    }];
  });
}

export async function listPayMongoPaymentMethodCapabilitiesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const secretKey = env["PAYMONGO_SECRET_KEY"]?.trim() ?? "";
  if (!secretKey) return [];
  const apiBase = (env["PAYMONGO_API_BASE"]?.trim() || "https://api.paymongo.com").replace(/\/$/, "");
  const response = await fetch(`${apiBase}/v1/merchants/capabilities/payment_methods`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) throw new Error("PAYMONGO_CAPABILITY_DIAGNOSTIC_FAILED");
  const body = await response.json() as { data?: unknown };
  return Array.isArray(body.data)
    ? body.data.filter((entry): entry is string => typeof entry === "string")
    : [];
}
