import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  publicCatalogQuerySchema,
  publicOrderCreateSchema,
  publicOrderDraftSchema,
  publicOrderPaymentRetrySchema,
  publicOrderStatusSchema,
  publicOrderSubmitSchema,
  publicStorefrontQuerySchema,
} from "@pos/validation";
import { getCorrelationId } from "../../correlation";
import type { DbPort } from "../../common/db.port";
import { fail, failFromError } from "../../common/http-helpers";
import { FirstPartyOriginGuard } from "../../common/first-party-origin.guard";
import { createRateLimiter } from "../../common/rate-limit";
import { HUMAN_VERIFICATION_PORT, type HumanVerificationPort } from "../../common/human-verification";
import { SalesService } from "../../sales/nest/sales.service";
import { OrderSaleService } from "../order-sale-service";
import { OrderAccessService } from "../order-access-service";
import { OrderNotificationService } from "../order-notification-service";
import { OrderService } from "../order-service";

const mutationLimiter = createRateLimiter(30, 60_000);
const statusLimiter = createRateLimiter(120, 60_000);

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  }
  return getCorrelationId(headers);
}

function idempotencyKey(req: Request): string {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key?.trim() || key.length > 200) throw new Error("VALIDATION");
  return key.trim();
}

function ipKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function checkoutCookie(req: Request): string {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const token = cookies?.["nexpos_checkout"];
  if (!token) throw new Error("NOT_FOUND");
  return token;
}

function setCheckoutCookie(res: Response, token: string): void {
  res.cookie("nexpos_checkout", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/v1/public/orders",
    maxAge: 2 * 60 * 60_000,
  });
}

@Controller("api/v1/public")
export class PublicOrderController {
  private readonly access: OrderAccessService;
  private readonly notifications: OrderNotificationService;
  private readonly orderSales: OrderSaleService;

  constructor(
    @Inject("DbPort") private readonly db: DbPort,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject("OrderNotificationService") notifications: OrderNotificationService,
    @Inject(HUMAN_VERIFICATION_PORT) private readonly human: HumanVerificationPort,
  ) {
    this.access = new OrderAccessService(db);
    this.notifications = notifications;
    this.orderSales = new OrderSaleService(db);
  }

  private async rate(req: Request, res: Response, scope: string, subject: string): Promise<boolean> {
    if (await mutationLimiter.hit(scope + ":" + subject + ":" + ipKey(req))) {
      fail(res, 429, "RATE_LIMITED", "Too many requests", req);
      return false;
    }
    return true;
  }

  private async humanCheck(req: Request, token: string | undefined, action: string): Promise<void> {
    if (!this.human.enabled) return;
    if (!(await this.human.verify({ token: token ?? "", ip: ipKey(req), action }))) throw new Error("FORBIDDEN");
  }

  @Get("storefront")
  async storefront(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    const parsed = publicStorefrontQuerySchema.safeParse(query);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid storefront", req); return; }
    try { res.json(await this.orders.publicStorefront(parsed.data.key)); }
    catch (error) { failFromError(res, error, "Storefront unavailable", req); }
  }

  @Get("storefront/catalog")
  async catalog(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    const parsed = publicCatalogQuerySchema.safeParse(query);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid catalog query", req); return; }
    try {
      const { key, ...rest } = parsed.data;
      res.json(await this.orders.publicCatalog(key, rest));
    } catch (error) { failFromError(res, error, "Catalog unavailable", req); }
  }

  @Post("orders")
  @UseGuards(FirstPartyOriginGuard)
  async create(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = publicOrderCreateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid Order payload", req); return; }
    if (!(await this.rate(req, res, "create", parsed.data.storefrontKey))) return;
    try {
      await this.humanCheck(req, parsed.data.captchaToken, "public_order_create");
      const out = await this.orders.createPublicDraft(parsed.data.storefrontKey, idempotencyKey(req), rid(req));
      setCheckoutCookie(res, out.checkoutToken);
      res.status(out.replayed ? 200 : 201).json({ id: out.order.id, status: out.order.status, version: out.order.version, replayed: out.replayed });
    } catch (error) { failFromError(res, error, "Order create failed", req); }
  }

