import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { managerApprovalQueueDecisionSchema, managerApprovalQueueRequestSchema } from "@pos/validation";
import type { Request, Response } from "express";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { createRateLimiter } from "../../common/rate-limit";
import { CsrfGuard } from "../../common/csrf.guard";
import { SessionGuard } from "../../common/session.guard";
import { ManagerApprovalQueueService } from "./manager-approval-queue.service";

const queueLimiter = createRateLimiter(10, 60_000);

function requestId(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return getCorrelationId(headers);
}

@Controller("api/v1/approvals/requests")
@UseGuards(SessionGuard)
export class ManagerApprovalQueueController {
  constructor(@Inject(ManagerApprovalQueueService) private readonly queue: ManagerApprovalQueueService) {}

  @Post()
  @UseGuards(CsrfGuard)
  async request(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = managerApprovalQueueRequestSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid approval request", req); return; }
    const actor = req.auth!;
    try {
      if (await queueLimiter.hit(`${actor.businessId}:approval-queue:${actor.userId}`)) throw new Error("RATE_LIMITED");
      const result = await this.queue.request(actor, requestId(req), parsed.data.action, parsed.data.registerId ?? null, parsed.data.idempotencyKey);
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) {
      const code = e instanceof Error ? e.message : "FORBIDDEN";
      fail(res, statusFor(code, 400), code, "Approval request could not be created", req);
    }
  }

  @Get()
  async list(@Req() req: Request, @Res() res: Response): Promise<void> {
    try { res.json({ requests: await this.queue.list(req.auth!) }); }
    catch (e) { const code = e instanceof Error ? e.message : "FORBIDDEN"; fail(res, statusFor(code, 400), code, "Approval requests could not be loaded", req); }
  }

  @Post(":id/decision")
  @UseGuards(CsrfGuard)
  async decide(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = managerApprovalQueueDecisionSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid approval decision", req); return; }
    const actor = req.auth!;
    try {
      if (await queueLimiter.hit(`${actor.businessId}:approval-queue-decision:${actor.userId}`)) throw new Error("RATE_LIMITED");
      res.json({ request: await this.queue.decide(actor, requestId(req), id, parsed.data) });
    } catch (e) { const code = e instanceof Error ? e.message : "FORBIDDEN"; fail(res, statusFor(code, 400), code, "Approval decision could not be recorded", req); }
  }

  @Post(":id/claim")
  @UseGuards(CsrfGuard)
  async claim(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { res.json(await this.queue.claim(req.auth!, id)); }
    catch (e) { const code = e instanceof Error ? e.message : "FORBIDDEN"; fail(res, statusFor(code, 400), code, "Approval token is unavailable", req); }
  }
}
