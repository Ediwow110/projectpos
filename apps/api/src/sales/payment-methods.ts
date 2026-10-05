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

const HISTORICAL_DEFAULTS = [
  [
    { key: "cash", label: "Cash" },
    { key: "card", label: "Card" },
    { key: "gcash", label: "GCash" },
    { key: "maya", label: "Maya" },
    { key: "bank_transfer", label: "Bank transfer" },
    { key: "other", label: "Other" },
  ],
  [
    { key: "cash", label: "Cash" },
    { key: "card", label: "Card" },
    { key: "gcash", label: "GCash" },
    { key: "maya", label: "Maya" },
    { key: "qrph", label: "QR Ph" },
    { key: "bank_transfer", label: "Bank transfer" },
    { key: "other", label: "Other" },
  ],
];

const HISTORICAL_DEFAULT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
  { key: "qrph", label: "QR Ph" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "other", label: "Other" },
];

function isExactMethodList(
  methods: Array<{ key: string; label: string }>,
  expected: Array<{ key: string; label: string }>,
): boolean {
  return methods.length === expected.length &&
    methods.every((method, index) => {
      const configured = expected[index];
      return method.key === configured?.key && method.label === configured.label;
    });
}

function isPrePhase20DefaultList(
  methods: Array<{ key: string; label: string }>,
): boolean {
  return isExactMethodList(methods, LEGACY_DEFAULT_METHODS) ||
    isExactMethodList(methods, HISTORICAL_DEFAULT_METHODS);
}

// FR-PAY-01: payment methods are business configuration, not hard-coded UI
// branches. Existing pre-Phase20 default lists inherit the current defaults;
// genuinely customized lists remain unchanged.
export async function resolvePaymentMethods(
  db: DbPort,
  businessId: string,
): Promise<Array<{ key: string; label: string }>> {
  const settings = await db.getSettings(businessId);
  const raw = settings["paymentMethods"];
  if (Array.isArray(raw) && raw.length > 0) {
    const configured = raw as Array<{ key: string; label: string }>;
    if (isPrePhase20DefaultList(configured)) return DEFAULT_PAYMENT_METHODS;
    return configured;
  }
  return DEFAULT_PAYMENT_METHODS;
}
