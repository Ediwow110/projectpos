import type {
  DbFulfillment,
  DbFulfillmentLine,
  DbInventoryReservation,
  DbOrder,
  DbOrderAccessToken,
  DbOrderPaymentStatus,
  DbOrderLine,
} from "../common/db.port";

export type OrderRow = DbOrder;
export type OrderLineRow = DbOrderLine;
export type InventoryReservationRow = DbInventoryReservation;
export type FulfillmentRow = DbFulfillment;
export type FulfillmentLineRow = DbFulfillmentLine;
export type OrderAccessTokenRow = DbOrderAccessToken;

export type OrderPaymentStatus = DbOrderPaymentStatus;

export type OrderListItem = Pick<
  DbOrder,
  | "id"
  | "businessId"
  | "channel"
  | "fulfillmentMode"
  | "paymentMode"
  | "branchId"
  | "contactName"
  | "currency"
  | "subtotalMinor"
  | "discountMinor"
  | "taxMinor"
  | "deliveryFeeMinor"
  | "deliveryTaxMinor"
  | "totalMinor"
  | "saleId"
  | "status"
  | "version"
  | "createdAt"
  | "updatedAt"
> & { paymentStatus: OrderPaymentStatus };
