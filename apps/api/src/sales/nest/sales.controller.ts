import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  PAYMENT_METHODS,
  completeSchema,
  draftCreateSchema,
  reconcileSchema,
  refundRequestSchema,
  salesQuerySchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { toCsv } from "../../common/csv";
import { createRateLimiter } from "../../common/rate-limit";
import { AuthService } from "../../auth/nest/auth.service";
import { SalesService } from "./sales.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

function idemKey(req: Request): string | null {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.trim() === "") return null;
  return key;
}

const SELL_ROLES = new Set(["owner", "manager", "cashier"]);

// Generous per-business ceiling on money-moving commands: abuse brake that
// stays far above legitimate cashier throughput (and above every contract
// suite's per-instance call count).
const moneyLimiter = createRateLimiter(60, 60_000);

@Controller("api/v1")
@UseGuards(SessionGuard)
export class SalesController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  @Post("sales/drafts")
  @UseGuards(CsrfGuard)
  async createDraft(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = draftCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid draft payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const sale = await this.sales.createDraft(
        auth.businessId,
        auth.userId,
        rid(req),
        {
          lines: parsed.data.lines,
          orderDiscountMinor: parsed.data.orderDiscountMinor,
          customerId: parsed.data.customerId,
          customerName: parsed.data.customerName,
          notes: parsed.data.notes,
          registerId: parsed.data.registerId,
        },
        this.perms(req),
      );
      res.status(201).json(sale);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Draft creation failed", req);
    }
  }

  @Post("sales/complete")
  @UseGuards(CsrfGuard)
  async complete(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!SELL_ROLES.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Sale completion not permitted for this role", req);
      return;
    }
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = completeSchema.safeParse({ ...(body as Record<string, unknown>), idempotencyKey: key });
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid complete payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (moneyLimiter.hit(`${auth.businessId}:complete`)) {
        fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
        return;
      }
      const { sale, replayed } = await this.sales.completeSale(
        auth.businessId,
        auth.userId,
        rid(req),
        parsed.data.saleId,
        {
          payments: parsed.data.payments.map((p) => ({
            method: p.method,
            amountMinor: p.amountMinor,
            providerRef: p.providerRef,
          })),
          key,
          granted: this.perms(req),
          registerId: parsed.data.registerId,
        },
      );
      if (sale.status === "PAYMENT_UNKNOWN") {
        res.status(202).json({
          code: "PAYMENT_UNKNOWN",
          message: "Payment status unknown. Reconcile via POST /api/v1/payments/:id/reconcile. Do not retry with a new key.",
          correlationId: rid(req),
          sale,
        });
        return;
      }
      res.status(replayed ? 200 : 201).json({ ...sale, replayed });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sale completion failed", req);
    }
  }

  @Get("sales")
  async listSales(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = salesQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid sales query", req);
      return;
    }
    try {
      const page = await this.sales.listSales(req.auth!.businessId, {
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        status: parsed.data.status,
        customerId: parsed.data.customerId,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
      });
      res.json(page);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sales fetch failed", req);
    }
  }

  @Get("sales/export")
  async exportSales(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    if (!this.perms(req).includes("export.run")) {
      fail(res, 403, "FORBIDDEN", "Export requires export.run", req);
      return;
    }
    if (query["format"] !== "csv") {
      fail(res, 400, "VALIDATION", "Only format=csv is supported", req);
      return;
    }
    const parsed = salesQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid sales query", req);
      return;
    }
    try {
      const { headers, rows } = await this.sales.buildSalesExport(req.auth!.businessId, {
        status: parsed.data.status,
        customerId: parsed.data.customerId,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
      });
      res.status(200).set("Content-Type", "text/csv; charset=utf-8").send(toCsv(headers, rows));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sales export failed", req);
    }
  }

  @Get("sales/:id")
  async getSale(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      res.json(await this.sales.getSale(req.auth!.businessId, id, this.perms(req), req.auth!.role));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sale fetch failed", req);
    }
  }

  @Post("sales/:id/hold")
  @UseGuards(CsrfGuard)
  async hold(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json(await this.sales.holdSale(auth.businessId, auth.userId, rid(req), id));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Hold failed", req);
    }
  }

  @Post("sales/:id/resume")
  @UseGuards(CsrfGuard)
  async resume(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json(await this.sales.resumeSale(auth.businessId, auth.userId, rid(req), id));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Resume failed", req);
    }
  }

  @Post("sales/:id/void")
  @UseGuards(CsrfGuard)
  async void(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const reason = (body as { reason?: unknown } | null)?.reason;
    if (typeof reason !== "string" || reason.trim().length < 3) {
      fail(res, 400, "VALIDATION", "Void reason required", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.json(
        await this.sales.voidSale(auth.businessId, auth.userId, rid(req), id, reason, this.perms(req)),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Void failed", req);
    }
  }

  @Post("sales/:id/refund-request")
  @UseGuards(CsrfGuard)
  async refundRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = refundRequestSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid refund payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.sales.requestRefund(
          auth.businessId,
          auth.userId,
          rid(req),
          id,
          parsed.data.reason,
          key,
          this.perms(req),
        ),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Refund request failed", req);
    }
  }

  @Post("payments/:id/reconcile")
  @UseGuards(CsrfGuard)
  async reconcile(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.perms(req).includes("sale.refund")) {
      fail(res, 403, "FORBIDDEN", "Reconcile requires sale.refund", req);
      return;
    }
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = reconcileSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid reconcile payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (moneyLimiter.hit(`${auth.businessId}:reconcile`)) {
        fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
        return;
      }
      res.status(200).json(
        await this.sales.reconcilePayment(
          auth.businessId,
          auth.userId,
          rid(req),
          id,
          parsed.data.outcome,
          key,
        ),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Reconcile failed", req);
    }
  }

  @Get("payments/methods")
  async paymentMethods(@Req() req: Request, @Res() res: Response): Promise<void> {
    void req;
    res.json({ methods: [...PAYMENT_METHODS] });
  }

  @Get("receipts/:saleId")
  async receipt(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      res.json(await this.sales.receiptData(req.auth!.businessId, saleId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt fetch failed", req);
    }
  }
}
