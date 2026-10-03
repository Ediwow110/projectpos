import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  productSupplierCreateSchema,
  productSupplierUpdateSchema,
  purchaseOrderCancelSchema,
  purchaseOrderCreateSchema,
  purchaseOrderListSchema,
  purchaseOrderOrderSchema,
  purchaseOrderUpdateSchema,
  supplierCreateSchema,
  supplierListSchema,
  supplierUpdateSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { ProcurementService } from "./procurement.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return getCorrelationId(headers);
}

function idemKey(req: Request): string | null {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  return key?.trim() || null;
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ProcurementController {
  constructor(
    @Inject(ProcurementService) private readonly procurement: ProcurementService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  private requireKey(req: Request, res: Response): string | null {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return null;
    }
    return key;
  }

  @Get("suppliers")
  async listSuppliers(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    const parsed = supplierListSchema.safeParse(query);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid suppliers query", req); return; }
    try {
      res.json(await this.procurement.listSuppliers(req.auth!.businessId, parsed.data));
    } catch (e) { failFromError(res, e, "Supplier fetch failed", req); }
  }

  @Post("suppliers")
  @UseGuards(CsrfGuard)
  async createSupplier(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = supplierCreateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid supplier payload", req); return; }
    const key = this.requireKey(req, res);
    if (!key) return;
    try {
      const auth = req.auth!;
      const result = await this.procurement.createSupplier(auth.businessId, auth.userId, rid(req), key, parsed.data, this.perms(req));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) { failFromError(res, e, "Supplier creation failed", req); }
  }

  @Get("suppliers/:id")
  async getSupplier(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { res.json(await this.procurement.getSupplier(req.auth!.businessId, id)); }
    catch (e) { failFromError(res, e, "Supplier fetch failed", req); }
  }

  @Patch("suppliers/:id")
  @UseGuards(CsrfGuard)
  async updateSupplier(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = supplierUpdateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid supplier payload", req); return; }
    try {
      const auth = req.auth!;
      res.json(await this.procurement.updateSupplier(auth.businessId, auth.userId, rid(req), id, parsed.data, this.perms(req)));
    } catch (e) { failFromError(res, e, "Supplier update failed", req); }
  }

  @Post("suppliers/:id/deactivate")
  @UseGuards(CsrfGuard)
  async deactivateSupplier(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { const auth = req.auth!; res.json(await this.procurement.setSupplierActive(auth.businessId, auth.userId, rid(req), id, false, this.perms(req))); }
    catch (e) { failFromError(res, e, "Supplier deactivation failed", req); }
  }

  @Post("suppliers/:id/reactivate")
  @UseGuards(CsrfGuard)
  async reactivateSupplier(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { const auth = req.auth!; res.json(await this.procurement.setSupplierActive(auth.businessId, auth.userId, rid(req), id, true, this.perms(req))); }
    catch (e) { failFromError(res, e, "Supplier reactivation failed", req); }
  }

  @Get("suppliers/:id/products")
  async listSupplierProducts(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { res.json({ items: await this.procurement.listSupplierProducts(req.auth!.businessId, id) }); }
    catch (e) { failFromError(res, e, "Supplier products fetch failed", req); }
  }

  @Post("suppliers/:id/products")
  @UseGuards(CsrfGuard)
  async createSupplierProduct(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = productSupplierCreateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid supplier product payload", req); return; }
    try { const auth = req.auth!; res.status(201).json(await this.procurement.createProductSupplier(auth.businessId, auth.userId, rid(req), id, parsed.data, this.perms(req))); }
    catch (e) { failFromError(res, e, "Supplier product creation failed", req); }
  }

  @Patch("suppliers/:id/products/:relationshipId")
  @UseGuards(CsrfGuard)
  async updateSupplierProduct(@Req() req: Request, @Res() res: Response, @Param("id") supplierId: string, @Param("relationshipId") relationshipId: string, @Body() body: unknown): Promise<void> {
    const parsed = productSupplierUpdateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid supplier product payload", req); return; }
    try { const auth = req.auth!; res.json(await this.procurement.updateProductSupplier(auth.businessId, auth.userId, rid(req), relationshipId, parsed.data, this.perms(req), supplierId)); }
    catch (e) { failFromError(res, e, "Supplier product update failed", req); }
  }

  @Delete("suppliers/:id/products/:relationshipId")
  @UseGuards(CsrfGuard)
  async deleteSupplierProduct(@Req() req: Request, @Res() res: Response, @Param("id") supplierId: string, @Param("relationshipId") relationshipId: string): Promise<void> {
    try { const auth = req.auth!; await this.procurement.deleteProductSupplier(auth.businessId, auth.userId, rid(req), relationshipId, this.perms(req), supplierId); res.status(204).send(); }
    catch (e) { failFromError(res, e, "Supplier product removal failed", req); }
  }

  @Get("purchase-orders")
  async listPurchaseOrders(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    const parsed = purchaseOrderListSchema.safeParse(query);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid purchase-orders query", req); return; }
    try { res.json(await this.procurement.listPurchaseOrders(req.auth!.businessId, parsed.data)); }
    catch (e) { failFromError(res, e, "Purchase-order fetch failed", req); }
  }

  @Post("purchase-orders")
  @UseGuards(CsrfGuard)
  async createPurchaseOrder(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = purchaseOrderCreateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid purchase-order payload", req); return; }
    const key = this.requireKey(req, res);
    if (!key) return;
    try {
      const auth = req.auth!;
      const input = { ...parsed.data, branchId: parsed.data.branchId ?? auth.activeBranchId ?? null };
      const result = await this.procurement.createPurchaseOrder(auth.businessId, auth.userId, rid(req), key, input, this.perms(req));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) { failFromError(res, e, "Purchase-order creation failed", req); }
  }

  @Get("purchase-orders/:id")
  async getPurchaseOrder(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { res.json(await this.procurement.getPurchaseOrder(req.auth!.businessId, id)); }
    catch (e) { failFromError(res, e, "Purchase-order fetch failed", req); }
  }

  @Patch("purchase-orders/:id")
  @UseGuards(CsrfGuard)
  async updatePurchaseOrder(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = purchaseOrderUpdateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid purchase-order payload", req); return; }
    try {
      const auth = req.auth!;
      const { expectedVersion, ...patch } = parsed.data;
      res.json(await this.procurement.updatePurchaseOrder(auth.businessId, auth.userId, rid(req), id, expectedVersion, patch, this.perms(req)));
    } catch (e) { failFromError(res, e, "Purchase-order update failed", req); }
  }

  @Post("purchase-orders/:id/order")
  @UseGuards(CsrfGuard)
  async orderPurchaseOrder(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = purchaseOrderOrderSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid purchase-order order payload", req); return; }
    const key = this.requireKey(req, res);
    if (!key) return;
    try { const auth = req.auth!; const result = await this.procurement.orderPurchaseOrder(auth.businessId, auth.userId, rid(req), id, key, parsed.data.expectedVersion, this.perms(req)); res.status(200).json(result); }
    catch (e) { failFromError(res, e, "Purchase-order order failed", req); }
  }

  @Post("purchase-orders/:id/cancel")
  @UseGuards(CsrfGuard)
  async cancelPurchaseOrder(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = purchaseOrderCancelSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid purchase-order cancellation payload", req); return; }
    const key = this.requireKey(req, res);
    if (!key) return;
    try { const auth = req.auth!; const result = await this.procurement.cancelPurchaseOrder(auth.businessId, auth.userId, rid(req), id, key, parsed.data.reason, parsed.data.expectedVersion, this.perms(req)); res.status(200).json(result); }
    catch (e) { failFromError(res, e, "Purchase-order cancellation failed", req); }
  }

  @Get("purchase-orders/:id/events")
  async purchaseOrderEvents(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { res.json({ items: await this.procurement.listPurchaseOrderEvents(req.auth!.businessId, id) }); }
    catch (e) { failFromError(res, e, "Purchase-order history fetch failed", req); }
  }
}
