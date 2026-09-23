import { describe, expect, it } from "vitest";
import { reportsQuerySchema, salesReportQuerySchema, productsReportQuerySchema } from "../src/reports.schema";

describe("phase7 reports schemas", () => {
  it("defaults compare to previous_period", () => {
    expect(reportsQuerySchema.parse({}).compare).toBe("previous_period");
  });
  it("rejects unknown compare mode", () => {
    expect(() => reportsQuerySchema.parse({ compare: "next_year" })).toThrow();
  });
  it("rejects unknown granularity", () => {
    expect(() => salesReportQuerySchema.parse({ granularity: "decade" })).toThrow();
  });
  it("rejects unknown products tab", () => {
    expect(() => productsReportQuerySchema.parse({ tab: "viral" })).toThrow();
  });
  it("caps products limit at 100", () => {
    expect(() => productsReportQuerySchema.parse({ limit: 101 })).toThrow();
    expect(productsReportQuerySchema.parse({}).limit).toBe(20);
  });
});
