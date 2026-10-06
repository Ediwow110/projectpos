import { describe, expect, it } from "vitest";
import { transitionFulfillment, transitionOrder } from "./order-state";

describe("phase22 order state machine", () => {
  it("accepts only the approved order lifecycle transitions", () => {
    expect(transitionOrder("DRAFT", "CHECKOUT")).toBe("CHECKOUT");
    expect(transitionOrder("CHECKOUT", "SUBMITTED")).toBe("SUBMITTED");
    expect(transitionOrder("SUBMITTED", "CONFIRMED")).toBe("CONFIRMED");
    expect(transitionOrder("SUBMITTED", "CANCELLED")).toBe("CANCELLED");
    expect(transitionOrder("SUBMITTED", "EXPIRED")).toBe("EXPIRED");
    expect(transitionOrder("SUBMITTED", "REJECTED")).toBe("REJECTED");
    expect(transitionOrder("CONFIRMED", "COMPLETED")).toBe("COMPLETED");
    expect(transitionOrder("CONFIRMED", "CANCELLED")).toBe("CANCELLED");
    expect(() => transitionOrder("CONFIRMED", "REJECTED")).toThrow("INVALID_STATE");
    expect(() => transitionOrder("COMPLETED", "CANCELLED")).toThrow("INVALID_STATE");
  });

  it("enforces pickup and delivery cancellation/handoff rules", () => {
    expect(transitionFulfillment("PICKUP", "PENDING", "READY")).toBe("READY");
    expect(transitionFulfillment("PICKUP", "PENDING", "CANCELLED")).toBe("CANCELLED");
    expect(transitionFulfillment("PICKUP", "READY", "COLLECTED")).toBe("COLLECTED");
    expect(transitionFulfillment("PICKUP", "READY", "CANCELLED")).toBe("CANCELLED");
    expect(() => transitionFulfillment("PICKUP", "COLLECTED", "CANCELLED")).toThrow("INVALID_STATE");

    expect(transitionFulfillment("DELIVERY", "PENDING", "PACKED")).toBe("PACKED");
    expect(transitionFulfillment("DELIVERY", "PENDING", "CANCELLED")).toBe("CANCELLED");
    expect(transitionFulfillment("DELIVERY", "PACKED", "DISPATCHED")).toBe("DISPATCHED");
    expect(transitionFulfillment("DELIVERY", "PACKED", "CANCELLED")).toBe("CANCELLED");
    expect(transitionFulfillment("DELIVERY", "DISPATCHED", "DELIVERED")).toBe("DELIVERED");
    expect(transitionFulfillment("DELIVERY", "DISPATCHED", "DELIVERY_FAILED")).toBe("DELIVERY_FAILED");
    expect(transitionFulfillment("DELIVERY", "DELIVERY_FAILED", "DISPATCHED")).toBe("DISPATCHED");
    expect(transitionFulfillment("DELIVERY", "DELIVERY_FAILED", "CANCELLED")).toBe("CANCELLED");
    expect(() => transitionFulfillment("DELIVERY", "DISPATCHED", "CANCELLED")).toThrow("INVALID_STATE");
    expect(() => transitionFulfillment("DELIVERY", "DELIVERED", "CANCELLED")).toThrow("INVALID_STATE");
  });
});
