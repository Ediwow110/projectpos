import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  fulfillmentActionSchema,
  fulfillmentAssignSchema,
  fulfillmentCollectSchema,
  orderLinkCustomerSchema,
  orderListSchema,
  orderStaffCancelSchema,
  orderStaffVersionSchema,
} from "@pos/validation";
import { AuthService } from "../../auth/nest/auth.service";
import { fail, failFromError } from "../../common/http-helpers";
import { CsrfGuard } from "../../common/csrf.guard";
import { SessionGuard } from "../../common/session.guard";
import type { DbOrder, DbPort, DbFulfillmentStatus } from "../../common/db.port";
import { getCorrelationId } from "../../correlation";
import { SalesService } from "../../sales/nest/sales.service";
import { FulfillmentService } from "../fulfillment-service";
import { OrderNotificationService } from "../order-notification-service";
import { OrderSaleService } from "../order-sale-service";
import { OrderService } from "../order-service";

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

@Controller("api/v1")
@UseGuards(SessionGuard)
export class OrderController {
  private readonly fulfillments: FulfillmentService;
  private readonly orderSales: OrderSaleService;

  constructor(
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject("DbPort") private readonly db: DbPort,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject("OrderNotificationService") notifications: OrderNotificationService,
  ) {
    this.fulfillments = new FulfillmentService(db, notifications);
    this.orderSales = new OrderSaleService(db);
  }

  private permissions(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  private canView(req: Request, res: Response): boolean {
    if (this.permissions(req).includes("order.view")) return true;
    fail(res, 403, "FORBIDDEN", "Order access not permitted", req);
    return false;
  }

  private can(req: Request, res: Response, permission: string): boolean {
    if (this.permissions(req).includes(permission)) return true;
    fail(res, 403, "FORBIDDEN", "Order action not permitted", req);
    return false;
  }

  private async scopedOrder(req: Request, res: Response, id: string): Promise<DbOrder | null> {
    const order = await this.db.findOrderById(id, req.auth!.businessId);
    if (!order || (req.auth!.activeBranchId && order.branchId !== req.auth!.activeBranchId)) {
      fail(res, 404, "NOT_FOUND", "Order not found", req);
      return null;
    }
    return order;
  }

  private async fulfillmentAction(
    req: Request,
    res: Response,
    orderId: string,
    fulfillmentId: string,
    body: unknown,
    target: DbFulfillmentStatus,
  ): Promise<void> {
    if (!this.can(req, res, "order.fulfill")) return;
    const parsed = fulfillmentActionSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid fulfillment action", req);
      return;
    }
    try {
      if (!(await this.scopedOrder(req, res, orderId))) return;
      const row = await this.fulfillments.transition(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        orderId,
        fulfillmentId,
        target,
        parsed.data.expectedVersion,
        idempotencyKey(req),
      );
      res.status(200).json(row);
    } catch (error) {
      failFromError(res, error, "Fulfillment action failed", req);
    }
  }

