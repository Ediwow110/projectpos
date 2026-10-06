export type PublicFulfillmentMode = "PICKUP" | "DELIVERY";
export type PublicPaymentMode = "PREPAID" | "PAY_AT_PICKUP";
export type PublicPaymentMethod = "card" | "gcash" | "maya" | "qrph";
export type PublicPaymentStatus =
  | "UNPAID"
  | "PENDING"
  | "UNKNOWN"
  | "FAILED"
  | "PAID"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export interface PublicStorefront {
  name: string;
  currency: string;
  pickupBranches: Array<{ id: string; name: string }>;
  deliveryAvailable: boolean;
  deliveryBranch: { id: string; name: string } | null;
  deliveryFlatFeeMinor: number;
  taxRateBps: number | null;
  taxName: string | null;
}

export interface PublicCatalogItem {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string | null;
  brand: string | null;
  unit: string;
  priceMinor: number;
  taxRateBps: number | null;
  imageUrl: string | null;
  productType: string;
  availableToSell: number | null;
}

export interface PublicCatalogResponse {
  items: PublicCatalogItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CartLine {
  productId: string;
  qty: number;
}

export interface OrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  deliveryTaxMinor: number;
  totalMinor: number;
}

export interface PublicOrderStatus extends OrderTotals {
  id: string;
  status: "DRAFT" | "CHECKOUT" | "SUBMITTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REJECTED";
  paymentStatus: PublicPaymentStatus;
  fulfillmentMode: "NONE" | PublicFulfillmentMode;
  paymentMode: "POS" | PublicPaymentMode;
  currency: string;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  lines: Array<{
    id: string;
    name: string;
    unit: string;
    qty: number;
    priceMinor: number;
    discountMinor: number;
    taxMinor: number;
    lineTotalMinor: number;
  }>;
  fulfillments: Array<{
    id: string;
    type: "PICKUP" | "DELIVERY";
    status: string;
    readyAt: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    collectedAt: string | null;
  }>;
}

export function validatePublicCheckout(input: {
  branchId: string;
  fulfillmentMode: PublicFulfillmentMode;
  paymentMode: PublicPaymentMode;
  paymentMethod: PublicPaymentMethod | null;
  deliveryAddressComplete: boolean;
  catalogReady?: boolean;
}): string[] {
  const errors: string[] = [];
  if (!input.branchId) errors.push("Choose a store location.");
  if (input.catalogReady === false) errors.push("Wait for product availability to finish loading.");
  if (input.fulfillmentMode === "DELIVERY" && input.paymentMode !== "PREPAID") {
    errors.push("Delivery requires prepaid payment.");
  }
  if (input.fulfillmentMode === "DELIVERY" && !input.deliveryAddressComplete) {
    errors.push("Enter a complete delivery address.");
  }
  if (input.paymentMode === "PREPAID" && !input.paymentMethod) {
    errors.push("Choose a payment method.");
  }
  return errors;
}

export function reconcileCartForCatalog(
  cart: CartLine[],
  catalog: Array<Pick<PublicCatalogItem, "id" | "availableToSell">>,
): { lines: CartLine[]; adjustedProductIds: string[] } {
  const availability = new Map(catalog.map((item) => [item.id, item.availableToSell]));
  const adjustedProductIds: string[] = [];
  const lines: CartLine[] = [];
  for (const line of cart) {
    if (!availability.has(line.productId)) {
      adjustedProductIds.push(line.productId);
      continue;
    }
    const available = availability.get(line.productId) ?? null;
    if (available === null) {
      lines.push(line);
      continue;
    }
    const qty = Math.max(0, Math.min(line.qty, Math.floor(available)));
    if (qty !== line.qty) adjustedProductIds.push(line.productId);
    if (qty > 0) lines.push({ ...line, qty });
  }
  return { lines, adjustedProductIds };
}

export function replaceWithServerTotals(_current: OrderTotals, server: OrderTotals): OrderTotals {
  return { ...server };
}

export function paymentStatusCopy(status: PublicPaymentStatus): string {
  switch (status) {
    case "FAILED":
      return "Payment failed. You can retry from the secure checkout flow.";
    case "UNKNOWN":
      return "Payment is still being confirmed. Do not pay again while confirmation is pending.";
    case "PENDING":
      return "Payment is being processed.";
    case "PAID":
      return "Payment confirmed.";
    case "PARTIALLY_REFUNDED":
      return "Payment partially refunded.";
    case "REFUNDED":
      return "Payment refunded.";
    case "UNPAID":
      return "Payment has not been collected yet.";
  }
}

export function storefrontErrorMessage(code: string): string {
  return code === "NOT_FOUND"
    ? "Online ordering is not available for this store."
    : "Could not load this storefront. Try again.";
}

export function formatOrderMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(minor / 100);
}

export function newOrderIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "order-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}
