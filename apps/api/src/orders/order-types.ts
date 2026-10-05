import type {
  DbFulfillment,
  DbFulfillmentLine,
  DbInventoryReservation,
  DbOrder,
  DbOrderAccessToken,
  DbOrderLine,
} from "../common/db.port";

export type OrderRow = DbOrder;
export type OrderLineRow = DbOrderLine;
export type InventoryReservationRow = DbInventoryReservation;
export type FulfillmentRow = DbFulfillment;
export type FulfillmentLineRow = DbFulfillmentLine;
export type OrderAccessTokenRow = DbOrderAccessToken;