  @Get("orders")
  async list(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    if (!this.canView(req, res)) return;
    const parsed = orderListSchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid orders query", req);
      return;
    }
    const activeBranchId = req.auth!.activeBranchId ?? null;
    if (activeBranchId && parsed.data.branchId && parsed.data.branchId !== activeBranchId) {
      fail(res, 403, "FORBIDDEN", "Order branch not permitted", req);
      return;
    }
    try {
      res.json(await this.orders.listOrders(req.auth!.businessId, {
        ...parsed.data,
        ...(activeBranchId ? { branchId: activeBranchId } : {}),
      }));
    } catch (error) {
      failFromError(res, error, "Order fetch failed", req);
    }
  }

  @Get("orders/:id")
  async detail(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (!this.canView(req, res)) return;
    try {
      const out = await this.orders.getOrder(req.auth!.businessId, id, this.permissions(req));
      if (req.auth!.activeBranchId && out.order.branchId !== req.auth!.activeBranchId) {
        fail(res, 404, "NOT_FOUND", "Order not found", req);
        return;
      }
      res.json(out);
    } catch (error) {
      failFromError(res, error, "Order fetch failed", req);
    }
  }

  @Post("orders/:id/accept")
  @UseGuards(CsrfGuard)
  async accept(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.can(req, res, "order.accept")) return;
    const parsed = orderStaffVersionSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid acceptance payload", req); return; }
    try {
      if (!(await this.scopedOrder(req, res, id))) return;
      res.status(200).json(await this.orders.acceptPayAtPickup(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        id,
        parsed.data.expectedVersion,
        idempotencyKey(req),
      ));
    } catch (error) {
      failFromError(res, error, "Order acceptance failed", req);
    }
  }

  @Post("orders/:id/reject")
  @UseGuards(CsrfGuard)
  async reject(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.can(req, res, "order.cancel")) return;
    const parsed = orderStaffCancelSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid rejection payload", req); return; }
    try {
      if (!(await this.scopedOrder(req, res, id))) return;
      res.status(200).json(await this.orders.rejectOrder(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        id,
        parsed.data.expectedVersion,
        idempotencyKey(req),
        parsed.data.reason,
      ));
    } catch (error) {
      failFromError(res, error, "Order rejection failed", req);
    }
  }

  @Post("orders/:id/cancel")
  @UseGuards(CsrfGuard)
  async cancel(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.can(req, res, "order.cancel")) return;
    const parsed = orderStaffCancelSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid cancellation payload", req); return; }
    try {
      if (!(await this.scopedOrder(req, res, id))) return;
      res.status(200).json(await this.orders.cancelOrder(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        id,
        parsed.data.expectedVersion,
        idempotencyKey(req),
        parsed.data.reason,
        parsed.data.returnedToMerchant ?? false,
      ));
    } catch (error) {
      failFromError(res, error, "Order cancellation failed", req);
    }
  }

  @Post("orders/:id/link-customer")
  @UseGuards(CsrfGuard)
  async linkCustomer(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.can(req, res, "order.link_customer")) return;
    const parsed = orderLinkCustomerSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid customer link payload", req); return; }
    try {
      if (!(await this.scopedOrder(req, res, id))) return;
      res.status(200).json(await this.orders.linkCustomer(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        id,
        parsed.data.customerId,
        parsed.data.expectedVersion,
        req.auth!.role,
        idempotencyKey(req),
        parsed.data.overrideReason,
      ));
    } catch (error) {
      failFromError(res, error, "Customer link failed", req);
    }
  }

  @Post("orders/:id/access/resend")
  @UseGuards(CsrfGuard)
  async resendAccess(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (!this.can(req, res, "order.manage_access")) return;
    try {
      if (!(await this.scopedOrder(req, res, id))) return;
      res.status(200).json(await this.orders.resendAccess(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        id,
        idempotencyKey(req),
      ));
    } catch (error) {
      failFromError(res, error, "Order access resend failed", req);
    }
  }

  @Post("orders/:id/access/revoke")
  @UseGuards(CsrfGuard)
  async revokeAccess(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (!this.can(req, res, "order.manage_access")) return;
    try {
      if (!(await this.scopedOrder(req, res, id))) return;
      res.status(200).json(await this.orders.revokeAccess(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        id,
        idempotencyKey(req),
      ));
    } catch (error) {
      failFromError(res, error, "Order access revoke failed", req);
    }
  }

  @Post("orders/:orderId/fulfillments/:fulfillmentId/assign")
  @UseGuards(CsrfGuard)
  async assignFulfillment(
    @Req() req: Request,
    @Res() res: Response,
    @Param("orderId") orderId: string,
    @Param("fulfillmentId") fulfillmentId: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.can(req, res, "order.fulfill")) return;
    const parsed = fulfillmentAssignSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid assignment payload", req); return; }
    try {
      if (!(await this.scopedOrder(req, res, orderId))) return;
      res.status(200).json(await this.fulfillments.assignFulfillment(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        orderId,
        fulfillmentId,
        parsed.data.assignedUserId,
        parsed.data.expectedVersion,
        idempotencyKey(req),
      ));
    } catch (error) {
      failFromError(res, error, "Fulfillment assignment failed", req);
    }
  }

  @Post("orders/:orderId/fulfillments/:fulfillmentId/ready")
  @UseGuards(CsrfGuard)
  async ready(@Req() req: Request, @Res() res: Response, @Param("orderId") orderId: string, @Param("fulfillmentId") fulfillmentId: string, @Body() body: unknown): Promise<void> {
    return this.fulfillmentAction(req, res, orderId, fulfillmentId, body, "READY");
  }

  @Post("orders/:orderId/fulfillments/:fulfillmentId/pack")
  @UseGuards(CsrfGuard)
  async pack(@Req() req: Request, @Res() res: Response, @Param("orderId") orderId: string, @Param("fulfillmentId") fulfillmentId: string, @Body() body: unknown): Promise<void> {
    return this.fulfillmentAction(req, res, orderId, fulfillmentId, body, "PACKED");
  }

  @Post("orders/:orderId/fulfillments/:fulfillmentId/dispatch")
  @UseGuards(CsrfGuard)
  async dispatch(@Req() req: Request, @Res() res: Response, @Param("orderId") orderId: string, @Param("fulfillmentId") fulfillmentId: string, @Body() body: unknown): Promise<void> {
    return this.fulfillmentAction(req, res, orderId, fulfillmentId, body, "DISPATCHED");
  }

  @Post("orders/:orderId/fulfillments/:fulfillmentId/deliver")
  @UseGuards(CsrfGuard)
  async deliver(@Req() req: Request, @Res() res: Response, @Param("orderId") orderId: string, @Param("fulfillmentId") fulfillmentId: string, @Body() body: unknown): Promise<void> {
    return this.fulfillmentAction(req, res, orderId, fulfillmentId, body, "DELIVERED");
  }

  @Post("orders/:orderId/fulfillments/:fulfillmentId/fail")
  @UseGuards(CsrfGuard)
  async failDelivery(@Req() req: Request, @Res() res: Response, @Param("orderId") orderId: string, @Param("fulfillmentId") fulfillmentId: string, @Body() body: unknown): Promise<void> {
    return this.fulfillmentAction(req, res, orderId, fulfillmentId, body, "DELIVERY_FAILED");
  }

  @Post("orders/:orderId/fulfillments/:fulfillmentId/collect")
  @UseGuards(CsrfGuard)
  async collect(
    @Req() req: Request,
    @Res() res: Response,
    @Param("orderId") orderId: string,
    @Param("fulfillmentId") fulfillmentId: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.can(req, res, "order.collect")) return;
    const parsed = fulfillmentCollectSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid collection payload", req); return; }
    try {
      const order = await this.scopedOrder(req, res, orderId);
      if (!order) return;
      const key = idempotencyKey(req);
      if (order.paymentMode === "PAY_AT_PICKUP") {
        if (!parsed.data.payments?.length) throw new Error("VALIDATION");
        const sale = await this.orderSales.createSaleFromSubmittedOrder(
          req.auth!.businessId,
          req.auth!.userId,
          rid(req),
          order.id,
        );
        const completed = await this.sales.completeSale(
          req.auth!.businessId,
          req.auth!.userId,
          rid(req),
          sale.id,
          {
            payments: parsed.data.payments,
            key,
            granted: this.permissions(req),
            registerId: parsed.data.registerId,
            branchId: parsed.data.branchId ?? order.branchId,
          },
        );
        if (completed.sale.status === "PAYMENT_UNKNOWN") throw new Error("PAYMENT_UNKNOWN");
        if (completed.sale.status !== "COMPLETED") throw new Error("SALE_INVALID_TRANSITION");
      } else if ((parsed.data.payments?.length ?? 0) > 0) {
        throw new Error("VALIDATION");
      }
      const fulfillment = await this.fulfillments.transition(
        req.auth!.businessId,
        req.auth!.userId,
        rid(req),
        orderId,
        fulfillmentId,
        "COLLECTED",
        parsed.data.expectedVersion,
        key,
      );
      res.status(200).json(fulfillment);
    } catch (error) {
      failFromError(res, error, "Order collection failed", req);
    }
  }
}
