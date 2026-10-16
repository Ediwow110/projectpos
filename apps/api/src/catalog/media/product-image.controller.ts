import {
  Body, CanActivate, Controller, Delete, ExecutionContext, Get, Inject, Injectable,
  Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import type { DbPort } from "../../common/db.port";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { FirstPartyOriginGuard } from "../../common/first-party-origin.guard";
import { createRateLimiter } from "../../common/rate-limit";
import { failFromError } from "../../common/http-helpers";
import { PRODUCT_MEDIA_SOURCE_MAX_BYTES, assertOwnerMediaWrite, productMediaConfigFromEnv } from "./product-media-config";
import { ProductMediaService } from "./product-media.service";
import type { ProductImageUpload } from "./product-image-validation";

const mediaLimiter = createRateLimiter(12, 60_000);

@Injectable()
export class ProductMediaOwnerGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    try {
      assertOwnerMediaWrite(req.auth as (typeof req.auth & { via?: string }) | undefined);
    } catch {
      req.authError = "FORBIDDEN";
      return false;
    }
    if (!productMediaConfigFromEnv(process.env).enabled) {
      req.authError = "PRODUCT_MEDIA_DISABLED";
      return false;
    }
    if (await mediaLimiter.hit(`product-media:${req.auth!.businessId}:${req.auth!.userId}`)) {
      req.authError = "RATE_LIMITED";
      return false;
    }
    return true;
  }
}

function expectedVersion(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("PRODUCT_MEDIA_INVALID");
  }
  return value;
}

@Controller("api/v1/products")
export class ProductImageController {
  constructor(
    @Inject("DbPort") private readonly db: DbPort,
    @Inject(ProductMediaService) private readonly service: ProductMediaService,
  ) {}

  @Get(":id/image")
  @UseGuards(SessionGuard)
  async read(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try {
      assertOwnerMediaWrite(req.auth as (typeof req.auth & { via?: string }) | undefined);
      const product = await this.db.findProductById(id, req.auth!.businessId);
      if (!product) throw new Error("NOT_FOUND");
      const asset = await this.db.getActiveProductMedia(req.auth!.businessId, id);
      res.json({ imageUrl: product.imageUrl, assetId: asset?.id ?? null });
    } catch (error) {
      failFromError(res, error, "Could not read product image", req);
    }
  }

  @Post(":id/image")
  @UseGuards(SessionGuard, CsrfGuard, FirstPartyOriginGuard, ProductMediaOwnerGuard)
  @UseInterceptors(FileInterceptor("image", {
    limits: { fileSize: PRODUCT_MEDIA_SOURCE_MAX_BYTES, files: 1, fields: 1, parts: 2 },
  }))
  async upload(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @UploadedFile() file: ProductImageUpload | undefined,
    @Body("expectedAssetId") expectedAssetId: unknown,
  ): Promise<void> {
    try {
      if (!file) throw new Error("PRODUCT_IMAGE_INVALID");
      const result = await this.service.upload(req.auth!, req.correlationId ?? "media", id, file, expectedVersion(expectedAssetId));
      res.status(201).json({ imageUrl: result.product.imageUrl, assetId: result.asset.id });
    } catch (error) {
      failFromError(res, error, "Product image upload failed", req);
    }
  }

  @Delete(":id/image")
  @UseGuards(SessionGuard, CsrfGuard, FirstPartyOriginGuard, ProductMediaOwnerGuard)
  async remove(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body("expectedAssetId") expectedAssetId: unknown,
  ): Promise<void> {
    try {
      const result = await this.service.remove(req.auth!, req.correlationId ?? "media", id, expectedVersion(expectedAssetId));
      res.json({ imageUrl: result.product.imageUrl, assetId: null });
    } catch (error) {
      failFromError(res, error, "Product image removal failed", req);
    }
  }
}
