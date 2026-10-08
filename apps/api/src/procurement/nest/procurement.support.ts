import type {
  DbBranch,
  DbPort,
  DbProduct,
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbPurchaseReceipt,
  DbPurchaseReceiptLine,
  DbSupplier,
  DbSupplierReturn,
  DbSupplierReturnLine,
} from "../../common/db.port";

import type { PurchaseOrderLineInput, PurchaseOrderWithLines, PurchaseReceiptWithLines, SupplierReturnWithLines } from "./procurement.contracts";

export class ProcurementSupport {
  constructor(protected readonly db: DbPort) {}

  protected requireGrant(granted: string[], permission: string): void {
    if (!granted.includes(permission)) throw new Error("FORBIDDEN");
  }

  protected async requireSupplier(businessId: string, supplierId: string): Promise<DbSupplier> {
    const supplier = await this.db.findSupplierById(supplierId, businessId);
    if (!supplier) throw new Error("NOT_FOUND");
    return supplier;
  }

  protected async requireProduct(businessId: string, productId: string): Promise<DbProduct> {
    const product = await this.db.findProductById(productId, businessId);
    if (!product) throw new Error("NOT_FOUND");
    return product;
  }

  protected async requireBranch(businessId: string, branchId: string | null): Promise<DbBranch | null> {
    if (branchId === null) return null;
    const branch = await this.db.findBranchById(branchId, businessId);
    if (!branch || !branch.isActive) throw new Error("VALIDATION");
    return branch;
  }

  protected async embed(order: DbPurchaseOrder): Promise<PurchaseOrderWithLines> {
    return { ...order, lines: await this.db.listPurchaseOrderLines(order.id, order.businessId) };
  }

  protected async requireOrder(businessId: string, id: string): Promise<DbPurchaseOrder> {
    const order = await this.db.findPurchaseOrderById(id, businessId);
    if (!order) throw new Error("NOT_FOUND");
    return order;
  }

  protected async assertSupplierCodeAvailable(businessId: string, code: string | null, ignoreId?: string): Promise<void> {
    if (!code) return;
    const duplicate = (await this.db.listSuppliersByBusiness(businessId)).find(
      (supplier) => supplier.id !== ignoreId && supplier.code?.toUpperCase() === code,
    );
    if (duplicate) throw new Error("SUPPLIER_CODE_DUPLICATE");
  }

