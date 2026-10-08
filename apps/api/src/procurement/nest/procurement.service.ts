import { Inject, Injectable } from "@nestjs/common";
import type { DbPort } from "../../common/db.port";
import { ProcurementOrderService } from "./procurement.order.service";
import { ProcurementSupplierService } from "./procurement.supplier.service";

export type {
  ProductSupplierInput,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
  PurchaseOrderPage,
  PurchaseOrderWithLines,
  PurchaseReceiptWithLines,
  SupplierPage,
  SupplierReturnWithLines,
} from "./procurement.contracts";

@Injectable()
export class ProcurementService {
  private readonly suppliers: ProcurementSupplierService;
  private readonly orders: ProcurementOrderService;

  constructor(@Inject("DbPort") db: DbPort) {
    this.suppliers = new ProcurementSupplierService(db);
    this.orders = new ProcurementOrderService(db);
  }

  listSuppliers(...args: Parameters<ProcurementSupplierService["listSuppliers"]>): ReturnType<ProcurementSupplierService["listSuppliers"]> {
    return this.suppliers.listSuppliers(...args);
  }

  getSupplier(...args: Parameters<ProcurementSupplierService["getSupplier"]>): ReturnType<ProcurementSupplierService["getSupplier"]> {
    return this.suppliers.getSupplier(...args);
  }

  listSupplierProducts(...args: Parameters<ProcurementSupplierService["listSupplierProducts"]>): ReturnType<ProcurementSupplierService["listSupplierProducts"]> {
    return this.suppliers.listSupplierProducts(...args);
  }

  createSupplier(...args: Parameters<ProcurementSupplierService["createSupplier"]>): ReturnType<ProcurementSupplierService["createSupplier"]> {
    return this.suppliers.createSupplier(...args);
  }

  updateSupplier(...args: Parameters<ProcurementSupplierService["updateSupplier"]>): ReturnType<ProcurementSupplierService["updateSupplier"]> {
    return this.suppliers.updateSupplier(...args);
  }

  setSupplierActive(...args: Parameters<ProcurementSupplierService["setSupplierActive"]>): ReturnType<ProcurementSupplierService["setSupplierActive"]> {
    return this.suppliers.setSupplierActive(...args);
  }

  createProductSupplier(...args: Parameters<ProcurementSupplierService["createProductSupplier"]>): ReturnType<ProcurementSupplierService["createProductSupplier"]> {
    return this.suppliers.createProductSupplier(...args);
  }

  updateProductSupplier(...args: Parameters<ProcurementSupplierService["updateProductSupplier"]>): ReturnType<ProcurementSupplierService["updateProductSupplier"]> {
    return this.suppliers.updateProductSupplier(...args);
  }

  deleteProductSupplier(...args: Parameters<ProcurementSupplierService["deleteProductSupplier"]>): ReturnType<ProcurementSupplierService["deleteProductSupplier"]> {
    return this.suppliers.deleteProductSupplier(...args);
  }

  listPurchaseOrders(...args: Parameters<ProcurementOrderService["listPurchaseOrders"]>): ReturnType<ProcurementOrderService["listPurchaseOrders"]> {
    return this.orders.listPurchaseOrders(...args);
  }

  getPurchaseOrder(...args: Parameters<ProcurementOrderService["getPurchaseOrder"]>): ReturnType<ProcurementOrderService["getPurchaseOrder"]> {
    return this.orders.getPurchaseOrder(...args);
  }

  listPurchaseReceipts(...args: Parameters<ProcurementOrderService["listPurchaseReceipts"]>): ReturnType<ProcurementOrderService["listPurchaseReceipts"]> {
    return this.orders.listPurchaseReceipts(...args);
  }

  getPurchaseReceipt(...args: Parameters<ProcurementOrderService["getPurchaseReceipt"]>): ReturnType<ProcurementOrderService["getPurchaseReceipt"]> {
    return this.orders.getPurchaseReceipt(...args);
  }

  receivePurchaseOrder(...args: Parameters<ProcurementOrderService["receivePurchaseOrder"]>): ReturnType<ProcurementOrderService["receivePurchaseOrder"]> {
    return this.orders.receivePurchaseOrder(...args);
  }

  listSupplierReturns(...args: Parameters<ProcurementOrderService["listSupplierReturns"]>): ReturnType<ProcurementOrderService["listSupplierReturns"]> {
    return this.orders.listSupplierReturns(...args);
  }

  getSupplierReturn(...args: Parameters<ProcurementOrderService["getSupplierReturn"]>): ReturnType<ProcurementOrderService["getSupplierReturn"]> {
    return this.orders.getSupplierReturn(...args);
  }

  createSupplierReturn(...args: Parameters<ProcurementOrderService["createSupplierReturn"]>): ReturnType<ProcurementOrderService["createSupplierReturn"]> {
    return this.orders.createSupplierReturn(...args);
  }

  updateSupplierReturn(...args: Parameters<ProcurementOrderService["updateSupplierReturn"]>): ReturnType<ProcurementOrderService["updateSupplierReturn"]> {
    return this.orders.updateSupplierReturn(...args);
  }

  postSupplierReturn(...args: Parameters<ProcurementOrderService["postSupplierReturn"]>): ReturnType<ProcurementOrderService["postSupplierReturn"]> {
    return this.orders.postSupplierReturn(...args);
  }

  cancelSupplierReturn(...args: Parameters<ProcurementOrderService["cancelSupplierReturn"]>): ReturnType<ProcurementOrderService["cancelSupplierReturn"]> {
    return this.orders.cancelSupplierReturn(...args);
  }

  createPurchaseOrder(...args: Parameters<ProcurementOrderService["createPurchaseOrder"]>): ReturnType<ProcurementOrderService["createPurchaseOrder"]> {
    return this.orders.createPurchaseOrder(...args);
  }

  updatePurchaseOrder(...args: Parameters<ProcurementOrderService["updatePurchaseOrder"]>): ReturnType<ProcurementOrderService["updatePurchaseOrder"]> {
    return this.orders.updatePurchaseOrder(...args);
  }

  orderPurchaseOrder(...args: Parameters<ProcurementOrderService["orderPurchaseOrder"]>): ReturnType<ProcurementOrderService["orderPurchaseOrder"]> {
    return this.orders.orderPurchaseOrder(...args);
  }

  cancelPurchaseOrder(...args: Parameters<ProcurementOrderService["cancelPurchaseOrder"]>): ReturnType<ProcurementOrderService["cancelPurchaseOrder"]> {
    return this.orders.cancelPurchaseOrder(...args);
  }

  listPurchaseOrderEvents(...args: Parameters<ProcurementOrderService["listPurchaseOrderEvents"]>): ReturnType<ProcurementOrderService["listPurchaseOrderEvents"]> {
    return this.orders.listPurchaseOrderEvents(...args);
  }
}
