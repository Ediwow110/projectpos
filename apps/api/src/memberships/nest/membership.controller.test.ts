import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { isReAuthFresh } from "../../auth/sessions";
import { MembershipController } from "./membership.controller";

// Mirrors AuthService.checkReAuth so the controller is tested against the
// session-freshness rule the production step-up guard applies.
const auth = {
  permissionsForRequest: () => ["user.manage"],
  checkReAuth: (authenticatedAt: Date) => {
    if (!isReAuthFresh(authenticatedAt)) throw new Error("AUTH_REAUTH_REQUIRED");
  },
};

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

function request(authenticatedAt: Date) {
  return {
    auth: { businessId: "business-1", userId: "owner-1", role: "owner", authenticatedAt },
    headers: {},
  } as unknown as Request;
}

describe("MembershipController manager-PIN enrollment step-up", () => {
  it("refuses to enroll an approval PIN for a session that is no longer freshly authenticated", async () => {
    const setApprovalPin = vi.fn().mockResolvedValue({ ok: true });
    const controller = new MembershipController({ setApprovalPin } as never, auth as never);
    const stale = new Date(Date.now() - 16 * 60 * 1000);
    const res = response();

    await controller.setApprovalPin(request(stale), res, "membership-1", { pin: "482615" });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "AUTH_REAUTH_REQUIRED" }));
    expect(setApprovalPin).not.toHaveBeenCalled();
  });

  it("still enrolls the PIN over the other mutations' fresh session", async () => {
    const setApprovalPin = vi.fn().mockResolvedValue({ ok: true });
    const controller = new MembershipController({ setApprovalPin } as never, auth as never);
    const res = response();

    await controller.setApprovalPin(request(new Date()), res, "membership-1", { pin: "482615" });

    expect(setApprovalPin).toHaveBeenCalledWith("business-1", "owner-1", expect.any(String), ["user.manage"], "membership-1", "482615");
  });
});
