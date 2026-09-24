import { Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { printerEnrollSchema, printJobSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { PrintService } from "./print.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class PrintController {
  constructor(
    @Inject(PrintService) private readonly printers: PrintService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get("printers")
  async listPrinters(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      res.status(200).json({ items: await this.printers.listPrinters(req.auth!.businessId) });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Printer fetch failed", req);
    }
  }

  @Post("printers")
  @UseGuards(CsrfGuard)
  async enrollPrinter(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = printerEnrollSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid printer payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.printers.enrollPrinter(auth.businessId, auth.userId, rid(req), {
          name: parsed.data.name,
          branchId: parsed.data.branchId,
          width: parsed.data.width,
          connection: parsed.data.connection,
        }, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Printer enrollment failed", req);
    }
  }

  @Post("print-jobs")
  @UseGuards(CsrfGuard)
  async queueJob(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = printJobSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid print job payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.printers.queueJob(auth.businessId, auth.userId, rid(req), {
          printerId: parsed.data.printerId,
          receiptNo: parsed.data.receiptNo,
          layout: parsed.data.layout,
        }, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Print queue failed", req);
    }
  }

  @Get("print-jobs/next")
  async nextJob(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      const printerId = query["printerId"];
      if (!printerId) {
        fail(res, 400, "VALIDATION", "printerId required", req);
        return;
      }
      res.status(200).json(await this.printers.claimNextJob(auth.businessId, printerId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Print pickup failed", req);
    }
  }
}
