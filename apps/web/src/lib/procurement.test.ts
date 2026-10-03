import { describe, expect, it } from "vitest";
import { purchaseOrdersPath, purchaseOrderStatusLabel, purchaseOrderStatusTone } from "./purchase-orders";
import { formatMinor, suppliersPath } from "./suppliers";

describe("procurement web helpers", () => {
  it("builds bounded list URLs with readable formatting", () => {
    expect(suppliersPath({ q: "ACME", status: "active", page: 2, pageSize: 20 })).toContain("q=ACME");
    expect(purchaseOrdersPath({ q: "PO-2026", status: "DRAFT", page: 1 })).toContain("status=DRAFT");
    expect(formatMinor(1250)).toContain("12.50");
  });

  it("keeps status labels textual", () => {
    expect(purchaseOrderStatusLabel("ORDERED")).toBe("Ordered");
    expect(purchaseOrderStatusTone("CANCELLED")).toBe("bad");
  });
});
