import type {
  DbFulfillmentStatus,
  DbFulfillmentType,
  DbOrderStatus,
} from "../common/db.port";

const ORDER_TRANSITIONS: Record<DbOrderStatus, readonly DbOrderStatus[]> = {
  DRAFT: ["CHECKOUT"],
  CHECKOUT: ["SUBMITTED"],
  SUBMITTED: ["CONFIRMED", "CANCELLED", "EXPIRED", "REJECTED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  REJECTED: [],
};

const PICKUP_TRANSITIONS: Record<DbFulfillmentStatus, readonly DbFulfillmentStatus[]> = {
  PENDING: ["READY", "CANCELLED"],
  READY: ["COLLECTED", "CANCELLED"],
  PACKED: [],
  DISPATCHED: [],
  DELIVERED: [],
  DELIVERY_FAILED: [],
  COLLECTED: [],
  CANCELLED: [],
};

const DELIVERY_TRANSITIONS: Record<DbFulfillmentStatus, readonly DbFulfillmentStatus[]> = {
  PENDING: ["PACKED", "CANCELLED"],
  READY: [],
  PACKED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERED: [],
  DELIVERY_FAILED: ["DISPATCHED", "CANCELLED"],
  COLLECTED: [],
  CANCELLED: [],
};

export function transitionOrder(from: DbOrderStatus, to: DbOrderStatus): DbOrderStatus {
  if (!ORDER_TRANSITIONS[from].includes(to)) throw new Error("INVALID_STATE");
  return to;
}

export function transitionFulfillment(
  type: DbFulfillmentType,
  from: DbFulfillmentStatus,
  to: DbFulfillmentStatus,
): DbFulfillmentStatus {
  const allowed = type === "PICKUP" ? PICKUP_TRANSITIONS[from] : DELIVERY_TRANSITIONS[from];
  if (!allowed.includes(to)) throw new Error("INVALID_STATE");
  return to;
}
