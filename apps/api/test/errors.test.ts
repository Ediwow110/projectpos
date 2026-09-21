import { describe, expect, it } from "vitest";
import { error } from "../src/errors";

describe("PLAN 5.4 error envelope", () => {
  it("builds code message correlationId envelope", () => {
    const e = error("TENANT_REQUIRED", "Tenant required", "req_1");
    expect(e).toEqual({ code: "TENANT_REQUIRED", message: "Tenant required", correlationId: "req_1" });
  });
  it("includes fields when provided", () => {
    const e = error("VALIDATION", "Bad", "req_2", { price: ["NEGATIVE"] });
    expect(e.fields?.price).toEqual(["NEGATIVE"]);
  });
});
