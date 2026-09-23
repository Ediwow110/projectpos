import { describe, expect, it } from "vitest";
import { customerCreateSchema, customerSearchSchema } from "../src/customers.schema";

describe("phase6 customer schemas", () => {
  it("rejects empty name", () => {
    expect(() => customerCreateSchema.parse({ name: "" })).toThrow();
  });
  it("rejects invalid email", () => {
    expect(() => customerCreateSchema.parse({ name: "Ana", email: "not-an-email" })).toThrow();
  });
  it("rejects pageSize over 100", () => {
    expect(() => customerSearchSchema.parse({ pageSize: 101 })).toThrow();
  });
  it("accepts name-only walk-in", () => {
    expect(customerCreateSchema.parse({ name: "Walk-in" }).phone).toBeUndefined();
  });
});
