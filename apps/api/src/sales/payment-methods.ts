import type { DbPort } from "../common/db.port";

export const DEFAULT_PAYMENT_METHODS: Array<{ key: string; label: string }> = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
  { key: "qrph", label: "QR Ph" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "gift_card", label: "Gift card" },
  { key: "store_credit", label: "Store credit" },
  { key: "loyalty", label: "Loyalty" },
  { key: "other", label: "Other" },
];

const LEGACY_DEFAULT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "other", label: "Other" },
];

function isLegacyDefaultList(
  methods: Array<{ key: string; label: string }>,
): boolean {
  return methods.length === LEGACY_DEFAULT_METHODS.length &&
    methods.every((method, index) => {
      const legacy = LEGACY_DEFAULT_METHODS[index];
      return method.key === legacy?.key && method.label === legacy.label;
    });
}

// FR-PAY-01: payment methods are business configuration, not hard-coded UI
// branches. A business without the setting gets the plan's initial six.
export async function resolvePaymentMethods(
  db: DbPort,
  businessId: string,
): Promise<Array<{ key: string; label: string }>> {
  const settings = await db.getSettings(businessId);
  const raw = settings["paymentMethods"];
  if (Array.isArray(raw) && raw.length > 0) {
    const configured = raw as Array<{ key: string; label: string }>;
    // Existing tenants seeded before QR Ph was added should inherit the new
    // default without overriding businesses that intentionally customized
    // their payment method list.
    if (isLegacyDefaultList(configured)) return DEFAULT_PAYMENT_METHODS;
    return configured;
  }
  return DEFAULT_PAYMENT_METHODS;
}
