import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ApiError } from "./api";

describe("customer display pairing", () => {
  it("offers pairing to the roles the endpoint actually serves", async () => {
    const { canPairCustomerDisplay } = await import("./display-token");
    expect(canPairCustomerDisplay("owner")).toBe(true);
    expect(canPairCustomerDisplay("manager")).toBe(true);
    expect(canPairCustomerDisplay("cashier")).toBe(true);
    expect(canPairCustomerDisplay("inventory")).toBe(false);
  });

  it("keeps the offered roles identical to the server's own set", async () => {
    const service = readFileSync(resolve(process.cwd(), "../../apps/api/src/display/nest/display.service.ts"), "utf8");
    const declared = service.match(/const SELL_ROLES = new Set\(\[([^\]]+)\]/);
    expect(declared, "the API must declare the roles that may pair a display").not.toBeNull();
    const roles = (declared?.[1] ?? "").split(",").map((entry) => entry.trim().replaceAll('"', ""));
    const { canPairCustomerDisplay } = await import("./display-token");
    for (const role of roles) expect(canPairCustomerDisplay(role), role).toBe(true);
    expect(canPairCustomerDisplay("inventory")).toBe(false);
  });

  it("builds the link the display page reads, with both parameters encoded", async () => {
    const { displayLink } = await import("./display-token");
    const link = displayLink("https://nexpos.example", "reg 1", "abc&def");
    expect(link).toBe("https://nexpos.example/display?registerId=reg+1&token=abc%26def");
  });

  it("states the same lifetime the server issues", async () => {
    const { DISPLAY_TOKEN_MINUTES } = await import("./display-token");
    const service = readFileSync(resolve(process.cwd(), "../../apps/api/src/display/nest/display.service.ts"), "utf8");
    const declared = service.match(/getTime\(\) \+ (\d+) \* 60 \* 1000/);
    expect(declared, "the API must declare the display token lifetime").not.toBeNull();
    expect(DISPLAY_TOKEN_MINUTES).toBe(Number(declared?.[1]));
  });

  it("explains a refusal without pretending the link was made", async () => {
    const { displayPairFailureCopy } = await import("./display-token");
    expect(displayPairFailureCopy(new ApiError("FORBIDDEN", "no", "", 403))).toContain("signed-in seller");
    expect(displayPairFailureCopy(new ApiError("NOT_FOUND", "no", "", 404))).toContain("register");
    expect(displayPairFailureCopy(new ApiError("PAYMENT_UNAVAILABLE", "Provider down", "", 503))).toBe("PAYMENT_UNAVAILABLE: Provider down");
  });
});
