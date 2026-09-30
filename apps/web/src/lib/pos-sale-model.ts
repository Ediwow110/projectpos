export interface PosProduct {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  priceMinor: number;
  isActive: boolean;
}

export interface PosCartEntry {
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
}

export interface PosHeldSaleItem {
  position: number;
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
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
    totalMinor: number;
    items: PosHeldSaleItem[];
  };
}

export interface PosDraftInput {
  lines: Array<{ productId: string; qty: number }>;
  registerId?: string;
  customerId?: string;
  customerName?: string;
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
): PosDraftInput {
  return {
    lines: cart.map((entry) => ({ productId: entry.productId, qty: entry.qty })),
    ...(registerId !== "" ? { registerId } : {}),
    ...(customerId !== "" ? { customerId } : {}),
    ...(customerId === "" && walkIn.trim() !== "" ? { customerName: walkIn.trim() } : {}),
  };
}

export function buildOfflineSalePayload(
  cart: PosCartEntry[],
  registerId: string,
  customerId: string,
  walkIn: string,
  tenderedMinor: number,
): PosDraftInput & { payments: Array<{ method: "cash"; amountMinor: number }> } {
  return {
    ...buildDraftSaleInput(cart, registerId, customerId, walkIn),
    payments: [{ method: "cash", amountMinor: tenderedMinor }],
  };
}

export function addProductToCart(cart: PosCartEntry[], product: PosProduct): PosCartEntry[] {
  const existing = cart.find((entry) => entry.productId === product.id);
  if (existing) {
    return cart.map((entry) => entry.productId === product.id ? { ...entry, qty: entry.qty + 1 } : entry);
  }
  return [
    ...cart,
    { productId: product.id, name: product.name, priceMinor: product.priceMinor, qty: 1 },
  ];
}

export function changeCartQuantity(cart: PosCartEntry[], productId: string, delta: number): PosCartEntry[] {
  return cart
    .map((entry) => entry.productId === productId ? { ...entry, qty: entry.qty + delta } : entry)
    .filter((entry) => entry.qty > 0);
}

export function heldSaleToCart(sale: Pick<PosHeldSale["sale"], "items">): PosCartEntry[] {
  return [...sale.items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      productId: item.productId,
      name: item.name,
      priceMinor: item.priceMinor,
      qty: item.qty,
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
        (product.sku ?? "").toLowerCase().includes(needle)
      ),
  );
}
