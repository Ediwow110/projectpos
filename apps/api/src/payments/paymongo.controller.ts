import { Body, Controller, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { getCorrelationId } from "../correlation";
import { fail, statusFor } from "../common/http-helpers";
import { SalesService } from "../sales/nest/sales.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1/payments/paymongo")
export class PayMongoController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Post("webhook")
  async webhook(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    try {
      const signatureHeader = req.headers["paymongo-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!raw) {
        fail(res, 400, "VALIDATION", "Raw webhook body unavailable", req);
        return;
      }
      const out = await this.sales.handlePayMongoWebhook(
        raw.toString("utf8"),
        signature,
        body,
        rid(req),
      );
      res.status(200).json(out);
    } catch (error) {
      const code = error instanceof Error ? error.message : "VALIDATION";
      fail(res, statusFor(code), code, "PayMongo webhook failed", req);
    }
  }
}
