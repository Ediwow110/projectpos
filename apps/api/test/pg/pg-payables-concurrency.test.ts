import { describe, expect, it } from "vitest";
import type { DbPort } from "../../src/common/db.port";
import { PgContext } from "../../src/common/pg/context";
import { PgDbPort } from "../../src/common/pg/pg.db";
import { PayablesService } from "../../src/payables/payables.service";
import { ProcurementService } from "../../src/procurement/nest/procurement.service";
import { withPg } from "./helpers";

const BASE_URL = process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433";

describe("Phase 23 PostgreSQL payables concurrency", () => {
  it("allows only one concurrent bill post to allocate the same received quantity", async () => {
    await withPg(async (raw) => {
      const db1 = raw as DbPort;
      const ctx2 = new PgContext(`${BASE_URL}/pos_test_pg`);
      const db2 = new PgDbPort(ctx2) as unknown as DbPort;
      try {
        const business = await db1.createBusiness({ name: "Concurrent AP", currency: "PHP" });
        const supplier = await db1.createSupplier({ businessId: business.id, name: "Supplier", code: "RACE", contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, province: null, postalCode: null, country: "PH", paymentTerms: null, notes: null, isActive: true });
        const product = await db1.createProduct({ businessId: business.id, categoryId: null, name: "Beans", sku: "RACE-BEANS", barcode: null, brand: null, unit: "bag", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
        await db1.upsertBalance({ businessId: business.id, branchId: null, productId: product.id, qtyOnHand: 3 });
        const order = await db1.createPurchaseOrder({ businessId: business.id, supplierId: supplier.id, branchId: null, poNumber: "RACE-PO", status: "RECEIVED", expectedDate: null, notes: null, subtotalMinor: 300, taxMinor: 0, totalMinor: 300, createdBy: "owner", orderedBy: "owner", orderedAt: new Date(), cancelledBy: null, cancelledAt: null, cancelReason: null });
        const orderLine = await db1.createPurchaseOrderLine({ businessId: business.id, purchaseOrderId: order.id, productId: product.id, position: 0, supplierSkuSnapshot: null, productNameSnapshot: "Beans", quantity: 3, unitCostMinor: 100, lineTotalMinor: 300, notes: null });
        const receipt = await db1.createPurchaseReceipt({ businessId: business.id, purchaseOrderId: order.id, branchId: null, receiptNumber: "RACE-GRN", status: "POSTED", receivedBy: "owner", receivedAt: new Date(), notes: null });
        const receiptLine = await db1.createPurchaseReceiptLine({ businessId: business.id, purchaseReceiptId: receipt.id, purchaseOrderLineId: orderLine.id, productId: product.id, quantityReceived: 3, unitCostMinorSnapshot: 100, productNameSnapshot: "Beans", supplierSkuSnapshot: null });
        const input = (invoiceNumber: string) => ({ supplierId: supplier.id, branchId: null, invoiceNumber, invoiceDate: new Date(), invoiceAmountMinor: 400, nonStockChargeMinor: 200, allocations: [{ receiptLineId: receiptLine.id, quantity: 2, unitInvoiceCostMinor: 200 }] });
        const payables1 = new PayablesService(db1);
        const payables2 = new PayablesService(db2);
        const [draft1, draft2] = await Promise.all([
          payables1.createDraft(business.id, "owner", "race-create-1", "race-bill-key-1", input("INV-RACE-1"), ["payables.write"]),
          payables2.createDraft(business.id, "owner", "race-create-2", "race-bill-key-2", input("INV-RACE-2"), ["payables.write"]),
        ]);
        const results = await Promise.allSettled([
          payables1.postDraft(business.id, "owner", "race-post-1", draft1.bill.id, draft1.bill.version, ["payables.write"]),
          payables2.postDraft(business.id, "owner", "race-post-2", draft2.bill.id, draft2.bill.version, ["payables.write"]),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        const posted = (await db1.listSupplierBills(business.id)).filter((bill) => bill.status === "POSTED");
        expect(posted).toHaveLength(1);
        const bill = posted[0]!;
        const procurement1 = new ProcurementService(db1);
        const procurement2 = new ProcurementService(db2);
        const returnInput = { supplierId: supplier.id, purchaseOrderId: order.id, reason: "Concurrent return", lines: [{ purchaseOrderLineId: orderLine.id, quantity: 2 }] };
        const [returnDraft1, returnDraft2] = await Promise.all([
          procurement1.createSupplierReturn(business.id, "owner", "race-return-create-1", "race-return-key-1", returnInput, ["supplier_return.write"]),
          procurement2.createSupplierReturn(business.id, "owner", "race-return-create-2", "race-return-key-2", returnInput, ["supplier_return.write"]),
        ]);
        const returnResults = await Promise.allSettled([
          procurement1.postSupplierReturn(business.id, "owner", "race-return-post-1", returnDraft1.supplierReturn.id, "race-return-post-key-1", returnDraft1.supplierReturn.version, ["supplier_return.post"]),
          procurement2.postSupplierReturn(business.id, "owner", "race-return-post-2", returnDraft2.supplierReturn.id, "race-return-post-key-2", returnDraft2.supplierReturn.version, ["supplier_return.post"]),
        ]);
        expect(returnResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(returnResults.filter((result) => result.status === "rejected")).toHaveLength(1);
        const paidAt = new Date();
        const paymentResults = await Promise.allSettled([
          payables1.payBill(business.id, "owner", "race-payment-1", bill.id, "race-pay-key-1", { amountMinor: 125, method: "bank_transfer", paidAt }, ["payables.pay"]),
          payables2.payBill(business.id, "owner", "race-payment-2", bill.id, "race-pay-key-2", { amountMinor: 125, method: "bank_transfer", paidAt }, ["payables.pay"]),
        ]);
        expect(paymentResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(paymentResults.filter((result) => result.status === "rejected")).toHaveLength(1);
        const unappliedReturn = returnResults[0]?.status === "rejected" ? returnDraft1.supplierReturn : returnDraft2.supplierReturn;
        const credit = await db1.createSupplierCredit({ businessId: business.id, supplierId: supplier.id, billId: null, supplierReturnId: unappliedReturn.id, creditNumber: "RACE-CN", amountMinor: 25, status: "POSTED", createdBy: "owner", requestId: "race-credit" });
        const creditResults = await Promise.allSettled([
          payables1.applyCredit(business.id, "owner", "race-credit-apply-1", credit.id, { billId: bill.id }, ["payables.write"]),
          payables2.applyCredit(business.id, "owner", "race-credit-apply-2", credit.id, { billId: bill.id }, ["payables.write"]),
        ]);
        expect(creditResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(creditResults.filter((result) => result.status === "rejected")).toHaveLength(1);
      } finally {
        await ctx2.close();
      }
    });
  });
});
