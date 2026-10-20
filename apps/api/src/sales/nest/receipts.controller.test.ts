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

describe("ReceiptsController direct receipt access", () => {
  const actions = ["receipt", "receiptDownload", "receiptShare", "receiptEmail", "receiptDeliveries"] as const;

  async function invoke(
    action: typeof actions[number],
    controller: ReceiptsController,
    request: Request,
    response: Response,
  ): Promise<void> {
    if (action === "receipt") return controller.receipt(request, response, "sale-south");
    if (action === "receiptDownload") return controller.receiptDownload(request, response, "sale-south");
    if (action === "receiptShare") return controller.receiptShare(request, response, "sale-south");
    if (action === "receiptEmail") return controller.receiptEmail(request, response, "sale-south", { to: "qa@example.test" });
    return controller.receiptDeliveries(request, response, "sale-south");
  }

  function fixture(
    branchId: string,
    permissions: string[],
    allowedRegisterIds: string[] | null = null,
  ) {
    const sales = {
      receiptData: vi.fn().mockResolvedValue({ branchId }),
      downloadReceipt: vi.fn().mockResolvedValue({ filename: "receipt.txt", text: "receipt" }),
      createShareToken: vi.fn().mockResolvedValue({ token: "fake", expiresAt: new Date() }),
      sendReceiptEmail: vi.fn().mockResolvedValue({ replayed: false, delivery: { status: "SENT" } }),
      listReceiptDeliveries: vi.fn().mockResolvedValue({ items: [] }),
    };
    const db = {
      findSaleById: vi.fn().mockResolvedValue({ id: "sale-south", branchId, registerId: "south-register" }),
    };
    const auth = { permissionsForRequest: vi.fn().mockReturnValue(permissions) };
    const controller = new ReceiptsController(sales as never, auth as never, {} as never, db as never);
    const response = {
      status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const request = {
      auth: {
        businessId: "business-1", role: permissions.length ? "cashier" : "inventory",
        userId: "staff-1", activeBranchId: "north",
        allowedBranchIds: null, allowedRegisterIds,
      },
      headers: { "idempotency-key": "receipt-test-key" },
    } as unknown as Request;
    return { sales, db, controller, request, response };
  }

  it.each(actions)("blocks direct %s across the active branch for legacy unrestricted staff", async (action) => {
    const { sales, controller, request, response } = fixture("south", ["customer_concern.request"]);
    await invoke(action, controller, request, response);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(sales.receiptData).not.toHaveBeenCalled();
    expect(sales.downloadReceipt).not.toHaveBeenCalled();
    expect(sales.createShareToken).not.toHaveBeenCalled();
    expect(sales.sendReceiptEmail).not.toHaveBeenCalled();
    expect(sales.listReceiptDeliveries).not.toHaveBeenCalled();
  });

  it.each(actions)("blocks direct %s for inventory staff without receipt permissions", async (action) => {
    const { sales, controller, request, response } = fixture("north", []);
    await invoke(action, controller, request, response);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(sales.receiptData).not.toHaveBeenCalled();
    expect(sales.downloadReceipt).not.toHaveBeenCalled();
    expect(sales.createShareToken).not.toHaveBeenCalled();
    expect(sales.sendReceiptEmail).not.toHaveBeenCalled();
    expect(sales.listReceiptDeliveries).not.toHaveBeenCalled();
  });

  it.each(actions)("allows direct %s for authorized staff on the active branch", async (action) => {
    const { sales, controller, request, response } = fixture("north", ["customer_concern.request"]);
    await invoke(action, controller, request, response);
    expect(response.status).not.toHaveBeenCalledWith(403);
    expect(response.status).not.toHaveBeenCalledWith(404);
    const called = {
      receipt: sales.receiptData,
      receiptDownload: sales.downloadReceipt,
      receiptShare: sales.createShareToken,
      receiptEmail: sales.sendReceiptEmail,
      receiptDeliveries: sales.listReceiptDeliveries,
    };
    expect(called[action]).toHaveBeenCalledOnce();
  });

  it.each(actions)("blocks direct %s outside an explicitly assigned register", async (action) => {
    const { sales, controller, request, response } = fixture("north", ["customer_concern.request"], ["north-register"]);
    await invoke(action, controller, request, response);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(sales.receiptData).not.toHaveBeenCalled();
    expect(sales.createShareToken).not.toHaveBeenCalled();
    expect(sales.sendReceiptEmail).not.toHaveBeenCalled();
  });
});
