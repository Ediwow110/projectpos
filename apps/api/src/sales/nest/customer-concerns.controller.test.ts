import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { DbPort } from "../../common/db.port";
import { CustomerConcernsController } from "./customer-concerns.controller";

describe("CustomerConcernsController owner re-authentication", () => {
  it("rejects a stale owner session before deciding an owner-review case", async () => {
    const concernService = {
      find: vi.fn().mockResolvedValue({
        id: "case-1", requesterId: "cashier", branchId: null, registerId: null, status: "OWNER_REVIEW",
      }),
      decide: vi.fn(),
    };
    const auth = {
      permissionsForRequest: vi.fn().mockReturnValue(["customer_concern.review"]),
      checkReAuth: vi.fn(() => { throw new Error("AUTH_REAUTH_REQUIRED"); }),
    };
    const controller = new CustomerConcernsController(concernService as never, auth as never, {} as DbPort);
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const request = {
      auth: { businessId: "business-1", userId: "owner-1", role: "owner", authenticatedAt: new Date(0) },
      headers: {},
    } as unknown as Request;

    await controller.decide(request, response, "case-1", { decision: "APPROVED", reason: "Owner approval" });

    expect(auth.checkReAuth).toHaveBeenCalledWith(new Date(0));
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "AUTH_REAUTH_REQUIRED" }));
    expect(concernService.decide).not.toHaveBeenCalled();
  });

  it("filters unrestricted reviewers to their active branch", async () => {
    const concernService = {
      list: vi.fn().mockResolvedValue([
        { id: "case-north", requesterId: "cashier-1", branchId: "north", registerId: "till-north" },
        { id: "case-south", requesterId: "cashier-2", branchId: "south", registerId: "till-south" },
      ]),
    };
    const auth = { permissionsForRequest: vi.fn().mockReturnValue(["customer_concern.review"]) };
    const db = {
      listRegisters: vi.fn().mockResolvedValue([]),
      findBranchById: vi.fn(async (id: string) => ({ id, name: id === "north" ? "North" : "South" })),
      findMembership: vi.fn().mockResolvedValue({ id: "membership" }),
      findUserById: vi.fn(async (id: string) => ({ id, name: id })),
    };
    const controller = new CustomerConcernsController(concernService as never, auth as never, db as never);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const request = {
      auth: { businessId: "business-1", userId: "manager-1", role: "manager", activeBranchId: "north", allowedBranchIds: null, allowedRegisterIds: null },
      headers: {},
    } as unknown as Request;

    await controller.list(request, response);

    expect(response.json).toHaveBeenCalledWith([expect.objectContaining({ id: "case-north", branchName: "North" })]);
  });
});