  protected async resolveOrderLines(
    businessId: string,
    supplierId: string,
    input: PurchaseOrderLineInput[],
  ): Promise<DbPurchaseOrderLine[]> {
    const mappings = await this.db.listProductSuppliersByBusiness(businessId);
    const lines: DbPurchaseOrderLine[] = [];
    const seen = new Set<string>();
    for (let position = 0; position < input.length; position += 1) {
      const item = input[position]!;
      if (seen.has(item.productId)) throw new Error("VALIDATION");
      seen.add(item.productId);
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error("VALIDATION");
      if (item.unitCostMinor !== undefined && (!Number.isInteger(item.unitCostMinor) || item.unitCostMinor < 0)) {
        throw new Error("VALIDATION");
      }
      const product = await this.requireProduct(businessId, item.productId);
      if (product.productType === "BUNDLE") throw new Error("PRODUCT_NOT_TRACKED");
      const mapping = mappings.find((row) => row.productId === product.id && row.supplierId === supplierId);
      const unitCostMinor = item.unitCostMinor ?? mapping?.unitCostMinor ?? product.costMinor ?? 0;
      const lineTotalMinor = item.quantity * unitCostMinor;
      if (!Number.isSafeInteger(lineTotalMinor)) throw new Error("VALIDATION");
      lines.push({
        id: "",
        businessId,
        purchaseOrderId: "",
        productId: product.id,
        position,
        supplierSkuSnapshot: mapping?.supplierSku ?? null,
        productNameSnapshot: product.name,
        quantity: item.quantity,
        unitCostMinor,
        lineTotalMinor,
        notes: item.notes?.trim() || null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    }
    return lines;
  }

  protected async embedFull(order: DbPurchaseOrder): Promise<PurchaseOrderWithLines> {
    const [base, receipts, returns] = await Promise.all([
      this.embed(order),
      this.listReceiptDetails(order.id, order.businessId),
      this.listReturnDetails(order.id, order.businessId),
    ]);
    return { ...base, receipts, supplierReturns: returns };
  }

  protected async listReceiptDetails(purchaseOrderId: string, businessId: string): Promise<PurchaseReceiptWithLines[]> {
    const receipts = await this.db.listPurchaseReceiptsByOrder(purchaseOrderId, businessId);
    return Promise.all(receipts.map(async (receipt) => ({ receipt, lines: await this.db.listPurchaseReceiptLines(receipt.id, businessId) }))).then((rows) => rows.map(({ receipt, lines }) => ({ ...receipt, lines })));
  }

  protected async listReturnDetails(purchaseOrderId: string, businessId: string): Promise<SupplierReturnWithLines[]> {
    const returns = await this.db.listSupplierReturnsByOrder(purchaseOrderId, businessId);
    return Promise.all(returns.map(async (item) => ({ item, lines: await this.db.listSupplierReturnLines(item.id, businessId) }))).then((rows) => rows.map(({ item, lines }) => ({ ...item, lines })));
  }

  protected async requireReceipt(businessId: string, id: string): Promise<DbPurchaseReceipt> {
    const row = await this.db.findPurchaseReceiptById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  }

  protected async requireSupplierReturn(businessId: string, id: string): Promise<DbSupplierReturn> {
    const row = await this.db.findSupplierReturnById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  }

  protected async receivedByLine(businessId: string, orderId: string, db: DbPort = this.db): Promise<Map<string, number>> {
    const receipts = await db.listPurchaseReceiptsByOrder(orderId, businessId);
    const totals = new Map<string, number>();
    for (const receipt of receipts) {
      for (const line of await db.listPurchaseReceiptLines(receipt.id, businessId)) totals.set(line.purchaseOrderLineId, (totals.get(line.purchaseOrderLineId) ?? 0) + line.quantityReceived);
    }
    return totals;
  }

  protected async returnedByLine(businessId: string, orderId: string, db: DbPort = this.db): Promise<Map<string, number>> {
    const returns = await db.listSupplierReturnsByOrder(orderId, businessId);
    const totals = new Map<string, number>();
    for (const item of returns) {
      if (item.status !== "POSTED") continue;
      for (const line of await db.listSupplierReturnLines(item.id, businessId)) totals.set(line.purchaseOrderLineId, (totals.get(line.purchaseOrderLineId) ?? 0) + line.quantity);
    }
    return totals;
  }

  protected async receiptLines(businessId: string, order: DbPurchaseOrder, input: { branchId?: string | null; lines: Array<{ purchaseOrderLineId: string; quantityReceived: number }>; notes?: string }, db: DbPort = this.db): Promise<Array<{ source: DbPurchaseOrderLine; quantityReceived: number }>> {
    if (input.branchId !== undefined && (input.branchId ?? null) !== order.branchId) throw new Error("VALIDATION");
    if (order.status !== "ORDERED" && order.status !== "PARTIALLY_RECEIVED") throw new Error("PURCHASE_ORDER_INVALID_STATE");
    const lines = await db.listPurchaseOrderLines(order.id, businessId);
    const byId = new Map(lines.map((line) => [line.id, line]));
    const received = await this.receivedByLine(businessId, order.id, db);
    const seen = new Set<string>();
    const resolved: Array<{ source: DbPurchaseOrderLine; quantityReceived: number }> = [];
    for (const item of input.lines) {
      if (seen.has(item.purchaseOrderLineId)) throw new Error("VALIDATION");
      seen.add(item.purchaseOrderLineId);
      const source = byId.get(item.purchaseOrderLineId);
      if (!source || !Number.isInteger(item.quantityReceived) || item.quantityReceived <= 0) throw new Error("VALIDATION");
      const remaining = source.quantity - (received.get(source.id) ?? 0);
      if (item.quantityReceived > remaining) throw new Error("RECEIPT_EXCEEDS_OUTSTANDING");
      resolved.push({ source, quantityReceived: item.quantityReceived });
    }
    if (!resolved.length) throw new Error("VALIDATION");
    return resolved;
  }

  protected async resolveReturnLines(businessId: string, order: DbPurchaseOrder, input: Array<{ purchaseOrderLineId: string; quantity: number }>, db: DbPort = this.db): Promise<Array<{ source: DbPurchaseOrderLine; quantity: number }>> {
    const received = await this.receivedByLine(businessId, order.id, db);
    const returned = await this.returnedByLine(businessId, order.id, db);
    const byId = new Map((await db.listPurchaseOrderLines(order.id, businessId)).map((line) => [line.id, line]));
    const seen = new Set<string>(); const resolved: Array<{ source: DbPurchaseOrderLine; quantity: number }> = [];
    for (const item of input) {
      if (seen.has(item.purchaseOrderLineId)) throw new Error("VALIDATION"); seen.add(item.purchaseOrderLineId);
      const source = byId.get(item.purchaseOrderLineId); const available = source ? (received.get(source.id) ?? 0) - (returned.get(source.id) ?? 0) : 0;
      if (!source || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > available) throw new Error("RETURN_EXCEEDS_RETURNABLE");
      resolved.push({ source, quantity: item.quantity });
    }
    if (!resolved.length) throw new Error("VALIDATION"); return resolved;
  }
}
