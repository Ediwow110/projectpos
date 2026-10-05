import { describe, expect, it } from "vitest";
import {
  orderAccessTokenSchema,
  orderContactSchema,
  storefrontKeySchema,
} from "../src/orders.schema";

describe("phase22 order boundary schemas", () => {
  it("accepts only exact public storefront and bearer-token shapes", () => {
    expect(storefrontKeySchema.parse("a".repeat(32))).toBe("a".repeat(32));
    expect(orderAccessTokenSchema.parse("B".repeat(64))).toBe("B".repeat(64));
    expect(() => storefrontKeySchema.parse("a".repeat(31))).toThrow();
    expect(() => storefrontKeySchema.parse("g".repeat(32))).toThrow();
    expect(() => orderAccessTokenSchema.parse("b".repeat(63))).toThrow();
  });

  it("requires guest contact and a complete delivery address when present", () => {
    expect(orderContactSchema.parse({
      contactName: " Ana Reyes ",
      email: "ana@example.com",
      phone: "+639171234567",
      deliveryAddress: {
        line1: "1 Main St",
        city: "Cavite City",
        region: "Cavite",
        postalCode: "4100",
        countryCode: "PH",
      },
    })).toMatchObject({ contactName: "Ana Reyes" });

    expect(() => orderContactSchema.parse({
      contactName: "Ana",
      email: "ana@example.com",
      phone: "+639171234567",
      deliveryAddress: { line1: "", city: "Cavite City", region: "Cavite", postalCode: "4100", countryCode: "PH" },
    })).toThrow();
  });
});