  @Patch("orders/:id/draft")
  @UseGuards(FirstPartyOriginGuard)
  async patchDraft(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = publicOrderDraftSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid draft", req); return; }
    if (!(await this.rate(req, res, "draft", id))) return;
    try {
      const access = await this.access.authenticate(checkoutCookie(req), "CHECKOUT", id);
      const order = await this.orders.patchPublicDraft(access.businessId, id, parsed.data);
      res.json({ id: order.id, status: order.status, version: order.version, branchId: order.branchId, fulfillmentMode: order.fulfillmentMode });
    } catch (error) { failFromError(res, error, "Order update failed", req); }
  }

  @Post("orders/:id/submit")
  @UseGuards(FirstPartyOriginGuard)
  async submit(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = publicOrderSubmitSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid submit payload", req); return; }
    if (!(await this.rate(req, res, "submit", id))) return;
    try {
      const access = await this.access.authenticate(checkoutCookie(req), "CHECKOUT", id);
      await this.humanCheck(req, parsed.data.captchaToken, "public_order_submit");
      if (parsed.data.paymentMode === "PREPAID" && !this.sales.isPayMongoConfigured()) throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
      const key = idempotencyKey(req);
      const { captchaToken: _captcha, ...submitInput } = parsed.data;
      void _captcha;
      const submitted = await this.orders.submitPublicOrder(access.businessId, id, submitInput, key, rid(req));
      if (!submitted.replayed && !this.notifications.hasOutbox()) {
        await this.notifications.sendExistingToken(access.businessId, id, "SUBMITTED", submitted.statusToken);
      }
      let checkoutUrl: string | undefined;
      if (submitInput.paymentMode === "PREPAID") {
        const sale = await this.orderSales.createSaleFromSubmittedOrder(access.businessId, "public", rid(req), id);
        const checkout = await this.sales.startPayMongoCheckout(
          access.businessId,
          "public",
          rid(req),
          sale.id,
          submitInput.paymentMethod!,
          key + ":paymongo",
          process.env["WEB_URL"] ?? "http://localhost:3100",
          { successPath: "/order-status?payment=success", cancelPath: "/order-status?payment=cancelled" },
        );
        checkoutUrl = checkout.checkoutUrl;
      }
      const order = await this.db.findOrderById(id, access.businessId);
      res.status(200).json({ order, statusToken: submitted.statusToken, ...(checkoutUrl ? { checkoutUrl } : {}), replayed: submitted.replayed });
    } catch (error) { failFromError(res, error, "Order submit failed", req); }
  }

  @Post("orders/:id/payment/retry")
  @UseGuards(FirstPartyOriginGuard)
  async retryPayment(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = publicOrderPaymentRetrySchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid payment retry", req); return; }
    if (!(await this.rate(req, res, "retry", id))) return;
    try {
      const access = await this.access.authenticate(checkoutCookie(req), "CHECKOUT", id);
      const order = await this.db.findOrderById(id, access.businessId);
      if (!order || order.status !== "SUBMITTED" || order.paymentMode !== "PREPAID" || !order.saleId) throw new Error("INVALID_STATE");
      const out = await this.sales.startPayMongoCheckout(
        access.businessId, "public", rid(req), order.saleId, parsed.data.paymentMethod,
        idempotencyKey(req) + ":paymongo", process.env["WEB_URL"] ?? "http://localhost:3100",
        { successPath: "/order-status?payment=success", cancelPath: "/order-status?payment=cancelled" },
      );
      res.status(200).json({ checkoutUrl: out.checkoutUrl, replayed: out.replayed });
    } catch (error) { failFromError(res, error, "Payment retry failed", req); }
  }

  @Post("orders/status")
  async status(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = publicOrderStatusSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid status token", req); return; }
    if (await statusLimiter.hit("status:" + ipKey(req))) { fail(res, 429, "RATE_LIMITED", "Too many requests", req); return; }
    try { res.status(200).json(await this.orders.publicStatus(parsed.data.token)); }
    catch (error) { failFromError(res, error, "Order not found", req); }
  }
}
