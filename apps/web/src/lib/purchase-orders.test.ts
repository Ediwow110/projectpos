import { describe, expect, it } from "vitest";
import { supplierReturnActions } from "./purchase-orders";

describe("supplier return actions", () => {
  it("exposes post and cancel only for writable drafts", () => {
    expect(supplierReturnActions("DRAFT", true)).toEqual({ canPost: true, canCancel: true });
    expect(supplierReturnActions("POSTED", true)).toEqual({ canPost: false, canCancel: false });
    expect(supplierReturnActions("CANCELLED", true)).toEqual({ canPost: false, canCancel: false });
  });

  it("does not expose supplier-return writes to cashiers", () => {
    expect(supplierReturnActions("DRAFT", false)).toEqual({ canPost: false, canCancel: false });
  });
});
