import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { InventoryCountService } from "../inventory/nest/inventory-count.service";
import { ProcurementService } from "../procurement/nest/procurement.service";
import { permitsAssignedBranchRequest } from "./branch-access-policy";

describe("restricted branch request policy", () => {
  it("authorizes inventory counts and purchase orders only for the active branch", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Branch Operations", currency: "PHP" });
    const main = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const other = await db.createBranch({ businessId: business.id, name: "Other", type: "store", isActive: true });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "A", sku: "A", barcode: null,
      brand: null, unit: "pc", costMinor: 100, priceMinor: 200,
      taxRateBps: null, reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null,
    });
    const counts = new InventoryCountService(db);
    const mainCount = await counts.createCount(business.id, "owner", "count-main", {
      name: "Main count", scopeType: "PARTIAL", branchId: main.id, productIds: [product.id],
    }, ["inventory.adjust"]);
    const otherCount = await counts.createCount(business.id, "owner", "count-other", {
      name: "Other count", scopeType: "PARTIAL", branchId: other.id, productIds: [product.id],
    }, ["inventory.adjust"]);
    const procurement = new ProcurementService(db);
    const supplier = await procurement.createSupplier(
      business.id, "owner", "supplier", "supplier-idem",
      { name: "Supplier" }, ["supplier.write"],
    );
    const mainPo = await procurement.createPurchaseOrder(
      business.id, "owner", "po-main", "po-main-key",
      { supplierId: supplier.supplier.id, branchId: main.id, lines: [{ productId: product.id, quantity: 1 }] },
      ["purchase_order.write"],
    );
    const otherPo = await procurement.createPurchaseOrder(
      business.id, "owner", "po-other", "po-other-key",
      { supplierId: supplier.supplier.id, branchId: other.id, lines: [{ productId: product.id, quantity: 1 }] },
      ["purchase_order.write"],
    );
    const check = (method: string, path: string, body?: Record<string, unknown>, query?: Record<string, unknown>) =>
      permitsAssignedBranchRequest(db, { method, path, body, query }, business.id, main.id);
    expect(await check("GET", "/api/v1/inventory/counts")).toBe(true);
    expect(await check("GET", "/api/v1/inventory/replenishment")).toBe(true);
    const replenishmentDraft: Record<string, unknown> = {
      supplierId: supplier.supplier.id, lines: [{ productId: product.id, quantity: 1 }],
    };
    expect(await check("POST", "/api/v1/inventory/replenishment/draft-po", replenishmentDraft)).toBe(true);
    expect(replenishmentDraft.branchId).toBe(main.id);
    expect(await check("POST", "/api/v1/inventory/replenishment/draft-po", { branchId: other.id })).toBe(false);
    const riskBody: Record<string, unknown> = { productId: product.id, kind: "DAMAGE", quantity: 1, reason: "Damaged pack" };
    expect(await check("POST", "/api/v1/inventory/stock-exceptions", riskBody)).toBe(true);
    expect(riskBody.branchId).toBe(main.id);
    expect(await check("GET", "/api/v1/inventory/stock-exceptions")).toBe(true);
    expect(await check("GET", "/api/v1/purchase-orders")).toBe(true);
    expect(await check("GET", "/api/v1/inventory/counts", undefined, { branchId: other.id })).toBe(false);
    expect(await check("GET", `/api/v1/inventory/counts/${mainCount.id}`)).toBe(true);
    expect(await check("GET", `/api/v1/inventory/counts/${otherCount.id}`)).toBe(false);
    expect(await check("POST", `/api/v1/inventory/counts/${mainCount.id}/start`)).toBe(true);
    expect(await check("PATCH", `/api/v1/inventory/counts/${otherCount.id}/lines`)).toBe(false);
    const countBody: Record<string, unknown> = { name: "A", scopeType: "FULL" };
    expect(await check("POST", "/api/v1/inventory/counts", countBody)).toBe(true);
    expect(countBody.branchId).toBe(main.id);
    expect(await check("GET", `/api/v1/purchase-orders/${mainPo.purchaseOrder.id}`)).toBe(true);
    expect(await check("GET", `/api/v1/purchase-orders/${otherPo.purchaseOrder.id}`)).toBe(false);
    expect(await check("POST", `/api/v1/purchase-orders/${otherPo.purchaseOrder.id}/receipts`)).toBe(false);
    expect(await check("PATCH", `/api/v1/purchase-orders/${mainPo.purchaseOrder.id}`)).toBe(true);
    const poBody: Record<string, unknown> = { supplierId: supplier.supplier.id };
    expect(await check("POST", "/api/v1/purchase-orders", poBody)).toBe(true);
    expect(poBody.branchId).toBe(main.id);
    expect(await check("POST", "/api/v1/transfers")).toBe(false);
    expect(await check("POST", "/api/v1/sync/check")).toBe(false);
  });
  it("checks sale IDs before allowing hold, completion, payment checkout or receipts", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Sale Scope", currency: "PHP" });
    const local = await db.createBranch({ businessId: business.id, name: "Local", type: "store", isActive: true });
    const remote = await db.createBranch({ businessId: business.id, name: "Remote", type: "store", isActive: true });
    const localRegister = await db.createRegister({ businessId: business.id, name: "Local till", isActive: true, branchId: local.id });
    const otherLocalRegister = await db.createRegister({ businessId: business.id, name: "Other local till", isActive: true, branchId: local.id });
    const remoteRegister = await db.createRegister({ businessId: business.id, name: "Remote till", isActive: true, branchId: remote.id });
    const makeSale = (branchId: string, registerId: string) => db.createSale({
      businessId: business.id, receiptNo: `R-${branchId}-${registerId}`, status: "DRAFT",
      subtotalMinor: 100, discountMinor: 0, taxMinor: 0, totalMinor: 100,
      paidMinor: 0, changeMinor: 0, currency: "PHP",
      customerId: null, customerName: null, notes: null,
      actorId: "staff", requestId: "req", idempotencyKey: null,
      registerId, branchId, createdAt: new Date(),
    });
    const good = await makeSale(local.id, localRegister.id);
    const bad = await makeSale(remote.id, remoteRegister.id);
    const otherRegisterSale = await makeSale(local.id, otherLocalRegister.id);
    const goodCase = await db.createCustomerConcern({
      businessId: business.id, saleId: good.id, receiptNo: good.receiptNo, branchId: local.id, registerId: localRegister.id,
      requesterId: "staff", reason: "DAMAGED", outcome: "REFUND", note: null, items: [], requestedRefundMinor: 0,
      status: "PENDING", idempotencyKey: "case-good", reviewedBy: null, reviewedAt: null, reviewReason: null, refundId: null,
    });
    const badCase = await db.createCustomerConcern({
      businessId: business.id, saleId: bad.id, receiptNo: bad.receiptNo, branchId: remote.id, registerId: remoteRegister.id,
      requesterId: "staff", reason: "DAMAGED", outcome: "REFUND", note: null, items: [], requestedRefundMinor: 0,
      status: "PENDING", idempotencyKey: "case-bad", reviewedBy: null, reviewedAt: null, reviewReason: null, refundId: null,
    });
    const otherRegisterCase = await db.createCustomerConcern({
      businessId: business.id, saleId: otherRegisterSale.id, receiptNo: otherRegisterSale.receiptNo, branchId: local.id, registerId: otherLocalRegister.id,
      requesterId: "staff", reason: "DAMAGED", outcome: "REFUND", note: null, items: [], requestedRefundMinor: 0,
      status: "PENDING", idempotencyKey: "case-other-register", reviewedBy: null, reviewedAt: null, reviewReason: null, refundId: null,
    });
    const permitted = (method: string, path: string, body?: Record<string, unknown>) =>
      permitsAssignedBranchRequest(db, { method, path, body }, business.id, local.id);
    expect(await permitted("POST", "/api/v1/sales/complete", { saleId: good.id })).toBe(true);
    expect(await permitted("POST", "/api/v1/sales/complete", { saleId: bad.id })).toBe(false);
    expect(await permitted("POST", `/api/v1/sales/${good.id}/hold`)).toBe(true);
    expect(await permitted("POST", `/api/v1/sales/${bad.id}/hold`)).toBe(false);
    for (const action of ["refund-approve", "refund-reject", "exchange"]) {
      expect(await permitted("POST", `/api/v1/sales/${good.id}/${action}`)).toBe(true);
      expect(await permitted("POST", `/api/v1/sales/${bad.id}/${action}`)).toBe(false);
    }
    expect(await permitted("POST", `/api/v1/sales/${good.id}/paymongo/checkout`)).toBe(true);
    expect(await permitted("GET", `/api/v1/receipts/${bad.id}`)).toBe(false);
    expect(await permitted("GET", `/api/v1/receipts/${good.id}`)).toBe(true);
    expect(await permitsAssignedBranchRequest(db, {
      method: "GET", path: "/api/v1/receipts/lookup", query: { receiptNo: good.receiptNo },
    }, business.id, local.id)).toBe(true);
    expect(await permitsAssignedBranchRequest(db, {
      method: "GET", path: "/api/v1/receipts/lookup", query: { receiptNo: bad.receiptNo },
    }, business.id, local.id)).toBe(false);
    expect(await permitted("POST", "/api/v1/customer-concerns", { saleId: good.id })).toBe(true);
    expect(await permitted("POST", "/api/v1/customer-concerns", { saleId: bad.id })).toBe(false);
    expect(await permitted("GET", `/api/v1/customer-concerns/${goodCase.id}`)).toBe(true);
    expect(await permitted("POST", `/api/v1/customer-concerns/${goodCase.id}/decision`)).toBe(true);
    expect(await permitted("GET", `/api/v1/customer-concerns/${badCase.id}`)).toBe(false);
    expect(await permitted("POST", `/api/v1/customer-concerns/${badCase.id}/decision`)).toBe(false);
    const registerScoped = (method: string, path: string, body?: Record<string, unknown>) =>
      permitsAssignedBranchRequest(db, { method, path, body }, business.id, local.id, [localRegister.id], [local.id]);
    expect(await registerScoped("POST", "/api/v1/customer-concerns", { saleId: good.id })).toBe(true);
    expect(await registerScoped("POST", "/api/v1/customer-concerns", { saleId: otherRegisterSale.id })).toBe(false);
    expect(await registerScoped("GET", `/api/v1/customer-concerns/${goodCase.id}`)).toBe(true);
    expect(await registerScoped("GET", `/api/v1/customer-concerns/${otherRegisterCase.id}`)).toBe(false);
    expect(await registerScoped("POST", `/api/v1/customer-concerns/${otherRegisterCase.id}/decision`)).toBe(false);
  });
  it("keeps unaudited endpoints blocked and binds sales drafts to the correct register", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Policy Store", currency: "PHP" });
    const main = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
    const remote = await db.createBranch({ businessId: business.id, name: "Other", type: "store", isActive: true });
    const mainRegister = await db.createRegister({ businessId: business.id, name: "Main POS", isActive: true, branchId: main.id });
    const remoteRegister = await db.createRegister({ businessId: business.id, name: "Other POS", isActive: true, branchId: remote.id });
    const secondMainRegister = await db.createRegister({ businessId: business.id, name: "Extra POS", isActive: true, branchId: main.id });
    const permits = (method: string, path: string, body?: Record<string, unknown>, query?: Record<string, unknown>) =>
      permitsAssignedBranchRequest(db, { method, path, body, query }, business.id, main.id);
    expect(await permits("GET", "/api/v1/sales")).toBe(true);
    expect(await permits("GET", "/api/v1/shifts")).toBe(true);
    expect(await permits("GET", "/api/v1/reports/sales")).toBe(true);
    expect(await permits("GET", "/api/v1/reports/inventory")).toBe(true);
    expect(await permits("GET", "/api/v1/reports/cash")).toBe(true);
    expect(await permits("GET", "/api/v1/reports/payments")).toBe(false);
    expect(await permits("GET", "/api/v1/reports/products")).toBe(false);
    expect(await permits("GET", "/api/v1/dashboard/overview")).toBe(false);
    expect(await permits("GET", "/api/v1/reports/sales", undefined, { branchId: remote.id })).toBe(false);
    expect(await permits("GET", "/api/v1/products/barcode/123")).toBe(true);
    expect(await permits("GET", "/api/v1/payments/methods")).toBe(true);
    expect(await permits("GET", "/api/v1/sales/held")).toBe(true);
    expect(await permits("GET", "/api/v1/orders", undefined, { branchId: remote.id })).toBe(false);
    expect(await permits("GET", "/api/v1/inventory/balances", undefined, { branchId: remote.id })).toBe(false);
    const draft: Record<string, unknown> = { registerId: mainRegister.id, lines: [] };
    expect(await permits("POST", "/api/v1/sales/drafts", draft)).toBe(true);
    expect(draft.branchId).toBe(main.id);
    expect(await permits("POST", "/api/v1/sales/drafts", { registerId: remoteRegister.id })).toBe(false);
    expect(await permits("POST", "/api/v1/sales/drafts", { registerId: mainRegister.id, branchId: remote.id })).toBe(false);
    expect(await permits("POST", "/api/v1/sales/complete", { saleId: "unknown" })).toBe(false);
    const restricted = (method: string, path: string, body?: Record<string, unknown>) =>
      permitsAssignedBranchRequest(db, { method, path, body }, business.id, main.id, [mainRegister.id]);
    expect(await restricted("GET", "/api/v1/reports/sales")).toBe(false);
    expect(await restricted("GET", "/api/v1/reports/cash")).toBe(false);
    expect(await restricted("GET", "/api/v1/reports/inventory")).toBe(true);
    expect(await restricted("POST", "/api/v1/sales/drafts", { registerId: mainRegister.id })).toBe(true);
    expect(await restricted("POST", "/api/v1/sales/drafts", { registerId: secondMainRegister.id })).toBe(false);
    expect(await restricted("POST", `/api/v1/registers/${secondMainRegister.id}/open`)).toBe(false);
    expect(await restricted("POST", `/api/v1/registers/${mainRegister.id}/open`)).toBe(true);
    const twoBranches = (method: string, path: string, body?: Record<string, unknown>) =>
      permitsAssignedBranchRequest(db, { method, path, body }, business.id, main.id, null, [main.id, remote.id]);
    expect(await twoBranches("POST", "/api/v1/transfers", {
      fromBranchId: main.id, toBranchId: remote.id,
    })).toBe(true);
    expect(await permits("POST", "/api/v1/transfers", {
      fromBranchId: main.id, toBranchId: remote.id,
    })).toBe(false);
    const foreignBusiness = await db.createBusiness({ name: "Outside", currency: "PHP" });
    const foreignBranch = await db.createBranch({
      businessId: foreignBusiness.id, name: "Outside branch", type: "store", isActive: true,
    });
    expect(await twoBranches("POST", "/api/v1/transfers", {
      fromBranchId: main.id, toBranchId: foreignBranch.id,
    })).toBe(false);
    const transfer = await db.createTransfer({
      businessId: business.id, fromBranchId: main.id, toBranchId: remote.id,
      status: "DRAFT", requestedBy: "worker", dispatchedBy: null,
      receivedBy: null, requestId: "transfer-test",
    });
    expect(await twoBranches("GET", `/api/v1/transfers/${transfer.id}`)).toBe(true);
    expect(await permits("GET", `/api/v1/transfers/${transfer.id}`)).toBe(false);
    expect(await twoBranches("POST", `/api/v1/transfers/${transfer.id}/dispatch`)).toBe(true);
  });
});
