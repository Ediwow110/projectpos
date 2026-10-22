import { describe, expect, it } from "vitest";

describe("sales CSV export url", () => {
  it("carries exactly the filters the reviewer is looking at", async () => {
    const { salesExportUrl } = await import("./sales-export");
    const url = salesExportUrl({ status: "COMPLETED", customerId: "cus_9", dateFrom: "2026-10-01", dateTo: "2026-10-07" });
    expect(url).toContain("format=csv");
    expect(url).toContain("status=COMPLETED");
    expect(url).toContain("customerId=cus_9");
    expect(url).toContain("dateFrom=2026-10-01");
    expect(url).toContain("dateTo=2026-10-07");
  });

  it("omits filters that were never chosen instead of sending empty values", async () => {
    const { salesExportUrl } = await import("./sales-export");
    const url = salesExportUrl({ status: "", customerId: "", dateFrom: "", dateTo: "" });
    expect(url.endsWith("format=csv")).toBe(true);
    for (const key of ["status", "customerId", "dateFrom", "dateTo"]) expect(url).not.toContain(`${key}=`);
  });

  it("cannot be widened through a filter value", async () => {
    const { salesExportUrl } = await import("./sales-export");
    const url = salesExportUrl({ status: "COMPLETED&businessId=other", customerId: "", dateFrom: "", dateTo: "" });
    expect(url).not.toContain("&businessId=other");
    expect(url).toContain("COMPLETED%26businessId%3Dother");
  });

  it("points at the API origin the app is configured with", async () => {
    const { salesExportUrl } = await import("./sales-export");
    const { apiBase } = await import("./api");
    expect(salesExportUrl({ status: "", customerId: "", dateFrom: "", dateTo: "" })).toContain(`${apiBase()}/api/v1/sales/export`);
  });
});
