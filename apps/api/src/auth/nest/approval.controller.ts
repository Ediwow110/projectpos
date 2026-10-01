import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { managerApprovalRequestSchema } from "@pos/validation";
import type { Request, Response } from "express";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { createRateLimiter } from "../../common/rate-limit";
import { CsrfGuard } from "../../common/csrf.guard";
import { SessionGuard } from "../../common/session.guard";
import { AuthService } from "./auth.service";
import { ManagerApprovalPolicyService } from "./manager-approval-policy.service";

const approvalLimiter = createRateLimiter(5, 60_000);

function requestId(request: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ApprovalController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ManagerApprovalPolicyService) private readonly policy: ManagerApprovalPolicyService,
  ) {}

  @Post("approvals/manager")
  @UseGuards(CsrfGuard)
  async createManagerApproval(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = managerApprovalRequestSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid manager approval payload", req);
      return;
    }
    const actor = req.auth!;
    try {
      const requirement = await this.policy.resolveRequirement(actor.businessId, actor.userId, parsed.data.action);
      if (!requirement || parsed.data.permission !== requirement.permission) {
        fail(res, 403, "FORBIDDEN", "Manager approval is not available for this action", req);
        return;
      }
      const granted = this.auth.rolePermissions(actor.role);
      if (granted.includes(requirement.permission) && !requirement.requireDistinctApprover) {
        fail(res, 403, "FORBIDDEN", "Manager approval is not available for this session", req);
        return;
      }
      if (await approvalLimiter.hit(`${actor.businessId}:manager-approval:${actor.userId}`)) {
        fail(res, 429, "RATE_LIMITED", "Too many approval attempts", req);
        return;
      }
      const result = await this.auth.mintManagerApproval(actor.businessId, actor.userId, requestId(req), {
        email: parsed.data.email,
        ...(parsed.data.pin ? { pin: parsed.data.pin } : {}),
        ...(parsed.data.password ? { password: parsed.data.password } : {}),
        permission: requirement.permission,
        fingerprint: requirement.fingerprint,
      });
      res.status(201).json({
        token: result.token,
        expiresAt: result.expiresAt,
        approver: result.approver,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "AUTH_INVALID_CREDENTIALS";
      fail(res, statusFor(code, 400), code, "Manager approval failed", req);
    }
  }
}
