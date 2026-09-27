import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { fail, statusFor } from "../../common/http-helpers";
import { SalesService } from "./sales.service";

// FR-RECEIPT-01: the share link is public by design — the token is the
// credential, exactly like the customer display feed. No SessionGuard here.
@Controller("api/v1")
export class ReceiptShareController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Get("receipts/shared/:token")
  async shared(
    @Req() req: Request,
    @Res() res: Response,
    @Param("token") token: string,
  ): Promise<void> {
    try {
      res.status(200).json(await this.sales.sharedReceipt(token));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Shared receipt unavailable", req);
    }
  }
}
