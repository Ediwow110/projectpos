import { Body, Controller, Get, Inject, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  bundleCreateSchema,
  bundleUpdateSchema,
  productFamilyCreateSchema,
  productFamilyUpdateSchema,
  productFamilyOptionsUpdateSchema,
  productVariantCreateSchema,
  labelQuerySchema,
} from "@pos/validation";
import { ApiTokenGuard } from "../../apitokens/api-token.guard";
import { Scopes } from "../../apitokens/scopes.decorator";
import { AuthService } from "../../auth/nest/auth.service";
import { CsrfGuard } from "../../common/csrf.guard";
import { fail, failFromError, statusFor } from "../../common/http-helpers";
import { getCorrelationId } from "../../correlation";
import { SessionGuard } from "../../common/session.guard";
import { ProductModelService } from "./product-model.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(ApiTokenGuard, SessionGuard)
export class ProductModelController {
  constructor(
    @Inject(ProductModelService) private readonly models: ProductModelService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private canWrite(req: Request): boolean {
    return (req.auth as { via?: string } | undefined)?.via === "api-token" || this.auth.permissionsForRequest(req.auth!).includes("price.edit");
  }

  private guardWrite(req: Request, res: Response): boolean {
    if (this.canWrite(req)) return true;
    fail(res, 403, "FORBIDDEN", "Catalog write requires price.edit", req);
    return false;
  }

  @Get("product-families")
  @Scopes("catalog:read")
  async listFamilies(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.json({ items: await this.models.listFamilies(req.auth!.businessId) });
  }

  @Get("product-families/:id")
  @Scopes("catalog:read")
  async getFamily(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { res.json(await this.models.listFamily(req.auth!.businessId, id)); }
    catch (error) { const code = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(code, 404), code, "Product family not found", req); }
  }

  @Post("product-families")
  @UseGuards(CsrfGuard)
  @Scopes("catalog:write")
  async createFamily(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!this.guardWrite(req, res)) return;
    const parsed = productFamilyCreateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid product family payload", req); return; }
    try { res.status(201).json(await this.models.createFamily(req.auth!.businessId, req.auth!.userId, rid(req), parsed.data)); }
    catch (error) { failFromError(res, error, "Product family create failed", req); }
  }

  @Patch("product-families/:id")
  @UseGuards(CsrfGuard)
  @Scopes("catalog:write")
  async updateFamily(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.guardWrite(req, res)) return;
    const parsed = productFamilyUpdateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid product family payload", req); return; }
    try { res.json(await this.models.updateFamily(req.auth!.businessId, req.auth!.userId, rid(req), id, parsed.data)); }
    catch (error) { failFromError(res, error, "Product family update failed", req); }
  }

  @Patch("product-families/:id/options")
  @UseGuards(CsrfGuard)
  @Scopes("catalog:write")
  async updateFamilyOptions(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.guardWrite(req, res)) return;
    const parsed = productFamilyOptionsUpdateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid product family options payload", req); return; }
    try { res.json(await this.models.updateFamilyOptions(req.auth!.businessId, req.auth!.userId, rid(req), id, parsed.data)); }
    catch (error) { failFromError(res, error, "Product family options update failed", req); }
  }

  @Post("product-families/:id/variants")
  @UseGuards(CsrfGuard)
  @Scopes("catalog:write")
  async createVariant(@Req() req: Request, @Res() res: Response, @Param("id") familyId: string, @Body() body: unknown): Promise<void> {
    if (!this.guardWrite(req, res)) return;
    const parsed = productVariantCreateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid product variant payload", req); return; }
    try { res.status(201).json(await this.models.createVariant(req.auth!.businessId, req.auth!.userId, rid(req), familyId, parsed.data)); }
    catch (error) { failFromError(res, error, "Product variant create failed", req); }
  }

  @Post("products/:id/barcode")
  @UseGuards(CsrfGuard)
  @Scopes("catalog:write")
  async generateBarcode(@Req() req: Request, @Res() res: Response, @Param("id") productId: string): Promise<void> {
    if (!this.guardWrite(req, res)) return;
    try { res.json(await this.models.generateBarcode(req.auth!.businessId, req.auth!.userId, rid(req), productId)); }
    catch (error) { failFromError(res, error, "Barcode generation failed", req); }
  }

  @Get("products/barcode/:barcode")
  @Scopes("catalog:read")
  async findBarcode(@Req() req: Request, @Res() res: Response, @Param("barcode") barcode: string): Promise<void> {
    try { res.json(await this.models.findBarcode(req.auth!.businessId, barcode)); }
    catch (error) { const code = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(code, 404), code, "Barcode not found", req); }
  }

  @Get("products/labels")
  @Scopes("catalog:read")
  async labels(@Req() req: Request, @Res() res: Response): Promise<void> {
    const raw = req.query as Record<string, string | undefined>;
    const parsed = labelQuerySchema.safeParse(raw);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid label query", req); return; }
    try {
      const ids = parsed.data.productIds.split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.length * parsed.data.quantity > 500) { fail(res, 400, "PHASE19_LIMIT", "Print jobs are limited to 500 labels", req); return; }
      res.json({ items: await this.models.labelProducts(req.auth!.businessId, ids, parsed.data.quantity) });
    } catch (error) { failFromError(res, error, "Label data failed", req); }
  }

  @Post("bundles")
  @UseGuards(CsrfGuard)
  @Scopes("catalog:write")
  async createBundle(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!this.guardWrite(req, res)) return;
    const parsed = bundleCreateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid bundle payload", req); return; }
    try { res.status(201).json(await this.models.createBundle(req.auth!.businessId, req.auth!.userId, rid(req), parsed.data)); }
    catch (error) { failFromError(res, error, "Bundle create failed", req); }
  }

  @Get("bundles")
  @Scopes("catalog:read")
  async listBundles(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.json({ items: await this.models.listBundles(req.auth!.businessId) });
  }

  @Get("bundles/:id")
  @Scopes("catalog:read")
  async getBundle(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try { res.json(await this.models.getBundle(req.auth!.businessId, id)); }
    catch (error) { const code = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(code, 404), code, "Bundle not found", req); }
  }

  @Patch("bundles/:id")
  @UseGuards(CsrfGuard)
  @Scopes("catalog:write")
  async updateBundle(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.guardWrite(req, res)) return;
    const parsed = bundleUpdateSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid bundle payload", req); return; }
    try { res.json(await this.models.updateBundle(req.auth!.businessId, req.auth!.userId, rid(req), id, parsed.data)); }
    catch (error) { failFromError(res, error, "Bundle update failed", req); }
  }

  @Get("products/:id/bundle-availability")
  @Scopes("catalog:read")
  async bundleAvailability(@Req() req: Request, @Res() res: Response, @Param("id") productId: string): Promise<void> {
    try { res.json({ available: await this.models.bundleAvailability(req.auth!.businessId, productId, req.auth!.activeBranchId ?? null) }); }
    catch (error) { const code = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(code, 404), code, "Bundle availability failed", req); }
  }
}
