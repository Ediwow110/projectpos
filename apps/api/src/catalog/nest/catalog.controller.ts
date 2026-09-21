import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  productCreateSchema,
  productImportSchema,
  productSearchSchema,
  productUpdateSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { createRateLimiter } from "../../common/rate-limit";
import { redactProductForRole } from "../search";
import { AuthService } from "../../auth/nest/auth.service";
import { CatalogService } from "./catalog.service";

const importLimiter = createRateLimiter(5, 60_000);

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  private canWrite(req: Request): boolean {
    return this.perms(req).includes("price.edit");
  }

  private writeGuard(req: Request, res: Response): boolean {
    if (!this.canWrite(req)) {
      fail(res, 403, "FORBIDDEN", "Catalog write requires price.edit", req);
      return false;
    }
    return true;
  }

  @Get("categories")
  async listCategories(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.json({ items: await this.catalog.listCategories(req.auth!.businessId) });
  }

  @Post("categories")
  @UseGuards(CsrfGuard)
  async createCategory(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.writeGuard(req, res)) return;
    const parsed = categoryCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid category payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const row = await this.catalog.createCategory(auth.businessId, auth.userId, rid(req), {
        name: parsed.data.name,
        description: parsed.data.description,
        isActive: parsed.data.isActive,
      });
      res.status(201).json(row);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Category create failed", req);
    }
  }

  @Patch("categories/:id")
  @UseGuards(CsrfGuard)
  async updateCategory(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.writeGuard(req, res)) return;
    const parsed = categoryUpdateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid category payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.json(await this.catalog.updateCategory(auth.businessId, auth.userId, rid(req), id, parsed.data));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Category update failed", req);
    }
  }

  @Get("products")
  async searchProducts(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = productSearchSchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid search payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const out = await this.catalog.searchProducts(auth.businessId, parsed.data);
      const granted = this.perms(req);
      res.json({
        ...out,
        items: out.items.map((row) => redactProductForRole(row, granted)),
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Product search failed", req);
    }
  }

  @Post("products")
  @UseGuards(CsrfGuard)
  async createProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.writeGuard(req, res)) return;
    const parsed = productCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid product payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const row = await this.catalog.createProduct(auth.businessId, auth.userId, rid(req), parsed.data);
      res.status(201).json(redactProductForRole(row, this.perms(req)));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Product create failed", req);
    }
  }

  @Get("products/:id")
  async getProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      const row = await this.catalog.getProduct(auth.businessId, id, this.perms(req));
      res.json(redactProductForRole(row, this.perms(req)));
    } catch (e) {
      const code = e instanceof Error ? e.message : "NOT_FOUND";
      fail(res, statusFor(code, 404), code, "Product not found", req);
    }
  }

  @Patch("products/:id")
  @UseGuards(CsrfGuard)
  async updateProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.writeGuard(req, res)) return;
    const parsed = productUpdateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid product payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const row = await this.catalog.updateProduct(auth.businessId, auth.userId, rid(req), id, parsed.data);
      res.json(redactProductForRole(row, this.perms(req)));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Product update failed", req);
    }
  }

  @Post("products/:id/archive")
  @UseGuards(CsrfGuard)
  async archiveProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    if (!this.writeGuard(req, res)) return;
    try {
      const auth = req.auth!;
      const row = await this.catalog.setProductActive(auth.businessId, auth.userId, rid(req), id, false);
      res.json(redactProductForRole(row, this.perms(req)));
    } catch (e) {
      const code = e instanceof Error ? e.message : "NOT_FOUND";
      fail(res, statusFor(code, 404), code, "Product archive failed", req);
    }
  }

  @Post("products/:id/restore")
  @UseGuards(CsrfGuard)
  async restoreProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    if (!this.writeGuard(req, res)) return;
    try {
      const auth = req.auth!;
      const row = await this.catalog.setProductActive(auth.businessId, auth.userId, rid(req), id, true);
      res.json(redactProductForRole(row, this.perms(req)));
    } catch (e) {
      const code = e instanceof Error ? e.message : "NOT_FOUND";
      fail(res, statusFor(code, 404), code, "Product restore failed", req);
    }
  }

  @Post("products/import")
  @UseGuards(CsrfGuard)
  async importProducts(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.writeGuard(req, res)) return;
    const auth = req.auth!;
    if (importLimiter.hit(`${auth.businessId}:import`)) {
      fail(res, 429, "RATE_LIMITED", "Too many imports", req);
      return;
    }
    const parsed = productImportSchema.safeParse(body);
    if (!parsed.success) {
      const tooLarge = parsed.error.issues.some((i) => i.message === "CATALOG_IMPORT_TOO_LARGE");
      fail(res, tooLarge ? 400 : 400, tooLarge ? "CATALOG_IMPORT_TOO_LARGE" : "VALIDATION", "Invalid import payload", req);
      return;
    }
    try {
      const out = await this.catalog.importProducts(auth.businessId, auth.userId, rid(req), parsed.data);
      res.status(201).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Product import failed", req);
    }
  }
}
