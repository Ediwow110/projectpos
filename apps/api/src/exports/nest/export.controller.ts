import { Controller, Get, Inject, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionGuard } from "../../common/session.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError, statusFor } from "../../common/http-helpers";
import { toCsv } from "../../common/csv";
import { AuthService } from "../../auth/nest/auth.service";
import { ExportService } from "./export.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ExportController {
  constructor(
    @Inject(ExportService) private readonly exports: ExportService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get("exports/ledger.csv")
  async ledger(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    if (!this.auth.rolePermissions(req.auth!.role).includes("export.run")) {
      fail(res, 403, "FORBIDDEN", "Export requires export.run", req);
      return;
    }
    if (query["format"] !== "csv") {
      fail(res, 400, "VALIDATION", "Only format=csv is supported", req);
      return;
    }
    try {
      const auth = req.auth!;
      const { headers, rows } = await this.exports.buildLedger(auth.businessId, auth.userId, rid(req), {
        dateFrom: query["dateFrom"],
        dateTo: query["dateTo"],
      });
      res.status(200).set("Content-Type", "text/csv; charset=utf-8").send(toCsv(headers, rows));
    } catch (e) {
      failFromError(res, e, "Ledger export failed", req);
    }
  }
}
