import { Controller, Get, Inject, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionGuard } from "../../common/session.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { ExportService, LEDGER_HEADERS, ledgerCsvLine, ledgerRange } from "./export.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ExportController {
  constructor(
    @Inject(ExportService) private readonly exports: ExportService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  // Streams the ledger page by page: the response body is written as each
  // bounded page of journal rows is produced, so neither the service nor the
  // response holds the whole export in memory.
  @Get("exports/ledger.csv")
  async ledger(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    if (!this.auth.permissionsForRequest(req.auth!).includes("export.run")) {
      fail(res, 403, "FORBIDDEN", "Export requires export.run", req);
      return;
    }
    if (query["format"] !== "csv") {
      fail(res, 400, "VALIDATION", "Only format=csv is supported", req);
      return;
    }
    const auth = req.auth!;
    try {
      // Validate the range before any header goes out: an invalid range is a
      // 400, not a 200 with an empty body.
      ledgerRange({ dateFrom: query["dateFrom"], dateTo: query["dateTo"] });
    } catch (e) {
      failFromError(res, e, "Ledger export failed", req);
      return;
    }
    try {
      const iterator = this.exports
        .streamJournalRows(auth.businessId, auth.userId, rid(req), {
          dateFrom: query["dateFrom"],
          dateTo: query["dateTo"],
        })
        [Symbol.asyncIterator]();
      // Headers go out before the first page: an empty ledger is a valid
      // header-only CSV, not an error.
      res.status(200).set("Content-Type", "text/csv; charset=utf-8");
      res.write("\uFEFF" + LEDGER_HEADERS + "\n");
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        for (const row of next.value) res.write(ledgerCsvLine(row) + "\n");
      }
      res.end();
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      failFromError(res, e, "Ledger export failed", req);
    }
  }
}
