import type { DbPort, DbProduct, DbSale } from "../common/db.port";
import { BillingService } from "../billing/nest/billing.service";
import { computeSaleTotals, requiresDiscountOverride } from "./totals";
import type { DraftInput } from "./sales-types";
import { SalesStockService } from "./sale-stock-service";

export class SalesDraftService {
  constructor(
    private readonly db: DbPort,
    private readonly stock: SalesStockService,
  ) {}

  private async businessTaxRateBps(businessId: string): Promise<number | null> {
    const settings = await this.db.getSettings(businessId);
    const rate = settings["taxRateBps"];
    return typeof rate === "number" ? rate : null;
  }

  async createDraft(
    businessId: string,
    actorId: string,
    requestId: string,
    input: DraftInput,
    granted: string[],
  ): Promise<DbSale> {
    const businessTax = await this.businessTaxRateBps(businessId);
    const lines: Array<{ product: DbProduct; qty: number; lineDiscountMinor: number }> = [];
    for (const line of input.lines) {
      const product = await this.stock.requireProduct(businessId, line.productId);
      lines.push({ product, qty: line.qty, lineDiscountMinor: line.lineDiscountMinor ?? 0 });
    }
    const subtotalGuess = lines.reduce(
      (sum, line) => sum + Math.max(0, line.qty * line.product.priceMinor - line.lineDiscountMinor),
      0,
    );
    if (
      requiresDiscountOverride({
        orderDiscountMinor: input.orderDiscountMinor ?? 0,
        subtotalMinor: subtotalGuess,
        lines: lines.map((line) => ({
          lineDiscountMinor: line.lineDiscountMinor,
          qty: line.qty,
          priceMinor: line.product.priceMinor,
        })),
      }) &&
      !granted.includes("discount.override")
    ) {
      throw new Error("FORBIDDEN");
    }
    const totals = computeSaleTotals({
      lines: lines.map((line) => ({
        qty: line.qty,
        priceMinor: line.product.priceMinor,
        costMinor: line.product.costMinor,
        taxRateBps: line.product.taxRateBps,
        lineDiscountMinor: line.lineDiscountMinor,
      })),
      orderDiscountMinor: input.orderDiscountMinor ?? 0,
      businessTaxRateBps: businessTax,
    });
    const receiptNo = await this.db.nextReceiptNo(businessId);
    let registerId: string | null = null;
    let registerBranchId: string | null = null;
    if (input.registerId !== undefined) {
      const register = await this.db.findRegisterById(input.registerId, businessId);
      if (!register) throw new Error("VALIDATION");
      registerId = register.id;
      registerBranchId = register.branchId ?? null;
    }
    let branchId: string | null = registerBranchId;
    if (input.branchId !== undefined && input.branchId !== null) {
      const branch = await this.db.findBranchById(input.branchId, businessId);
      if (!branch) throw new Error("VALIDATION");
      if (registerBranchId !== null && branch.id !== registerBranchId) throw new Error("VALIDATION");
      branchId = branch.id;
    }
    let customerId: string | null = null;
    let customerName: string | null = input.customerName?.trim() ? input.customerName.trim() : null;
    if (input.customerId !== undefined && input.customerId !== null) {
      await new BillingService(this.db).requireFeature(businessId, "customers", actorId, requestId);
      const customer = await this.db.findCustomerById(input.customerId, businessId);
      if (!customer) throw new Error("VALIDATION");
      customerId = customer.id;
      if (!customerName) customerName = customer.name;
    }
    const sale = await this.db.createSale({
      businessId,
      receiptNo,
      status: "DRAFT",
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      paidMinor: 0,
      changeMinor: 0,
      currency: "PHP",
      customerId,
      customerName,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      actorId,
      requestId,
      idempotencyKey: null,
      registerId,
      branchId,
      createdAt: new Date(),
    });
    for (const line of lines) {
      await this.db.createSaleItem({
        businessId,
        saleId: sale.id,
        productId: line.product.id,
        name: line.product.name,
        unit: line.product.unit,
        qty: line.qty,
        priceMinor: line.product.priceMinor,
        costMinor: line.product.costMinor,
        taxRateBps: line.product.taxRateBps,
        lineDiscountMinor: line.lineDiscountMinor,
        lineTotalMinor: Math.max(0, line.qty * line.product.priceMinor - line.lineDiscountMinor),
      });
    }
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "sale.draft",
      entityType: "Sale",
      entityId: sale.id,
      requestId,
    });
    return { ...sale, ...totals, totalMinor: totals.totalMinor };
  }
}
