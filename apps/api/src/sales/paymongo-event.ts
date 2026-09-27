import { createHash } from "node:crypto";

import { isPayMongoMethod, type PayMongoMethod } from "../payments/paymongo";

export interface PayMongoPaidEvent {
  eventId: string;
  type: "checkout_session.payment.paid";
  businessId: string;
  saleId: string;
  checkoutSessionId: string;
  method: PayMongoMethod;
  sourceType: "card" | "gcash" | "paymaya" | "qrph";
  amountMinor: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parsePayMongoPaidEvent(payload: unknown, rawBody: string): PayMongoPaidEvent | null {
  const root = asRecord(payload);
  if (!root) throw new Error("VALIDATION");
  const topData = asRecord(root["data"]);
  if (!topData) throw new Error("VALIDATION");

  const genericAttrs = asRecord(topData["attributes"]);
  const genericType = typeof genericAttrs?.["type"] === "string" ? genericAttrs["type"] : null;
  const hostedType = typeof topData["type"] === "string" ? topData["type"] : null;
  const type = genericType ?? hostedType;
  if (type !== "checkout_session.payment.paid") return null;

  const session = genericType
    ? asRecord(genericAttrs?.["data"])
    : asRecord(topData["data"]);
  if (!session) throw new Error("VALIDATION");
  const attrs = asRecord(session["attributes"]);
  if (!attrs) throw new Error("VALIDATION");
  const metadata = asRecord(attrs["metadata"]);
  const businessId = metadata?.["businessId"];
  const metadataSaleId = metadata?.["saleId"];
  const referenceNumber = attrs["reference_number"];
  const rawMethod = metadata?.["method"];
  const sessionId = session["id"];
  if (
    typeof businessId !== "string" ||
    typeof sessionId !== "string" ||
    typeof rawMethod !== "string" ||
    !isPayMongoMethod(rawMethod)
  ) {
    throw new Error("VALIDATION");
  }
  const saleId = typeof metadataSaleId === "string"
    ? metadataSaleId
    : typeof referenceNumber === "string" ? referenceNumber : null;
  if (!saleId || (typeof referenceNumber === "string" && referenceNumber !== saleId)) {
    throw new Error("PAYMENT_PROVIDER_MISMATCH");
  }
  const payments = Array.isArray(attrs["payments"]) ? attrs["payments"] : [];
  const paid = payments
    .map(asRecord)
    .filter((payment): payment is Record<string, unknown> => payment !== null)
    .find((payment) => asRecord(payment["attributes"])?.["status"] === "paid");
  const paidAttrs = paid ? asRecord(paid["attributes"]) : null;
  const source = paidAttrs ? asRecord(paidAttrs["source"]) : null;
  const sourceType = source?.["type"];
  const amount = paidAttrs?.["amount"];
  if (
    typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 ||
    (sourceType !== "card" && sourceType !== "gcash" && sourceType !== "paymaya" && sourceType !== "qrph")
  ) {
    throw new Error("PAYMENT_PROVIDER_INVALID_RESPONSE");
  }
  const explicitEventId = topData["id"];
  const eventId = typeof explicitEventId === "string" && explicitEventId.length > 0
    ? explicitEventId
    : `evt_sha256_${createHash("sha256").update(rawBody).digest("hex")}`;
  return {
    eventId,
    type,
    businessId,
    saleId,
    checkoutSessionId: sessionId,
    method: rawMethod,
    sourceType,
    amountMinor: amount,
  };
}
