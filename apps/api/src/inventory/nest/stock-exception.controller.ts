import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { stockExceptionReportSchema } from "@pos/validation";
import { AuthService } from "../../auth/nest/auth.service";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { fail, failFromError } from "../../common/http-helpers";
import { getCorrelationId } from "../../correlation";
import { StockExceptionService } from "./stock-exception.service";

function requestId(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return getCorrelationId(headers);
}

@Controller("api/v1/inventory/stock-exceptions")
@UseGuards(SessionGuard)
export class StockExceptionController {
  constructor(
    @Inject(StockExceptionService) private readonly service: StockExceptionService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.auth.permissionsForRequest(req.auth!).includes("inventory.adjust")) {
      fail(res, 403, "FORBIDDEN", "Inventory risk register requires inventory access", req);
      return;
    }
    try { res.json({ items: await this.service.list(req.auth!.businessId, req.auth!) }); }
    catch (error) { failFromError(res, error, "Stock risks could not be loaded", req); }
  }

  @Post()
  @UseGuards(CsrfGuard)
  async report(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = stockExceptionReportSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid stock risk report", req); return; }
    const rawKey = req.headers["idempotency-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key || key.length > 128) { fail(res, 400, "VALIDATION", "Idempotency-Key required", req); return; }
    try {
      const auth = req.auth!;
      const result = await this.service.report(auth.businessId, auth.userId, requestId(req), key, parsed.data,
        this.auth.permissionsForRequest(auth), auth);
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) { failFromError(res, error, "Stock risk report failed", req); }
  }

  @Post(":id/dispose")
  @UseGuards(CsrfGuard)
  async dispose(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json(await this.service.dispose(auth.businessId, auth.userId, requestId(req), id,
        this.auth.permissionsForRequest(auth), auth));
    } catch (error) { failFromError(res, error, "Stock disposal failed", req); }
  }
}
