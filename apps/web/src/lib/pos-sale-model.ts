export interface PosProduct {
  id: string;
  name: string;
  imageUrl?: string | null;
  sku: string | null;
  barcode?: string | null;
  categoryId: string | null;
  productType?: "STANDARD" | "BUNDLE";
  priceMinor: number;
  isActive: boolean;
}

export interface PosCartEntry {
  productId: string;
  name: string;
  imageUrl?: string | null;
  priceMinor: number;
  qty: number;
  lineDiscountMinor: number;
}

export interface PosHeldSaleItem {
  position: number;
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
  lineDiscountMinor: number;
}

export interface PosHeldSale {
  heldId: string;
  sale: {
    id: string;
    status: string;
    createdAt: string;
    registerId: string | null;
    branchId: string | null;
    customerId: string | null;
    customerName: string | null;
    discountMinor: number;
    totalMinor: number;
    items: PosHeldSaleItem[];
  };
}

export interface PosDraftInput {
  lines: Array<{ productId: string; qty: number; lineDiscountMinor: number }>;
  orderDiscountMinor: number;
  registerId?: string;
  customerId?: string;
  customerName?: string;
  approvalToken?: string;
  giftCardLoad?: PosGiftCardLoadDraft;
}

export type PosGiftCardLoad =
  | { kind: "NEW"; amountMinor: number }
  | { kind: "RELOAD"; amountMinor: number; giftCardId: string; maskedCode: string; previousBalanceMinor: number; status: string };

export type PosGiftCardLoadDraft =
  | { kind: "NEW"; amountMinor: number }
  | { kind: "RELOAD"; amountMinor: number; giftCardId: string };

export interface PosDiscountSummary {
  grossMinor: number;
  lineDiscountMinor: number;
  subtotalMinor: number;
  orderDiscountMinor: number;
  totalDiscountMinor: number;
  totalMinor: number;
}

const PAYMONGO_METHODS = new Set(["card", "gcash", "maya", "qrph"]);

export function isPayMongoMethodKey(key: string): boolean {
  return PAYMONGO_METHODS.has(key);
}

export function resolveTenderedMinor(received: string, dueMinor: number): number {
  return received.trim() === "" ? dueMinor : Math.round(Number(received) * 100);
}

export function buildDraftSaleInput(
  cart: PosCartEntry[],
  registerId: string,
  customerId: string,
  walkIn: string,
  orderDiscountMinor = 0,
  approvalToken?: string,
  giftCardLoad?: PosGiftCardLoad,
): PosDraftInput {
  return {
    lines: cart.map((entry) => ({
      productId: entry.productId,
      qty: entry.qty,
      lineDiscountMinor: Math.min(Math.max(0, entry.lineDiscountMinor), entry.qty * entry.priceMinor),
    })),
    orderDiscountMinor: Math.max(0, Math.round(orderDiscountMinor)),
    ...(registerId !== "" ? { registerId } : {}),
    ...(customerId !== "" ? { customerId } : {}),
    ...(customerId === "" && walkIn.trim() !== "" ? { customerName: walkIn.trim() } : {}),
    ...(approvalToken?.trim() ? { approvalToken: approvalToken.trim() } : {}),
    ...(giftCardLoad ? {
      giftCardLoad: giftCardLoad.kind === "NEW"
        ? { amountMinor: Math.max(0, Math.round(giftCardLoad.amountMinor)), kind: "NEW" as const }
        : { amountMinor: Math.max(0, Math.round(giftCardLoad.amountMinor)), kind: "RELOAD" as const, giftCardId: giftCardLoad.giftCardId },
    } : {}),
  };
}

export function parseMajorCurrencyToMinor(value: string): number | null {
  const normalized = value.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export function buildOfflineSalePayload(
  cart: PosCartEntry[],
  registerId: string,
  customerId: string,
  walkIn: string,
  tenderedMinor: number,
  orderDiscountMinor = 0,
): PosDraftInput & { payments: Array<{ method: "cash"; amountMinor: number }> } {
  return {
    ...buildDraftSaleInput(cart, registerId, customerId, walkIn, orderDiscountMinor),
    payments: [{ method: "cash", amountMinor: tenderedMinor }],
  };
}

export function addProductToCart(cart: PosCartEntry[], product: PosProduct, quantity = 1): PosCartEntry[] {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return cart;
  const existing = cart.find((entry) => entry.productId === product.id);
  if (existing) {
    if (!Number.isSafeInteger(existing.qty + quantity) || existing.qty + quantity > 999) return cart;
    return cart.map((entry) => entry.productId === product.id ? { ...entry, qty: entry.qty + quantity } : entry);
  }
  return [
    ...cart,
    { productId: product.id, name: product.name, ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}), priceMinor: product.priceMinor, qty: quantity, lineDiscountMinor: 0 },
  ];
}

export function changeCartQuantity(cart: PosCartEntry[], productId: string, delta: number): PosCartEntry[] {
  return cart
    .map((entry) => {
      if (entry.productId !== productId) return entry;
      const qty = entry.qty + delta;
      return {
        ...entry,
        qty,
        lineDiscountMinor: Math.min(entry.lineDiscountMinor, Math.max(0, qty) * entry.priceMinor),
      };
    })
    .filter((entry) => entry.qty > 0);
}

export function applyCartDiscounts(cart: PosCartEntry[], byProductId: Record<string, number>): PosCartEntry[] {
  return cart.map((entry) => ({
    ...entry,
    lineDiscountMinor: Math.min(
      Math.max(0, Math.round(byProductId[entry.productId] ?? entry.lineDiscountMinor)),
      entry.qty * entry.priceMinor,
    ),
  }));
}

export function posDiscountSummary(cart: PosCartEntry[], orderDiscountMinor: number): PosDiscountSummary {
  let grossMinor = 0;
  let lineDiscountMinor = 0;
  for (const entry of cart) {
    const gross = entry.qty * entry.priceMinor;
    const discount = Math.min(Math.max(0, entry.lineDiscountMinor), gross);
    grossMinor += gross;
    lineDiscountMinor += discount;
  }
  const subtotalMinor = Math.max(0, grossMinor - lineDiscountMinor);
  const effectiveOrderDiscount = Math.min(Math.max(0, Math.round(orderDiscountMinor)), subtotalMinor);
  return {
    grossMinor,
    lineDiscountMinor,
    subtotalMinor,
    orderDiscountMinor: effectiveOrderDiscount,
    totalDiscountMinor: lineDiscountMinor + effectiveOrderDiscount,
    totalMinor: Math.max(0, subtotalMinor - effectiveOrderDiscount),
  };
}

export function heldSaleToCart(sale: Pick<PosHeldSale["sale"], "items">): PosCartEntry[] {
  return [...sale.items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      productId: item.productId,
      name: item.name,
      priceMinor: item.priceMinor,
      qty: item.qty,
      lineDiscountMinor: item.lineDiscountMinor,
    }));
}

export function filterOfflineCatalog(products: PosProduct[], query: string, categoryId: string): PosProduct[] {
  const needle = query.trim().toLowerCase();
  return products.filter(
    (product) =>
      (categoryId === "" || product.categoryId === categoryId) &&
      (
        needle === "" ||
        product.name.toLowerCase().includes(needle) ||
        (product.sku ?? "").toLowerCase().includes(needle) ||
        (product.barcode ?? "").toLowerCase().includes(needle)
      ),
  );
}
