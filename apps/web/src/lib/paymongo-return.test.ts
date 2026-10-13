import { describe, expect, it } from "vitest";
import { hostedPaymentReturnMessage } from "./paymongo-return";

describe("hosted PayMongo return guidance", () => {
  it("explains a canceled return without claiming the charge failed", () => {
    const message = hostedPaymentReturnMessage("cancelled");
    expect(message).toContain("still pending");
    expect(message).toContain("does not confirm");
    expect(message).toContain("before trying again");
  });

  it("does not treat a success redirect as payment confirmation", () => {
    const message = hostedPaymentReturnMessage("success");
    expect(message).toContain("does not confirm payment");
    expect(message).toContain("signed confirmation");
    expect(message).toContain("Do not charge the customer again");
  });

  it("ignores unrelated return values", () => {
    expect(hostedPaymentReturnMessage(null)).toBeNull();
    expect(hostedPaymentReturnMessage("other")).toBeNull();
  });
});
