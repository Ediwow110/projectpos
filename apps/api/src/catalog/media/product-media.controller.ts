import { Controller, Get, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionGuard } from "../../common/session.guard";
import { fail } from "../../common/http-helpers";
import { productMediaConfigFromEnv } from "./product-media-config";

@Controller("api/v1/product-media")
@UseGuards(SessionGuard)
export class ProductMediaController {
  @Get("capabilities")
  capabilities(@Req() req: Request, @Res() res: Response): void {
    if (!req.auth || (req.auth as { via?: string }).via === "api-token") {
      fail(res, 403, "FORBIDDEN", "A signed-in business session is required", req);
      return;
    }
    const config = productMediaConfigFromEnv(process.env);
    res.json(config.enabled ? config.capabilities : config);
  }
}
