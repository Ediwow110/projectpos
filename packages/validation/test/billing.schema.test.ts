import { describe, expect, it } from "vitest";
import {
  apiTokenCreateSchema,
  displayTokenSchema,
  flagOverrideSchema,
  invoiceIssueSchema,
  platformPlanSchema,
  printerEnrollSchema,
  printJobSchema,
  webhookEventSchema,
} from "../src/billing.schema";

describe("phase10 billing schemas", () => {
  it("accepts a well-formed webhook event", () => {
    const out = webhookEventSchema.parse({ eventId: "evt_1", type: "invoice.paid", amountMinor: 149000 });
    expect(out.eventId).toBe("evt_1");
  });
  it("rejects webhook events without id or type", () => {
    expect(() => webhookEventSchema.parse({ type: "invoice.paid" })).toThrow();
    expect(() => webhookEventSchema.parse({ eventId: "e" })).toThrow();
  });
  it("restricts plan keys and token scopes to known values", () => {
    expect(() => platformPlanSchema.parse({ planKey: "ultra" })).toThrow();
    expect(platformPlanSchema.parse({ planKey: "pro" }).planKey).toBe("pro");
    expect(() => apiTokenCreateSchema.parse({ name: "x", scopes: ["nope"] })).toThrow();
    expect(apiTokenCreateSchema.parse({ name: "x", scopes: ["sales:read"] }).scopes).toEqual(["sales:read"]);
  });
  it("restricts printer widths and validates display register", () => {
    expect(() => printerEnrollSchema.parse({ name: "p", width: 70 })).toThrow();
    expect(printerEnrollSchema.parse({ name: "p", width: "80" }).width).toBe("80");
    expect(() => displayTokenSchema.parse({ registerId: "" })).toThrow();
  });
  it("requires a reason-free invoice issue window and valid flag patch", () => {
    expect(() => invoiceIssueSchema.parse({ periodStart: "not-a-date" })).toThrow();
    expect(() => flagOverrideSchema.parse({ key: "x" })).toThrow();
    expect(flagOverrideSchema.parse({ key: "reports", enabled: false }).enabled).toBe(false);
  });
  it("accepts print jobs with layout default", () => {
    expect(printJobSchema.parse({ printerId: "pr1" }).layout).toBe("80");
  });
});
