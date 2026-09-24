import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { webhookEventSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { BillingService } from "./billing.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get("billing/subscription")
  @UseGuards(SessionGuard)
  async subscription(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      res.status(200).json(await this.billing.getSubscription(req.auth!.businessId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Subscription fetch failed", req);
    }
  }

  @Get("billing/invoices")
  @UseGuards(SessionGuard)
  async invoices(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const auth = req.auth!;
      const rows = await this.billing.listInvoices(auth.businessId);
      res.status(200).json({ items: rows });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Invoice fetch failed", req);
    }
  }

  @Post("billing/webhooks/:provider")
  async webhook(
    @Req() req: Request,
    @Res() res: Response,
    @Param("provider") provider: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = webhookEventSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid webhook payload", req);
      return;
    }
    try {
      const sig = req.headers["x-webhook-signature"];
      const signature = Array.isArray(sig) ? sig[0] : sig;
      const { eventId, type, ...rest } = parsed.data;
      // Prefer the untouched request bytes: providers sign exactly what they
      // sent, and re-serializing the parsed payload would break any provider
      // that orders keys or formats whitespace differently.
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      const out = await this.billing.ingestWebhook(
        provider, eventId, type, rest, signature, rid(req),
        raw ? raw.toString("utf8") : undefined,
      );
      res.status(200).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Webhook ingest failed", req);
    }
  }
}
