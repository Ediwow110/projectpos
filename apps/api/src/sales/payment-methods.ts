import type { DbPort } from "../common/db.port";

export const DEFAULT_PAYMENT_METHODS: Array<{ key: string; label: string }> = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "other", label: "Other" },
];

// FR-PAY-01: payment methods are business configuration, not hard-coded UI
// branches. A business without the setting gets the plan's initial six.
export async function resolvePaymentMethods(
  db: DbPort,
  businessId: string,
): Promise<Array<{ key: string; label: string }>> {
  const settings = await db.getSettings(businessId);
  const raw = settings["paymentMethods"];
  if (Array.isArray(raw) && raw.length > 0) {
    return raw as Array<{ key: string; label: string }>;
  }
  return DEFAULT_PAYMENT_METHODS;
}
