import { describe, expect, it } from "vitest";
import {
  clearTestDoubleOutcomes,
  queryProviderStatus,
  setTestDoubleOutcome,
} from "./provider";

describe("phase10 provider adapters", () => {
  it("manual adapter never auto-resolves", async () => {
    expect(await queryProviderStatus("gcash", "ref-1", "manual")).toBe("UNKNOWN");
    expect(await queryProviderStatus("card", "ref-2", "manual")).toBe("UNKNOWN");
  });
  it("unknown methods and missing refs stay unknown without throwing", async () => {
    expect(await queryProviderStatus("cash", "ref-1", "test-double")).toBe("UNKNOWN");
    expect(await queryProviderStatus("other", "ref-1", "manual")).toBe("UNKNOWN");
    expect(await queryProviderStatus("gcash", null, "test-double")).toBe("UNKNOWN");
    expect(await queryProviderStatus("nope", "ref-1", "test-double")).toBe("UNKNOWN");
  });
  it("test-double returns scripted outcomes", async () => {
    clearTestDoubleOutcomes();
    setTestDoubleOutcome("ref-succeed", "SUCCEEDED", "b1");
    setTestDoubleOutcome("ref-fail", "FAILED", "b1");
    expect(await queryProviderStatus("gcash", "ref-succeed", "test-double", "b1")).toBe("SUCCEEDED");
    expect(await queryProviderStatus("maya", "ref-fail", "test-double", "b1")).toBe("FAILED");
    expect(await queryProviderStatus("gcash", "ref-unscripted", "test-double", "b1")).toBe("UNKNOWN");
    clearTestDoubleOutcomes();
    expect(await queryProviderStatus("gcash", "ref-succeed", "test-double", "b1")).toBe("UNKNOWN");
  });
  it("keeps scripted outcomes tenant-scoped", async () => {
    clearTestDoubleOutcomes();
    setTestDoubleOutcome("shared-ref", "SUCCEEDED", "biz-1");
    // The same provider reference belonging to another tenant must stay
    // UNKNOWN: one business cannot script another business's settlement.
    expect(await queryProviderStatus("gcash", "shared-ref", "test-double", "biz-1")).toBe("SUCCEEDED");
    expect(await queryProviderStatus("gcash", "shared-ref", "test-double", "biz-2")).toBe("UNKNOWN");
    // A caller without a tenant scope can never resolve a script.
    expect(await queryProviderStatus("gcash", "shared-ref", "test-double", null)).toBe("UNKNOWN");
    clearTestDoubleOutcomes();
  });
});
