import { describe, expect, it } from "vitest";
import {
  productSupplierCreateSchema,
  purchaseOrderCancelSchema,
  purchaseOrderCreateSchema,
  purchaseOrderListSchema,
  purchaseOrderUpdateSchema,
  supplierCreateSchema,
  supplierListSchema,
  supplierUpdateSchema,
} from "../src/procurement.schema";

describe("phase16 supplier schemas", () => {
  it("requires a name", () => {
    expect(() => supplierCreateSchema.parse({ name: "" })).toThrow();
  });
  it("bounds the name", () => {
    expect(() => supplierCreateSchema.parse({ name: "x".repeat(121) })).toThrow();
  });
  it("rejects malformed email", () => {
    expect(() => supplierCreateSchema.parse({ name: "ACME", email: "not-an-email" })).toThrow();
  });
  it("accepts a minimal supplier", () => {
    const parsed = supplierCreateSchema.parse({ name: " ACME Foods " });
    expect(parsed.name).toBe("ACME Foods");
  });
  it("accepts full contact fields and trims them", () => {
    const parsed = supplierCreateSchema.parse({
      name: "ACME Foods",
      code: " acme ",
      contactName: "Maria",
      email: "orders@acme.test",
      phone: "09171234567",
      addressLine1: "1 Mars St",
      city: "Quezon City",
      country: "PH",
      paymentTerms: "Net 30",
      notes: "Deliver weekdays only.",
    });
    expect(parsed.code).toBe("acme");
    expect(parsed.paymentTerms).toBe("Net 30");
  });
  it("rejects oversized text blobs", () => {
    expect(() => supplierCreateSchema.parse({ name: "A", notes: "x".repeat(501) })).toThrow();
    expect(() => supplierCreateSchema.parse({ name: "A", code: "x".repeat(31) })).toThrow();
  });
  it("update requires at least one field", () => {
    expect(() => supplierUpdateSchema.parse({})).toThrow();
  });
  it("list schema defaults and bounds", () => {
    const parsed = supplierListSchema.parse({});
    expect(parsed.status).toBe("active");
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(() => supplierListSchema.parse({ pageSize: 101 })).toThrow();
  });
});

describe("phase16 product-supplier schemas", () => {
  it("requires productId", () => {
    expect(() => productSupplierCreateSchema.parse({ supplierId: "s1" })).toThrow();
  });
  it("rejects negative unit cost", () => {
    expect(() =>
      productSupplierCreateSchema.parse({ productId: "p1", supplierId: "s1", unitCostMinor: -1 }),
    ).toThrow();
  });
  it("rejects non-integer unit cost", () => {
    expect(() =>
      productSupplierCreateSchema.parse({ productId: "p1", supplierId: "s1", unitCostMinor: 10.5 }),
    ).toThrow();
  });
  it("rejects negative or oversized lead time", () => {
    expect(() =>
      productSupplierCreateSchema.parse({ productId: "p1", supplierId: "s1", leadTimeDays: -1 }),
    ).toThrow();
    expect(() =>
      productSupplierCreateSchema.parse({ productId: "p1", supplierId: "s1", leadTimeDays: 3651 }),
    ).toThrow();
  });
  it("accepts a full relationship", () => {
    const parsed = productSupplierCreateSchema.parse({
      productId: "p1",
      supplierSku: "SKU-9",
      unitCostMinor: 12500,
      leadTimeDays: 3,
      isPreferred: true,
    });
    expect(parsed.isPreferred).toBe(true);
  });
});

describe("phase16 purchase order schemas", () => {
  const line = { productId: "p1", quantity: 2, unitCostMinor: 500 };

  it("requires supplier and expectedVersion", () => {
    expect(() => purchaseOrderCreateSchema.parse({ lines: [line] })).toThrow();
    expect(purchaseOrderUpdateSchema.parse({ expectedVersion: 1, lines: [] }).supplierId).toBeUndefined();
    expect(() => purchaseOrderUpdateSchema.parse({ lines: [] })).toThrow();
  });
  it("rejects zero or negative quantity", () => {
    expect(() =>
      purchaseOrderCreateSchema.parse({ supplierId: "s1", lines: [{ ...line, quantity: 0 }] }),
    ).toThrow();
    expect(() =>
      purchaseOrderCreateSchema.parse({ supplierId: "s1", lines: [{ ...line, quantity: -3 }] }),
    ).toThrow();
  });
  it("rejects non-integer quantity", () => {
    expect(() =>
      purchaseOrderCreateSchema.parse({ supplierId: "s1", lines: [{ ...line, quantity: 1.5 }] }),
    ).toThrow();
  });
  it("rejects negative unit cost", () => {
    expect(() =>
      purchaseOrderCreateSchema.parse({ supplierId: "s1", lines: [{ ...line, unitCostMinor: -1 }] }),
    ).toThrow();
  });
  it("rejects duplicate product lines", () => {
    expect(() =>
      purchaseOrderCreateSchema.parse({
        supplierId: "s1",
        lines: [line, { ...line, unitCostMinor: 900 }],
      }),
    ).toThrow();
  });
  it("allows distinct product lines", () => {
    const parsed = purchaseOrderCreateSchema.parse({
      supplierId: "s1",
      lines: [line, { productId: "p2", quantity: 1 }],
    });
    expect(parsed.lines).toHaveLength(2);
  });
  it("omitted unit cost stays undefined for server defaulting", () => {
    const parsed = purchaseOrderCreateSchema.parse({ supplierId: "s1", lines: [{ productId: "p1", quantity: 1 }] });
    expect(parsed.lines[0]!.unitCostMinor).toBeUndefined();
  });
  it("accepts expected date + notes", () => {
    const parsed = purchaseOrderCreateSchema.parse({
      supplierId: "s1",
      branchId: "b1",
      expectedDate: "2026-10-20",
      notes: "Priority restock",
      lines: [line],
    });
    expect(parsed.expectedDate).toBe("2026-10-20");
  });
  it("rejects malformed expected date", () => {
    expect(() =>
      purchaseOrderCreateSchema.parse({ supplierId: "s1", expectedDate: "October-ish", lines: [line] }),
    ).toThrow();
  });
  it("bounds line count", () => {
    const lines = Array.from({ length: 101 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
    expect(() => purchaseOrderCreateSchema.parse({ supplierId: "s1", lines })).toThrow();
  });
  it("cancel requires a reason and expectedVersion", () => {
    expect(() => purchaseOrderCancelSchema.parse({ expectedVersion: 1 })).toThrow();
    expect(() => purchaseOrderCancelSchema.parse({ reason: "ab", expectedVersion: 1 })).toThrow();
    expect(() => purchaseOrderCancelSchema.parse({ reason: "Duplicate order" })).toThrow();
    const parsed = purchaseOrderCancelSchema.parse({ reason: " Duplicate order ", expectedVersion: 2 });
    expect(parsed.reason).toBe("Duplicate order");
    expect(parsed.expectedVersion).toBe(2);
  });
  it("list schema defaults", () => {
    const parsed = purchaseOrderListSchema.parse({});
    expect(parsed.status).toBe("all");
    expect(parsed.page).toBe(1);
    expect(() => purchaseOrderListSchema.parse({ status: "RECEIVED" })).toThrow();
  });
  it("rejects client-owned totals and relationship foreign keys", () => {
    expect(() => purchaseOrderCreateSchema.parse({ supplierId: "s1", lines: [], subtotalMinor: 999 })).toThrow();
    expect(() => productSupplierCreateSchema.parse({ productId: "p1", supplierId: "s1" })).toThrow();
  });
});
