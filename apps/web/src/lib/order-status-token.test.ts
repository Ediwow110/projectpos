import { describe, expect, it, vi } from "vitest";
import { consumeStatusTokenFromLocation } from "./order-status-token";

describe("order status token consumption", () => {
  it("returns the fragment token and synchronously scrubs browser-visible URL state", () => {
    const token = "a".repeat(64);
    const history = { replaceState: vi.fn() };
    const location = { hash: "#token=" + token };

    const consumed = consumeStatusTokenFromLocation(location, history);

    expect(consumed).toBe(token);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/order-status");
    expect(location.hash).toContain(token);
  });

  it("does not touch history when there is no token fragment", () => {
    const history = { replaceState: vi.fn() };
    expect(consumeStatusTokenFromLocation({ hash: "" }, history)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
