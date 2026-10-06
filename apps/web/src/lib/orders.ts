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

export type StaffOrderStatus =
  | "DRAFT"
  | "CHECKOUT"
  | "SUBMITTED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED";

export type StaffFulfillmentStatus =
  | "PENDING"
  | "READY"
  | "PACKED"
  | "DISPATCHED"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "COLLECTED"
  | "CANCELLED";

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

export function buildOrderListPath(input: {
  limit: number;
  status?: StaffOrderStatus;
  channel?: "POS" | "WEB";
  fulfillmentMode?: "NONE" | PublicFulfillmentMode;
  branchId?: string;
  paymentStatus?: PublicPaymentStatus;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
}): string {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("VALIDATION");
  const query = new URLSearchParams();
  query.set("limit", String(input.limit));
  if (input.status) query.set("status", input.status);
  if (input.channel) query.set("channel", input.channel);
  if (input.fulfillmentMode) query.set("fulfillmentMode", input.fulfillmentMode);
  if (input.branchId) query.set("branchId", input.branchId);
  if (input.paymentStatus) query.set("paymentStatus", input.paymentStatus);
  if (input.dateFrom) query.set("dateFrom", input.dateFrom);
  if (input.dateTo) query.set("dateTo", input.dateTo);
  if (input.cursor) query.set("cursor", input.cursor);
  return "/api/v1/orders?" + query.toString();
}

function pesosToMinor(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("VALIDATION");
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("VALIDATION");
  return minor;
}

export function onlineOrderingSettingsPayload(input: {
  enabled: boolean;
  pickupBranchIds: string[];
  deliveryBranchId: string | null;
  deliveryFeePesos: string;
}): {
  onlineOrderingEnabled: boolean;
  onlinePickupBranchIds: string[];
  onlineFulfillmentBranchId: string | null;
  deliveryFlatFeeMinor: number;
} {
  const deliveryFlatFeeMinor = pesosToMinor(input.deliveryFeePesos);
  return {
    onlineOrderingEnabled: input.enabled,
    onlinePickupBranchIds: [...new Set(input.pickupBranchIds.filter(Boolean))],
    onlineFulfillmentBranchId: input.deliveryBranchId || null,
    deliveryFlatFeeMinor,
  };
}

export interface OrderCapabilities {
  view: boolean;
  settings: boolean;
  accept: boolean;
  cancel: boolean;
  fulfill: boolean;
  collect: boolean;
  viewDelivery: boolean;
  linkCustomer: boolean;
  manageAccess: boolean;
}

const NO_ORDER_CAPABILITIES: OrderCapabilities = {
  view: false,
  settings: false,
  accept: false,
  cancel: false,
  fulfill: false,
  collect: false,
  viewDelivery: false,
  linkCustomer: false,
  manageAccess: false,
};

export function orderCapabilitiesForRole(role?: string): OrderCapabilities {
  if (role === "owner") {
    return {
      view: true,
      settings: true,
      accept: true,
      cancel: true,
      fulfill: true,
      collect: true,
      viewDelivery: true,
      linkCustomer: true,
      manageAccess: true,
    };
  }
  if (role === "manager") {
    return {
      view: true,
      settings: false,
      accept: true,
      cancel: true,
      fulfill: true,
      collect: true,
      viewDelivery: true,
      linkCustomer: true,
      manageAccess: true,
    };
  }
  if (role === "cashier") {
    return {
      view: true,
      settings: false,
      accept: true,
      cancel: false,
      fulfill: false,
      collect: true,
      viewDelivery: false,
      linkCustomer: false,
      manageAccess: false,
    };
  }
  if (role === "inventory") {
    return {
      view: true,
      settings: false,
      accept: false,
      cancel: false,
      fulfill: true,
      collect: false,
      viewDelivery: true,
      linkCustomer: false,
      manageAccess: false,
    };
  }
  return { ...NO_ORDER_CAPABILITIES };
}

export type StaffOrderAction =
  | "accept"
  | "reject"
  | "cancel"
  | "assign"
  | "ready"
  | "pack"
  | "dispatch"
  | "deliver"
  | "fail"
  | "collect"
  | "resend-access"
  | "revoke-access";

export function orderDetailActions(input: {
  role?: string;
  orderStatus: StaffOrderStatus;
  paymentMode: "POS" | PublicPaymentMode;
  fulfillment: { type: "PICKUP" | "DELIVERY"; status: StaffFulfillmentStatus } | null;
}): StaffOrderAction[] {
  const caps = orderCapabilitiesForRole(input.role);
  const actions: StaffOrderAction[] = [];
  if (input.orderStatus === "SUBMITTED") {
    if (caps.accept && input.paymentMode === "PAY_AT_PICKUP") actions.push("accept");
    if (caps.cancel) actions.push("reject");
  }
  if (input.orderStatus === "CONFIRMED" && input.fulfillment) {
    const row = input.fulfillment;
    if (caps.fulfill && !["DELIVERED", "COLLECTED", "CANCELLED"].includes(row.status)) actions.push("assign");
    if (caps.fulfill && row.type === "PICKUP" && row.status === "PENDING") actions.push("ready");
    if (caps.fulfill && row.type === "DELIVERY" && row.status === "PENDING") actions.push("pack");
    if (caps.fulfill && row.type === "DELIVERY" && ["PACKED", "DELIVERY_FAILED"].includes(row.status)) actions.push("dispatch");
    if (caps.fulfill && row.type === "DELIVERY" && row.status === "DISPATCHED") actions.push("deliver", "fail");
    if (caps.collect && row.type === "PICKUP" && row.status === "READY") actions.push("collect");
    if (caps.cancel && !["DELIVERED", "COLLECTED"].includes(row.status)) actions.push("cancel");
  } else if (input.orderStatus === "CONFIRMED" && caps.cancel) {
    actions.push("cancel");
  }
  if (caps.manageAccess && ["SUBMITTED", "CONFIRMED", "COMPLETED"].includes(input.orderStatus)) {
    actions.push("resend-access", "revoke-access");
  }
  return actions;
}

export function isAgedOperationalHold(
  reservation: { status: string; expiresAt: string | null; createdAt: string },
  now: Date = new Date(),
  thresholdMs = 24 * 60 * 60 * 1000,
): boolean {
  if (reservation.status !== "HELD" || reservation.expiresAt !== null) return false;
  const createdAt = new Date(reservation.createdAt);
  if (Number.isNaN(createdAt.getTime())) return false;
  return now.getTime() - createdAt.getTime() >= thresholdMs;
}
