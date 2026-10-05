import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { getCorrelationId } from "../correlation";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
    }
    const correlationId = getCorrelationId(headers);
    (req as Request & { correlationId?: string }).correlationId = correlationId;
    res.setHeader("X-Request-Id", correlationId);
    next();
  }
}
