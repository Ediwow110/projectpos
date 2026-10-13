import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { ReceiptsController } from "./receipts.controller";

describe("ReceiptsController lookup scope", () => {
  it("hides receipts outside the active branch for unrestricted staff", async () => {
    const sales = {
      lookupReceipt: vi.fn().mockResolvedValue({
        receiptNo: "SOUTH-100", saleId: "sale-south", branchId: "south", registerId: "till-south",
      }),
    };
    const auth = { permissionsForRequest: vi.fn().mockReturnValue(["customer_concern.request"]) };
    const controller = new ReceiptsController(sales as never, auth as never, {} as never, {} as never);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const request = {
      auth: {
        businessId: "business-1", role: "cashier", userId: "cashier-1", activeBranchId: "north",
        allowedBranchIds: null, allowedRegisterIds: null,
      },
      headers: {},
    } as unknown as Request;

    await controller.lookup(request, response, "SOUTH-100");

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("hides receipts assigned to another register", async () => {
    const sales = {
      lookupReceipt: vi.fn().mockResolvedValue({
        receiptNo: "NORTH-100", saleId: "sale-north", branchId: "north", registerId: "till-other",
      }),
    };
    const auth = { permissionsForRequest: vi.fn().mockReturnValue(["customer_concern.request"]) };
    const controller = new ReceiptsController(sales as never, auth as never, {} as never, {} as never);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const request = {
      auth: {
        businessId: "business-1", role: "cashier", userId: "cashier-1", activeBranchId: "north",
        allowedBranchIds: ["north"], allowedRegisterIds: ["till-assigned"],
      },
      headers: {},
    } as unknown as Request;

    await controller.lookup(request, response, "NORTH-100");

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});
