import { Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { orderListSchema } from "@pos/validation";
import { AuthService } from "../../auth/nest/auth.service";
import { fail, failFromError } from "../../common/http-helpers";
import { SessionGuard } from "../../common/session.guard";
import { OrderService } from "../order-service";

@Controller("api/v1")
@UseGuards(SessionGuard)
export class OrderController {
  constructor(
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private permissions(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  private canView(req: Request, res: Response): boolean {
    if (this.permissions(req).includes("order.view")) return true;
    fail(res, 403, "FORBIDDEN", "Order access not permitted", req);
    return false;
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
}
